import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { lazyGenerator, layeredLazyGenerator, lazyCheckedGenerator, layeredLazyCheckedGenerator, lazyManualAdapter, consumeLazy } from './lazy-writers.mjs';

const compiler = process.env.TSGO_BINARY;
assert.ok(compiler, 'Set TSGO_BINARY to the built fork compiler');
const records = Number(process.env.BENCH_RECORDS ?? 100000);
const samples = Number(process.env.BENCH_SAMPLES ?? 9);
const warmups = Number(process.env.BENCH_WARMUPS ?? 3);
for (const n of [records, samples, warmups]) assert.ok(Number.isInteger(n) && n > 0);
const dir = mkdtempSync(path.join(os.tmpdir(), 'conditional-write-bench-'));
const source = fileURLToPath(new URL('writers.ts', import.meta.url));
const names = ['ordinary', 'manualChecks', 'conditionalAwait', 'conditionalFunction', 'manualContinuation', 'lazyGenerator', 'lazyCheckedGenerator', 'lazyManualAdapter'];
const labels = ['ordinary async + await', 'ordinary async + manual checks', 'ordinary async + await?', 'async? + await?', 'manual sync continuation', 'LazyPromise generator', 'LazyPromise checked generator', 'LazyPromise manual adapter'];
const results = [];
const totalWrites = records * 3;
const totalBytes = totalWrites * 16;

class BufferedWriter {
    constructor(mode, capacity, file) {
        this.mode = mode;
        this.bytes = new Uint8Array(capacity);
        this.view = new DataView(this.bytes.buffer);
        this.file = file;
        this.offset = 0;
        this.writes = 0;
        this.flushed = 0;
        this.flushes = 0;
        this.busy = false;
    }
    write(value) {
        assert.ok(!this.busy, 'Buffer reused before flush completion');
        const offset = this.offset;
        this.view.setUint32(offset, value, true);
        this.view.setUint32(offset + 4, value ^ 0x12345678, true);
        this.view.setUint32(offset + 8, value ^ 0x76543210, true);
        this.view.setUint32(offset + 12, value, true);
        this.writes++;
        this.offset += 16;
        if (this.offset === this.bytes.length) return this.flush();
    }
    flush() {
        const size = this.offset;
        if (!size) return;
        this.flushes++;
        this.busy = true;
        const done = () => {
            this.flushed += size;
            this.offset = 0;
            this.busy = false;
        };
        if (this.mode === 'microtask') return new Promise(resolve => queueMicrotask(() => { done(); resolve(); }));
        assert.equal(this.mode, 'file');
        // Reuse the buffer only after all bytes have been accepted by write().
        return (async () => {
            let position = 0;
            while (position < size) {
                const { bytesWritten } = await this.file.write(this.bytes, position, size - position);
                assert.ok(bytesWritten > 0);
                position += bytesWritten;
            }
            done();
        })();
    }
}

async function runOne(fn, mode, capacity, lazy) {
    const filePath = path.join(dir, 'output.bin');
    const file = mode === 'file' ? await open(filePath, 'w') : undefined;
    const buffer = new BufferedWriter(mode, capacity, file);
    try {
        const start = performance.now();
        const result = fn(buffer, records);
        const completion = lazy ? consumeLazy(result) : result;
        const synchronous = completion === undefined;
        if (completion) await completion;
        // Memory-only scenario deliberately retains all bytes without a flush.
        if (mode !== 'memory') {
            const tail = buffer.flush();
            if (tail) await tail;
        }
        const elapsed = performance.now() - start;
        assert.equal(buffer.writes, totalWrites);
        assert.equal(buffer.flushed + buffer.offset, totalBytes);
        assert.equal(buffer.busy, false);
        assert.equal(buffer.flushes, mode === 'memory' ? 0 : Math.ceil(totalBytes / capacity));
        if (mode === 'memory') {
            for (let i = 0; i < totalWrites; i++) assert.equal(buffer.view.getUint32(i * 16, true), i);
        }
        if (file) {
            await file.close();
            assert.equal((await stat(filePath)).size, totalBytes);
            const bytes = await readFile(filePath);
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            for (let i = 0; i < totalWrites; i++) {
                assert.equal(view.getUint32(i * 16, true), i);
                assert.equal(view.getUint32(i * 16 + 4, true), (i ^ 0x12345678) >>> 0);
                assert.equal(view.getUint32(i * 16 + 8, true), (i ^ 0x76543210) >>> 0);
                assert.equal(view.getUint32(i * 16 + 12, true), i);
            }
        }
        return { elapsed, synchronous, flushes: buffer.flushes };
    } finally { if (file) await file.close(); }
}

try {
    execFileSync(compiler, [source, '--target', 'es2022', '--module', 'commonjs', '--strict', '--outDir', dir], { stdio: 'pipe' });
    const writers = createRequire(import.meta.url)(path.join(dir, 'writers.js'));
    for (const layout of ['flat', 'layered']) {
        const manual = writers[layout === 'flat' ? 'manualContinuation' : 'layeredManualContinuation'];
        const functions = names.map(name => name === 'lazyGenerator'
            ? (layout === 'flat' ? lazyGenerator : layeredLazyGenerator)
            : name === 'lazyCheckedGenerator' ? (layout === 'flat' ? lazyCheckedGenerator : layeredLazyCheckedGenerator)
            : name === 'lazyManualAdapter' ? lazyManualAdapter(manual)
            : writers[layout === 'flat' ? name : `layered${name[0].toUpperCase()}${name.slice(1)}`]);
        for (const scenario of [{ mode: 'memory', capacity: totalBytes + 16 }, { mode: 'microtask', capacity: 65536 }, { mode: 'file', capacity: 65536 }]) {
            const timings = names.map(() => []);
            const completions = [];
            let flushes;
            for (let round = 0; round < warmups + samples; round++) {
                // Rotate order deterministically; don't always give one strategy first/last position.
                for (let j = 0; j < names.length; j++) {
                    const index = (j + round) % names.length;
                    const run = await runOne(functions[index], scenario.mode, scenario.capacity, index >= 5);
                    if (round >= warmups) timings[index].push(run.elapsed);
                    completions[index] = run.synchronous;
                    flushes = run.flushes;
                }
            }
            const rows = timings.map((raw, index) => {
                const sorted = [...raw].sort((a, b) => a - b);
                return { strategy: labels[index], medianMs: sorted[Math.floor(sorted.length / 2)], minMs: sorted[0], maxMs: sorted.at(-1), synchronousCompletion: completions[index], rawMs: raw };
            });
            results.push({ layout, mode: scenario.mode, capacity: scenario.capacity, flushes, rows });
            console.log(`${layout}/${scenario.mode}: ${rows.map(r => `${r.strategy} ${r.medianMs.toFixed(2)}ms`).join('; ')}`);
        }
    }
    const report = { date: new Date().toISOString(), node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, records, writes: totalWrites, bytes: totalBytes, warmups, samples, target: 'es2022', lazyPromiseVersion: '0.0.46', results };
    const output = process.argv[2];
    if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    else console.log(JSON.stringify(report, null, 2));
} finally { rmSync(dir, { recursive: true, force: true }); }
