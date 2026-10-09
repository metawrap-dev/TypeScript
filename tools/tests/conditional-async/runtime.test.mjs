import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import vm from "node:vm";

const source = fileURLToPath(new URL("cases.ts", import.meta.url));
const compiler = process.env.TSGO_BINARY;
assert.ok(compiler, "Set TSGO_BINARY to the built compiler executable");
const require = createRequire(import.meta.url);

for (const target of ["es2015", "es2016", "es2017", "es2022", "esnext"]) {
    test(`conditional execution: ${target}`, async () => {
        const dir = mkdtempSync(path.join(tmpdir(), "ts-conditional-"));
        try {
            execFileSync(compiler, [source, "--target", target, "--lib", "esnext", "--module", "commonjs", "--strictNullChecks", "--noImplicitAny", "false", "--declaration", "--outDir", dir], { stdio: "pipe" });
            const m = require(path.join(dir, "cases.js"));
            for (const value of [undefined, null, false, 0, "", 4, {}, { then: 1 }, () => 1]) {
                assert.equal(m.identity(value), value);
                assert.equal(m.arrow(value), value);
                assert.equal(m.simple(value), value);
                assert.equal(m.expression(value), value);
            }
            const NativePromise = globalThis.Promise;
            let allocations = 0;
            globalThis.Promise = class extends NativePromise { constructor(fn) { allocations++; super(fn); } };
            try {
                assert.equal(m.add(3), 4);
                assert.equal(m.empty(), undefined);
                assert.equal(m.loop(10000), 49995000);
                assert.equal(allocations, 0);
            } finally { globalThis.Promise = NativePromise; }
            assert.equal(m.add(3), 4);
            assert.equal(await m.add(Promise.resolve(3)), 4);
            assert.equal(await m.identity(vm.runInNewContext("Promise.resolve(11)")), 11);
            const callable = Object.assign(() => {}, { then(resolve) { resolve(12); } });
            assert.equal(await m.identity(callable), 12);
            const then = resolve => resolve(15);
            then.call = () => { throw new Error("overridden call must not be used"); };
            assert.equal(await m.identity({ then }), 15);
            assert.equal(await m.direct({ then(resolve) { resolve(13); } }), 13);
            assert.equal(await m.identity({ then(resolve) { resolve(Promise.resolve(14)); } }), 14);
            const promises = [1, 2, 3].map(value => m.normal(Promise.resolve(value)));
            assert.deepEqual(await Promise.all(promises), [1, 2, 3]);
            assert.equal(m.noAwait(), 7);
            assert.equal(m.empty(), undefined);
            assert.equal(m.loop(100000), 4999950000);
            let calls = 0, reads = 0;
            const thenable = { get then() { reads++; return function(resolve) { calls++; assert.equal(this, thenable); resolve(8); resolve(9); }; } };
            const pending = m.identity(thenable);
            assert.ok(pending instanceof Promise);
            assert.equal(reads, 1);
            assert.equal(calls, 0);
            assert.equal(await pending, 8);
            assert.equal(reads, 1);
            assert.equal(calls, 1);
            await assert.rejects(m.identity({ then() { throw new Error("then method"); } }), /then method/);
            await assert.rejects(m.identity({ then(_resolve, reject) { reject(new Error("then rejection")); } }), /then rejection/);
            assert.equal(await m.identity({ then(resolve, reject) { resolve(16); reject(new Error("late rejection")); throw new Error("late throw"); } }), 16);
            const plain = { get then() { reads++; return null; } };
            reads = 0;
            assert.equal(m.identity(plain), plain);
            // Once at await?, once when returning the value, matching return assimilation.
            assert.equal(reads, 2);
            const throwing = { get then() { throw new Error("getter"); } };
            assert.throws(() => m.identity(throwing), /getter/);
            assert.equal(m.guarded(throwing), "caught");
            assert.equal(await m.guarded(Promise.reject(new Error("reject"))), "caught");
            assert.throws(() => m.failure(1), /failure/);
            await assert.rejects(m.failure(Promise.resolve(1)), /failure/);
            await assert.rejects(m.sequence([Promise.resolve(1), throwing]), /getter/);
            m.events.length = 0;
            assert.equal(m.guarded(throwing), "caught");
            assert.deepEqual(m.events, ["finally"]);
            m.events.length = 0;
            assert.equal(await m.guarded(Promise.reject(new Error("cleanup rejection"))), "caught");
            assert.deepEqual(m.events, ["finally"]);
            let entered = false;
            const deferredFailure = Promise.resolve().then(() => { entered = true; return m.failure(1); });
            assert.equal(entered, false);
            await assert.rejects(deferredFailure, /failure/);
            assert.equal(entered, true);
            m.events.length = 0;
            assert.equal(m.sequence([1, 2, 3]), 6);
            assert.deepEqual(m.events, ["1", "3", "6"]);
            m.events.length = 0;
            const chain = m.sequence([1, Promise.resolve(2), 3]);
            assert.deepEqual(m.events, ["1"]);
            assert.equal(await chain, 6);
            assert.deepEqual(m.events, ["1", "3", "6"]);
            m.events.length = 0;
            const forced = m.forced();
            assert.ok(forced instanceof Promise);
            assert.deepEqual(m.events, ["before"]);
            assert.equal(await forced, 9);
            assert.deepEqual(m.events, ["before", "after"]);
            m.events.length = 0;
            const normal = m.normal(5);
            assert.ok(normal instanceof Promise);
            assert.deepEqual(m.events, ["before", "after"]);
            assert.equal(await normal, 5);
            assert.equal(await m.nested(6), 6);
            assert.equal(m.defaults(), 3);
            assert.equal(m.defaults({ value: 5 }, 1, 2), 10);
            assert.equal(m.arrowDefaults(), 4);
            assert.equal(m.arrowDefaults({ value: 6 }, 1, 2), 8);
            const derived = new m.Derived();
            assert.equal(derived.readLater(2), 22);
            assert.equal(await derived.readLater(Promise.resolve(2)), 22);
            assert.equal(derived.computed(2), 12);
            assert.equal(derived.lexical(2), 13);
            assert.equal(m.object.read(2), 14);
            assert.equal(await m.iterate([1, 2, 3]), 6);
            assert.deepEqual(await m.generator(4).next(), { value: 4, done: false });
            assert.equal(m.ternary, 1);
            assert.equal(m.spacedTernary, 3);
            assert.equal(m.__conditionalAwait, 10);
            assert.equal(m.__conditionalAwaiter, 20);
            const dts = readFileSync(path.join(dir, "cases.d.ts"), "utf8");
            assert.match(dts, /function add\(.*\): number \| Promise<number>/);
            assert.match(dts, /function noAwait\(\): number \| Promise<number>/);
            assert.match(dts, /function empty\(\): void \| Promise<void>/);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
}

test("native top-level conditional await and importHelpers", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ts-conditional-top-"));
    try {
        const { writeFileSync } = await import("node:fs");
        const input = path.join(dir, "top.mts");
        writeFileSync(input, `export const events: string[] = [];\nqueueMicrotask(() => events.push("microtask"));\nexport const plain = await? 5;\nevents.push("plain");\nexport const promised = await? Promise.resolve(6);\nevents.push("promised");\nexport async? function id(x: number) { return await? x; }\n`);
        execFileSync(compiler, [input, "--target", "es2022", "--module", "esnext", "--importHelpers", "--outDir", dir], { stdio: "pipe" });
        const m = await import(pathToFileURL(path.join(dir, "top.mjs")));
        assert.equal(m.plain, 5);
        assert.equal(m.promised, 6);
        assert.deepEqual(m.events, ["plain", "microtask", "promised"]);
        assert.equal(m.id(7), 7);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("conditional helpers remain inline for CommonJS with importHelpers", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ts-conditional-helpers-"));
    try {
        const { writeFileSync } = require("node:fs");
        const input = path.join(dir, "single.ts");
        writeFileSync(input, "export async? function id(value: number | Promise<number>) { return await? value; }\n");
        execFileSync(compiler, [input, "--target", "es2015", "--module", "commonjs", "--importHelpers", "--outDir", dir], { stdio: "pipe" });
        const m = require(path.join(dir, "single.js"));
        assert.equal(m.id(9), 9);
        assert.doesNotMatch(readFileSync(path.join(dir, "single.js"), "utf8"), /require\("tslib"\)/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
