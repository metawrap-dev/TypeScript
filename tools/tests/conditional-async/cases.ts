export const events: string[] = [];
export async? function identity<T>(value: T | PromiseLike<T>) { return await? value; }
export async? function add(value: number | PromiseLike<number>): number | Promise<number> { return (await? value) + 1; }
export const arrow = async? (value: unknown) => await? value;
export const simple = async? value => await? value;
export const generic = async? <T>(value: T | PromiseLike<T>) => await? value;
export const expression = async? function named(value: unknown) { return await? value; };
export async? function noAwait() { return 7; }
export async? function empty(): void | Promise<void> {}
export async? function loop(count: number) { let sum = 0; for (let i = 0; i < count; i++) sum += await? i; return sum; }
export async? function sequence(values: (number | PromiseLike<number>)[]) {
    let sum = 0;
    for (const value of values) { sum += await? value; events.push(String(sum)); }
    return sum;
}
export async? function forced() { events.push("before"); await 1; events.push("after"); return 9; }
export async? function failure(value: unknown) { await? value; throw new Error("failure"); }
export async? function guarded(value: unknown) {
    try { return await? value; } catch (error) { return "caught"; } finally { events.push("finally"); }
}
export async function normal(value: unknown) { events.push("before"); const result = await? value; events.push("after"); return result; }
export async? function nested(value: unknown) { const f = async (x: unknown) => { const y = await? x; return y; }; return await? f(value); }
export async? function direct(value: unknown) { return value; }
export async? function defaults({ value = 3 } = {}, ...rest: number[]) { return (await? value) + rest.length + arguments.length; }
export const arrowDefaults = async? ({ value = 4 } = {}, ...rest: number[]) => (await? value) + rest.length;
export class Base {
    value = 10;
    read() { return this.value; }
}
export class Derived extends Base {
    async? readLater(value: number | PromiseLike<number>) { return super.read() + (await? value) + this.value; }
    async? computed(value: number | PromiseLike<number>) { return super["read"]() + (await? value); }
    async? lexical(value: number | PromiseLike<number>) { const fn = async? () => this.value + (await? value) + arguments.length; return await? fn(); }
}
export const object = { value: 12, async? read(value: number | PromiseLike<number>) { return this.value + (await? value); } };
export async? function iterate(values: AsyncIterable<number> | Iterable<number>) { let sum = 0; for await (const value of values) sum += value; return sum; }
export async function* generator(value: unknown) { yield await? value; }
// Helper bindings must not capture user bindings with these names.
export const __conditionalAwait = 10;
export const __conditionalAwaiter = 20;
const async = true;
export const ternary = async?1:2;
export const spacedTernary = async ? 3 : 4;
const inferred: number | Promise<number> = add(1);
const emptyInferred: void | Promise<void> = empty();
// @ts-expect-error A conditional function can return a plain value.
const wrong: Promise<number> = add(1);
// @ts-expect-error A suspension can return a promise.
async? function invalid(): number { return 1; }
// @ts-expect-error Conditional generators have no defined synchronous iterator contract.
async? function* invalidGenerator() { yield 1; }

export function checkGenericTypes() {
    const nested: number | Promise<number> = identity<Promise<number>>(Promise.resolve(1));
    return nested;
}

// Discarding a result may simplify emit, but must still consume a thenable.
export async? function discard(value: unknown): void | Promise<void> {
    await? value;
    events.push("discarded");
}
// A contextual void contract can conceal a runtime value, including a thenable.
export async? function contextualVoid(callback: () => void): void | Promise<void> {
    return callback();
}

export interface DirectWriter { write(value: number): unknown }
export async? function directWrites(writer: DirectWriter): void | Promise<void> {
    await? writer.write(0);
    await? writer.write(1);
    await? writer.write(2);
}
export async? function directLoop(writer: DirectWriter, count: number): void | Promise<void> {
    for (let i = 0; i < count; i++) await? writer.write(i);
}
export const directArrow = async? (writer: DirectWriter): void | Promise<void> => {
    await? writer.write(0);
    await? writer.write(1);
};
export class DirectMethod {
    values: number[] = [];
    write(value: number): unknown { this.values.push(value); return undefined; }
    async? run(): void | Promise<void> {
        await? this.write(0);
        await? this.write(1);
    }
}
export async? function directShadow(i: number, writer: DirectWriter): void | Promise<void> {
    for (let i = 0; i < 3; i++) await? writer.write(i);
}
export async? function directLoopHooks(writer: DirectWriter, condition: () => boolean, increment: () => void): void | Promise<void> {
    for (let i = 0; condition(); increment()) await? writer.write(i);
}
export async? function capturedLoop(writer: DirectWriter): void | Promise<void> {
    for (let i = 0; i < 3; i++) await? writer.write((() => i)());
}
export const __conditionalContinue = 30;

export async? function directNameCollision(_resume_1: number, _pending_1: number, writer: DirectWriter): void | Promise<void> {
    await? writer.write(_resume_1);
    await? writer.write(_pending_1);
}
export async? function directPromiseShadow(Promise: number, writer: DirectWriter): void | Promise<void> {
    await? writer.write(Promise);
}

// Larger sequences retain shared continuations to bound emitted code size.
export async? function directFive(writer: DirectWriter): void | Promise<void> {
    await? writer.write(0);
    await? writer.write(1);
    await? writer.write(2);
    await? writer.write(3);
    await? writer.write(4);
}
