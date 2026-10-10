import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { lazyGenerator, layeredLazyGenerator, lazyCheckedGenerator, layeredLazyCheckedGenerator, lazyManualAdapter, consumeLazy } from './lazy-writers.mjs';

assert.ok(process.env.TSGO_BINARY, 'Set TSGO_BINARY to the built fork compiler');
const dir = mkdtempSync(path.join(os.tmpdir(), 'conditional-lazy-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));
execFileSync(process.env.TSGO_BINARY, [fileURLToPath(new URL('writers.ts', import.meta.url)), '--target', 'es2022', '--module', 'commonjs', '--strict', '--outDir', dir]);
const writers = createRequire(import.meta.url)(path.join(dir, 'writers.js'));
for (const layout of ['flat', 'layered']) {
    const conditional = writers[layout === 'flat' ? 'conditionalFunction' : 'layeredConditionalFunction'];
    const manual = writers[layout === 'flat' ? 'manualContinuation' : 'layeredManualContinuation'];
    const strategies = [
        ['conditional', conditional],
        ['LazyPromise generator', (buffer, records) => consumeLazy((layout === 'flat' ? lazyGenerator : layeredLazyGenerator)(buffer, records))],
        ['LazyPromise checked generator', (buffer, records) => consumeLazy((layout === 'flat' ? lazyCheckedGenerator : layeredLazyCheckedGenerator)(buffer, records))],
        ['LazyPromise manual adapter', (buffer, records) => consumeLazy(lazyManualAdapter(manual)(buffer, records))],
    ];
    for (const [name, fn] of strategies) {
        test(`${layout}/${name}: synchronous completion and ordered writes`, () => {
            const values = [];
            assert.equal(fn({ write(value) { values.push(value); } }, 4), undefined);
            assert.deepEqual(values, Array.from({ length: 12 }, (_, i) => i));
        });
        test(`${layout}/${name}: flush backpressure and asynchronous completion`, async () => {
            const values = [];
            let busy = false;
            let flushes = 0;
            const result = fn({ write(value) {
                assert.equal(busy, false);
                values.push(value);
                if (values.length % 2 === 0) {
                    busy = true;
                    flushes++;
                    return new Promise(resolve => queueMicrotask(() => { busy = false; resolve(); }));
                }
            } }, 4);
            assert.ok(result instanceof Promise);
            assert.deepEqual(values, [0, 1], 'Stop at the first pending flush');
            await result;
            assert.deepEqual(values, Array.from({ length: 12 }, (_, i) => i));
            assert.equal(flushes, 6);
        });
        test(`${layout}/${name}: one catch handles throws and rejected flushes`, async () => {
            const failure = new Error('write failure');
            for (const afterFlush of [false, true]) {
                const values = [];
                let caught;
                try {
                    await fn({ write(value) {
                        values.push(value);
                        if (!afterFlush) throw failure;
                        if (value === 0) return Promise.resolve();
                        if (value === 1) return Promise.reject(failure);
                    } }, 4);
                } catch (error) { caught = error; }
                assert.equal(caught, failure);
                assert.deepEqual(values, afterFlush ? [0, 1] : [0]);
            }
        });
    }
}

test('LazyPromise defers execution until subscribed; conditional starts at the call', () => {
    const values = [];
    const buffer = { write(value) { values.push(value); } };
    const lazy = layeredLazyGenerator(buffer, 1);
    assert.deepEqual(values, []);
    assert.equal(consumeLazy(lazy), undefined);
    assert.deepEqual(values, [0, 1, 2]);
    values.length = 0;
    assert.equal(writers.layeredConditionalFunction(buffer, 1), undefined);
    assert.deepEqual(values, [0, 1, 2]);
});
