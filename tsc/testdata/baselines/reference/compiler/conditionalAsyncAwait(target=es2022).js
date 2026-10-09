//// [tests/cases/compiler/conditionalAsyncAwait.ts] ////

//// [conditionalAsyncAwait.ts]
export async? function read<T>(value: T | PromiseLike<T>) { return await? value; }
export async? function flush(value: void | Promise<void>): void | Promise<void> { await? value; }
export const arrow = async? (value: number | Promise<number>) => (await? value) + 1;
export const expression = async? function(value: number | Promise<number>) { return await? value; };
export class Worker { async? read(value: number | Promise<number>) { return await? value; } }
export async function normal(value: number | Promise<number>) { return await? value; }
export async? function forced() { await 1; return 2; }
export async? function noAwait() { return 3; }
export async? function empty() {}
export async? function guarded(value: number | Promise<number>) {
    try { return await? value; } finally { await? undefined; }
}
const async = true;
export const ternary = async?1:2;
const good: number | Promise<number> = read(1);
const emptyGood: void | Promise<void> = empty();
const wrong: Promise<number> = read(1);
async? function wrongReturn(): number { return 1; }
async? function wrongPromiseOnly(): Promise<number> { return 1; }
async? function* wrongGenerator() { yield 1; }

const nestedGeneric: number | Promise<number> = read<Promise<number>>(Promise.resolve(1));


//// [conditionalAsyncAwait.js]
var __conditionalAwait = (this && this.__conditionalAwait) || function (value) {
    var then = value !== null && (typeof value === "object" || typeof value === "function") ? value.then : void 0;
    return typeof then === "function" ? { then: function (resolve, reject) { Reflect.apply(then, value, [resolve, reject]); } } : null;
};
var __conditionalAwaiter = (this && this.__conditionalAwaiter) || function (thisArg, _arguments, P, generator) {
    function step(result) {
        if (!result.done) {
            return Promise.resolve(result.value).then(
                function (value) { return step(generator.next(value)); },
                function (error) { return step(generator["throw"](error)); }
            );
        }
        // A bare return/fallthrough needs neither probing nor allocation.
        if (result.value === void 0) return;
        var completion = __conditionalAwait(result.value);
        return completion ? Promise.resolve(completion) : result.value;
    }
    return step((generator = generator.apply(thisArg, _arguments || [])).next());
};
var __conditionalContinue = (this && this.__conditionalContinue) || function (pending, resume) {
    return Promise.resolve(pending).then(resume);
};
export function read(value) {
    return __conditionalAwaiter(this, void 0, void 0, function* () { var _a, _b; return ((_b = __conditionalAwait(_a = value)) ? yield _b : _a); });
}
export function flush(value) {
    const _pending_1 = __conditionalAwait(value);
    if (_pending_1)
        return __conditionalContinue(_pending_1, () => {
        });
}
export const arrow = (value) => __conditionalAwaiter(void 0, void 0, void 0, function* () { var _a, _b; return (((_b = __conditionalAwait(_a = value)) ? yield _b : _a)) + 1; });
export const expression = function (value) {
    return __conditionalAwaiter(this, void 0, void 0, function* () { var _a, _b; return ((_b = __conditionalAwait(_a = value)) ? yield _b : _a); });
};
export class Worker {
    read(value) {
        return __conditionalAwaiter(this, void 0, void 0, function* () { var _a, _b; return ((_b = __conditionalAwait(_a = value)) ? yield _b : _a); });
    }
}
export async function normal(value) { var _a, _b; return ((_b = __conditionalAwait(_a = value)) ? await _b : _a); }
export function forced() {
    return __conditionalAwaiter(this, void 0, void 0, function* () { yield 1; return 2; });
}
export function noAwait() {
    return __conditionalAwaiter(this, void 0, void 0, function* () { return 3; });
}
export function empty() {
    return __conditionalAwaiter(this, void 0, void 0, function* () { });
}
export function guarded(value) {
    return __conditionalAwaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            return ((_b = __conditionalAwait(_a = value)) ? yield _b : _a);
        }
        finally {
            ((_c = __conditionalAwait(undefined)) ? yield _c : void 0);
        }
    });
}
const async = true;
export const ternary = async ? 1 : 2;
const good = read(1);
const emptyGood = empty();
const wrong = read(1);
function wrongReturn() {
    return __conditionalAwaiter(this, void 0, void 0, function* () { return 1; });
}
function wrongPromiseOnly() {
    return __conditionalAwaiter(this, void 0, void 0, function* () { return 1; });
}
function* wrongGenerator() { yield 1; }
const nestedGeneric = read(Promise.resolve(1));


//// [conditionalAsyncAwait.d.ts]
export declare function read<T>(value: T | PromiseLike<T>): Promise<Awaited<T>> | Awaited<T>;
export declare function flush(value: void | Promise<void>): void | Promise<void>;
export declare const arrow: (value: number | Promise<number>) => number | Promise<number>;
export declare const expression: (value: number | Promise<number>) => number | Promise<number>;
export declare class Worker {
    read(value: number | Promise<number>): number | Promise<number>;
}
export declare function normal(value: number | Promise<number>): Promise<number>;
export declare function forced(): number | Promise<number>;
export declare function noAwait(): number | Promise<number>;
export declare function empty(): void | Promise<void>;
export declare function guarded(value: number | Promise<number>): number | Promise<number>;
export declare const ternary: number;
