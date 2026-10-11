import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { layeredLazyGenerator, layeredLazyCheckedGenerator, layeredLazyOperators, consumeLazy } from './lazy-writers.mjs';
import { layeredRxExpand, layeredRxCheckedExpand, layeredRxConcat, consumeObservable } from './rx-writers.mjs';

const strategies = [
    ['LazyPromise generator', (buffer, records) => consumeLazy(layeredLazyGenerator(buffer, records))],
    ['LazyPromise checked generator', (buffer, records) => consumeLazy(layeredLazyCheckedGenerator(buffer, records))],
    ['LazyPromise operators', (buffer, records) => consumeLazy(layeredLazyOperators(buffer, records))],
    ['RxJS expand', (buffer, records) => consumeObservable(layeredRxExpand(buffer, records))],
    ['RxJS checked expand', (buffer, records) => consumeObservable(layeredRxCheckedExpand(buffer, records))],
    ['RxJS concat records', (buffer, records) => consumeObservable(layeredRxConcat(buffer, records))],
];

for (const [name, fn] of strategies) {
    test(`${name}: synchronous completion`, () => {
        let next = 0;
        assert.equal(fn({ write(value) { assert.equal(value, next++); } }, 5000), undefined);
        assert.equal(next, 15000);
    });
    test(`${name}: backpressure and long synchronous suffix`, async () => {
        let next = 0;
        let busy = false;
        const result = fn({ write(value) {
            assert.equal(busy, false);
            assert.equal(value, next++);
            if (value < 4) {
                busy = true;
                return new Promise(resolve => queueMicrotask(() => { busy = false; resolve(); }));
            }
        } }, 5000);
        assert.ok(result instanceof Promise);
        assert.equal(next, 1);
        await result;
        assert.equal(next, 15000);
    });
    test(`${name}: failures stop subsequent writes`, async () => {
        const failure = new Error('write failure');
        for (const asynchronous of [false, true]) {
            let next = 0;
            let caught;
            try {
                await fn({ write(value) {
                    assert.equal(value, next++);
                    if (!asynchronous) throw failure;
                    if (value === 0) return Promise.resolve();
                    return Promise.reject(failure);
                } }, 4);
            } catch (error) { caught = error; }
            assert.equal(caught, failure);
            assert.equal(next, asynchronous ? 2 : 1);
        }
    });
}

test('library-only screening benchmark', { skip: !process.env.BENCH_LIBRARIES }, async t => {
    const records = 100000;
    const warmups = 3;
    const samples = 9;
    for (const mode of ['memory', 'microtask']) {
        const timings = strategies.map(() => []);
        for (let round = 0; round < warmups + samples; round++) {
            for (let j = 0; j < strategies.length; j++) {
                const index = (j + round) % strategies.length;
                const view = new DataView(new ArrayBuffer(mode === 'memory' ? records * 48 + 16 : 65536));
                let offset = 0;
                let writes = 0;
                let flushes = 0;
                let busy = false;
                function flush() {
                    if (!offset) return;
                    busy = true;
                    flushes++;
                    return new Promise(resolve => queueMicrotask(() => { offset = 0; busy = false; resolve(); }));
                }
                const buffer = { write(value) {
                    assert.equal(busy, false);
                    assert.equal(value, writes++);
                    view.setUint32(offset, value, true);
                    view.setUint32(offset + 4, value ^ 0x12345678, true);
                    view.setUint32(offset + 8, value ^ 0x76543210, true);
                    view.setUint32(offset + 12, value, true);
                    offset += 16;
                    if (offset === view.byteLength) return flush();
                } };
                const start = performance.now();
                const result = strategies[index][1](buffer, records);
                assert.equal(result === undefined, mode === 'memory');
                if (result) await result;
                if (mode !== 'memory') await flush();
                const elapsed = performance.now() - start;
                assert.equal(writes, records * 3);
                assert.equal(flushes, mode === 'memory' ? 0 : Math.ceil(records * 48 / 65536));
                assert.equal(busy, false);
                if (round >= warmups) timings[index].push(elapsed);
            }
        }
        for (let i = 0; i < strategies.length; i++) {
            const sorted = timings[i].sort((a, b) => a - b);
            t.diagnostic(`${mode}/${strategies[i][0]}: median ${sorted[4].toFixed(2)} ms; range ${sorted[0].toFixed(2)}-${sorted[8].toFixed(2)} ms`);
        }
    }
    t.diagnostic(`Node ${process.version}; ${process.platform}/${process.arch}; ${records} records; ${warmups} warmups; ${samples} samples`);
});
