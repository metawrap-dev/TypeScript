// @target: es2015, es2017, es2022, esnext
// @lib: esnext
// @declaration: true
// @strict: true
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
