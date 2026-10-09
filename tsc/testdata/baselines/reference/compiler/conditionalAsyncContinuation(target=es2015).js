//// [tests/cases/compiler/conditionalAsyncContinuation.ts] ////

//// [conditionalAsyncContinuation.ts]
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


//// [conditionalAsyncContinuation.js]
var __conditionalAwait = (this && this.__conditionalAwait) || function (value) {
    var then = value !== null && (typeof value === "object" || typeof value === "function") ? value.then : void 0;
    return typeof then === "function" ? { then: function (resolve, reject) { Reflect.apply(then, value, [resolve, reject]); } } : null;
};
var __conditionalContinue_1 = (this && this.__conditionalContinue_1) || function (pending, resume) {
    return Promise.resolve(pending).then(resume);
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
export function record(writer) {
    const _resume_1 = () => {
        const _pending_2 = __conditionalAwait(writer.write(2));
        if (_pending_2)
            return __conditionalContinue_1(_pending_2, () => {
            });
    };
    const _resume_2 = () => {
        const _pending_3 = __conditionalAwait(writer.write(1));
        if (_pending_3)
            return __conditionalContinue_1(_pending_3, _resume_1);
        return _resume_1();
    };
    const _pending_1 = __conditionalAwait(writer.write(0));
    if (_pending_1)
        return __conditionalContinue_1(_pending_1, _resume_2);
    return _resume_2();
}
export function loop(writer, count) {
    {
        let i = 0;
        const _resume_3 = () => {
            while (i < count) {
                const _pending_4 = __conditionalAwait(writer.write(i));
                if (_pending_4)
                    return __conditionalContinue_1(_pending_4, () => {
                        i++;
                        return _resume_3();
                    });
                i++;
            }
        };
        return _resume_3();
    }
}
export const arrow = (writer) => {
    const _resume_4 = () => {
        const _pending_6 = __conditionalAwait(writer.write(1));
        if (_pending_6)
            return __conditionalContinue_1(_pending_6, () => {
            });
    };
    const _pending_5 = __conditionalAwait(writer.write(0));
    if (_pending_5)
        return __conditionalContinue_1(_pending_5, _resume_4);
    return _resume_4();
};
export class Method {
    write(value) { return value; }
    run() {
        const _resume_5 = () => {
            const _pending_8 = __conditionalAwait(this.write(1));
            if (_pending_8)
                return __conditionalContinue_1(_pending_8, () => {
                });
        };
        const _pending_7 = __conditionalAwait(this.write(0));
        if (_pending_7)
            return __conditionalContinue_1(_pending_7, _resume_5);
        return _resume_5();
    }
}
// Captured per-iteration bindings and value-consuming awaits retain the fallback.
export function capture(writer) {
    return __conditionalAwaiter(this, void 0, void 0, function* () {
        var _a;
        for (let i = 0; i < 3; i++)
            ((_a = __conditionalAwait(writer.write((() => i)()))) ? yield _a : void 0);
    });
}
export function value(writer) {
    return __conditionalAwaiter(this, void 0, void 0, function* () { var _a, _b; return ((_b = __conditionalAwait(_a = writer.write(0))) ? yield _b : _a); });
}
export const __conditionalContinue = 1;


//// [conditionalAsyncContinuation.d.ts]
interface Writer {
    write(value: number): unknown;
}
export declare function record(writer: Writer): void | Promise<void>;
export declare function loop(writer: Writer, count: number): void | Promise<void>;
export declare const arrow: (writer: Writer) => void | Promise<void>;
export declare class Method {
    write(value: number): unknown;
    run(): void | Promise<void>;
}
export declare function capture(writer: Writer): void | Promise<void>;
export declare function value(writer: Writer): unknown;
export declare const __conditionalContinue = 1;
export {};
