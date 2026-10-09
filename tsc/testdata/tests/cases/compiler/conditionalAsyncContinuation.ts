// @target: es2015, es2017, es2022, esnext
// @lib: esnext
// @declaration: true
// @strict: true
interface Writer { write(value: number): unknown; }
export async? function record(writer: Writer): void | Promise<void> {
    await? writer.write(0);
    await? writer.write(1);
    await? writer.write(2);
}
export async? function loop(writer: Writer, count: number): void | Promise<void> {
    for (let i = 0; i < count; i++) await? writer.write(i);
}
export const arrow = async? (writer: Writer): void | Promise<void> => {
    await? writer.write(0);
    await? writer.write(1);
};
export class Method {
    write(value: number): unknown { return value; }
    async? run(): void | Promise<void> {
        await? this.write(0);
        await? this.write(1);
    }
}
// Captured per-iteration bindings and value-consuming awaits retain the fallback.
export async? function capture(writer: Writer): void | Promise<void> {
    for (let i = 0; i < 3; i++) await? writer.write((() => i)());
}
export async? function value(writer: Writer) { return await? writer.write(0); }
export const __conditionalContinue = 1;
