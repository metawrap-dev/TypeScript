# Request for comments: conditional async and await

## The problem

Buffered code often performs many small operations that complete immediately
in memory. Only occasionally does the buffer fill and require an asynchronous
flush. A useful API therefore returns `void | Promise<void>`: no Promise when
the write fits, and a Promise when the caller must wait for flushing before
continuing. Similar patterns occur with cached values and composable stream
processing.

Today, preserving the synchronous path at each call site means repeatedly
introducing temporary variables and conditional awaits. For example, inside
an ordinary async function, writing the parts of a record becomes:

```ts
const headerResult = buffer.write(header);
if (headerResult) await headerResult;

const payloadResult = buffer.write(payload);
if (payloadResult) await payloadResult;

const trailerResult = buffer.write(trailer);
if (trailerResult) await trailerResult;
```

This check is appropriate for the specific `void | Promise<void>` contract;
general value-or-thenable APIs need a proper thenable check instead. The
temporary variables avoid evaluating each operation twice, but repeating
`const temp = ...; if (temp) await temp` throughout a pipeline is painful and
ugly. It buries the sequence of actual work under bookkeeping and makes every
new operation another opportunity to forget the completion check.

Writing `await buffer.write(...)` is concise, but introduces a suspension even
when the result is `undefined`. Writing conditional awaits manually avoids
those suspensions, yet an ordinary async enclosing function still always
returns a Promise. Preserving synchronous completion through several layers
requires further branching, explicit continuations, or a generator runner.

The proposed spelling makes the intended sequence visible:

```ts
await? buffer.write(header);
await? buffer.write(payload);
await? buffer.write(trailer);
```

Inside an `async?` function, these operations can complete synchronously all
the way back to its caller, or return a Promise when an actual suspension is
needed. The aim is to express a deliberately mixed completion contract once,
without duplicating the synchronous and asynchronous algorithms or scattering
temporary-variable checks through every layer. This changes observable timing;
it is not a transparent replacement for ordinary async/await.

## What feedback we are asking for

This document is a **request for comments**, backed by an experimental compiler
implementation so the semantics and emitted code can be examined and tested.
The design is open to revision. We want feedback on:

- Whether buffered writes, caching, and similar workloads justify this syntax
  rather than ordinary async functions, manual branching, or library helpers.
- Whether `async?` and `await?` communicate conditional completion clearly,
  and whether a different spelling or contract would be easier to reason about.
- Whether the specified timing, reentrancy, error, and thenable behavior is
  acceptable, and which concrete examples reveal unsafe or surprising behavior.
- Whether the types, declarations, generated code, and tooling constraints
  make this useful in practice, and what implementation cases we have missed.
- Measurements on real workloads, including comparisons with hand-written
  branching, ordinary async/await, and alternative library approaches.

The historical-objections section below records both our mitigations and the
tradeoffs that remain. We are asking reviewers to evaluate those tradeoffs,
not assuming that an implementation resolves the language-design objections.

## Proposed behavior

This experimental compiler fork adds adjacent `async?` and `await?` suffixes.
It is based on microsoft/TypeScript main at
`6ad8c56f9b5a9bb910046c56059296311adc24ba`.

```ts
async? function write(events: Event[]): void | Promise<void> {
    for (const event of events) {
        await? buffer.write(event)
    }
}

const result = write(events)
// result is undefined when the whole operation completes synchronously,
// or a Promise<void> once a thenable requires suspension.
```

`await? expression` evaluates the operand once. It checks callable `then`
on objects and functions; a plain value continues immediately without a
microtask boundary. A thenable suspends execution and its fulfillment or
rejection resumes the surrounding function. The `then` getter is read once
for that await operation, and a thenable method receives its original receiver.

`async?` supports function declarations, expressions, arrows, and class and
object methods. The body starts synchronously and continues synchronously
through plain conditional awaits. On the first actual suspension, the call
returns a native promise. Later plain conditional awaits also continue without
adding a suspension. A regular `await` always suspends, including when its
operand is a plain value.

An exception before suspension is thrown synchronously. An exception after
suspension rejects the returned promise. `try`, `catch`, and `finally` retain
their normal control flow. A returned thenable is assimilated to a native
promise, even when no await was reached. The function's parameter defaults
execute synchronously as part of starting the body.

The checker conservatively infers `Awaited<T> | Promise<Awaited<T>>`
(or `void | Promise<void>`).
It does not try to prove that a particular path never suspends. An explicit
return annotation must accept both synchronous and asynchronous completion.
Declaration emit removes the modifier and exposes that union to consumers;
consumers of the generated declarations do not need this fork.

`await?` also works inside ordinary async functions and async generators, and
at the top level of modules with the same target/module restrictions as normal
await. Ordinary async functions continue to return promises. `async?` generators
are rejected because this extension does not define a conditional iterator API;
use ordinary `async function*` for them.

The emitter lowers conditional functions through generators and a small runner,
using TypeScript's existing preservation of lexical bindings and control flow.
The synchronous path allocates a generator and small yield/probe records, but
allocates no promise and introduces no microtask. This is a semantic fast path;
there is no claim that generator lowering is faster than hand-written branching.

The new helpers are emitted inline even with `--importHelpers`, because released
tslib packages do not supply them. `--noEmitHelpers` suppresses them and requires
the application to supply equivalent helpers. Source AST printing preserves the
suffixes; emitted JavaScript contains standard JavaScript only.

## ES2022 code generation

These examples were compiled with this fork using `--target es2022`.
The declaration supplies the type of a separately implemented buffer writer;
it produces no JavaScript. Formatting below matches the compiler output.

```ts
declare function writeChunk(chunk: string): void | Promise<void>;

async? function writeAll(chunks: string[]): void | Promise<void> {
    for (const chunk of chunks) {
        await? writeChunk(chunk);
    }
}

async function ordinaryAsync(chunk: string): Promise<void> {
    await? writeChunk(chunk);
}
```

The emitted functions (the leading `"use strict"` is omitted):

```js
function writeAll(chunks) {
    return __conditionalAwaiter(this, void 0, void 0, function* () {
        for (const chunk of chunks) {
            yield [true, __conditionalAwait(writeChunk(chunk))];
        }
    });
}
async function ordinaryAsync(chunk) {
    var _a;
    (_a = __conditionalAwait(writeChunk(chunk)), _a[1] ? await _a[1] : _a[0]);
}
```

The compiler emits these helpers once per output file when needed:

```js
var __conditionalAwait = (this && this.__conditionalAwait) || function (value) {
    var then = value !== null && (typeof value === "object" || typeof value === "function") ? value.then : void 0;
    return [value, typeof then === "function" ? { then: function (resolve, reject) { Reflect.apply(then, value, [resolve, reject]); } } : null];
};
var __conditionalAwaiter = (this && this.__conditionalAwaiter) || function (thisArg, _arguments, P, generator) {
    function step(result) {
        while (!result.done) {
            var packet = result.value;
            if (packet[0] && !packet[1][1]) {
                result = generator.next(packet[1][0]);
                continue;
            }
            return Promise.resolve(packet[0] ? packet[1][1] : packet[1]).then(
                function (value) { return step(generator.next(value)); },
                function (error) { return step(generator["throw"](error)); }
            );
        }
        var completion = __conditionalAwait(result.value);
        return completion[1] ? Promise.resolve(completion[1]) : completion[0];
    }
    return step((generator = generator.apply(thisArg, _arguments || [])).next());
};
```

`__conditionalAwait` returns a probe containing the value and either a
thenable wrapper or `null`. Each generator yield transfers control to the
runner; it does not itself enqueue a microtask. The runner resumes plain
values immediately in a loop. A thenable switches to a Promise continuation.
The `true` packet flag marks a conditional await; ordinary awaits take the
unconditional suspension branch. Return values are also checked for thenables.
The generated `ordinaryAsync` remains native async at this target and always
returns a Promise, even when its conditional await does not suspend.

This output is standard ES2022 JavaScript. Older supported targets use the
existing async transform where necessary; this example does not promise ES5
support. The `P` helper parameter is currently unused.

## Historical objections and our response

Research checked on 2026-10-09. The sources below include the original
2019 `await?` discussion, a related committee discussion of mixed returns,
and a newer conditional-iteration discussion. These are distinct proposals.
The 2019 author abandoned the discussion; these sources do not establish a
formal TC39 vote rejecting this exact `async?` / `await?` design. A working
compiler fork also does not establish committee acceptance.

### Sources

- [H1: Conditional await, anyone? (October 2019)](https://esdiscuss.org/topic/conditional-await-anyone): Gus Caplan, Tab Atkins Jr., Dan Peddle, Isiah Meadows, and Andrea Giammarchi discuss scheduling, use cases, and syntax cost.
- [H2: TC39 April 2, 2020 notes, Atomics.waitAsync discussion](https://github.com/tc39/notes/blob/main/meetings/2020-03/april-2.md): delegates discuss predictable Promise contracts, tagged containers, and typing. This is related API-design evidence, not an `await?` decision.
- [H3: for await? .. of (2025–2026)](https://es.discourse.group/t/for-await-of/2452): Jordan Harband raises mixed-return concerns; Isaac Schlueter distinguishes callback timing from inspectable completion values. The author later reports a concurrent iterator-request flaw.
- [H4: TypeScript Design Goals](https://github.com/microsoft/TypeScript/wiki/TypeScript-Design-Goals): upstream favors ECMAScript alignment, preserving JavaScript behavior, and avoiding new expression syntax and runtime functionality.

The historical concerns are summarized below. Mitigations describe this
fork's implementation and documentation; the status column deliberately
separates implemented protection from accepted or unresolved tradeoffs.

| Serious objection | What we did | Status / remaining limitation |
| --- | --- | --- |
| **Observable scheduling changes** (H1): skipping an await changes interleaving, so it cannot be a transparent optimization. | Added explicit adjacent suffixes; ordinary `await` still suspends and ordinary `async` still returns a Promise. Runtime tests check both plain and promised paths and forced ordinary awaits. | **Mitigated, not eliminated.** `await?` intentionally changes timing, including inside ordinary async functions. It is a semantic choice, not an optimization hint. |
| **Reentrancy and cache-dependent order** (H1, H3): work after a conditional await can happen before or after the caller continues. | Expose the mixed completion contract in declarations; document order below; normalize actual thenables through native Promise jobs rather than invoking their callbacks inline. | **Accepted tradeoff.** Plain paths still run inline. Review locks, callbacks, initialization, and shared state on both paths. Use the deferred adapter below where consistent entry timing matters. |
| **Mixed return contracts and hard typing** (H2, H3): consumers can assume a Promise or miss deferred completion. | Conservatively infer `Awaited<T> \| Promise<Awaited<T>>`, require explicit annotations to allow both arms, and emit ordinary union-return declarations. Tests cover generics, nested Promise types, `void`, and invalid annotations. | **Mitigated.** Callers must consume completion; direct `.then` / `.catch` on the union is invalid. Types do not enforce waiting or describe effects. |
| **Unclear use case / extra syntax for existing patterns** (H1): manual branching or a generator runner can already do this. | Target buffered writes: most events fit in memory, occasional flushes return a Promise. The emitter centralizes the generator/thenable machinery so each call site can express sequencing once. | **Unresolved language-design judgment.** This reduces boilerplate, not expressive capability; ordinary async or manual branching remains appropriate for many APIs. |
| **Confusing meaning and insufficient performance evidence** (H1, H3): shorthand may obscure semantic cost. | Publish actual emitted code, explicit timing/error contracts, and allocation tests. The synchronous runner uses iteration rather than recursive resumption; tests process 100,000 plain awaits. | **Partly mitigated.** There is no engine benchmark proving a net speedup. Generator/probe allocations, code size, and Promise normalization cost remain; benchmark the real workload before adoption. |
| **Nonstandard runtime syntax conflicts with TypeScript policy** (H4). | Keep this an experimental fork. Emit standard JavaScript and erasable union declarations, with no type-directed runtime branching. Ordinary-source async baselines remain unchanged in the focused suite. | **Unresolved upstream/tooling objection.** This is not an ECMAScript standard or an upstream TypeScript feature. Stock parsers, formatters, linters, and source-executing runtimes need support; declarations alone do not fix source compatibility. |
| **Conditional iterators need concurrency semantics** (H3). | Reject `async? function*`; retain ordinary async generators and ordinary `for await`. Their existing Promise/iteration contracts are not replaced. | **Scoped out.** No `for await?` or conditional iterator protocol is implemented. Independent calls still require application-level concurrency control. |

### Implementation risks checked alongside the historical concerns

The following are our engineering audit, not claims that every item was
raised in the historical threads.

| Risk | Implemented mitigation and evidence | Remaining limit |
| --- | --- | --- |
| **Thenable detection is observable and can be hostile.** | Evaluate the operand once; read `then` once per probe on objects/functions; require it to be callable; preserve its receiver using `Reflect.apply`. Tests cover getters, callable thenables, foreign-realm Promises, overridden `.call`, nested resolution, repeated settlement, rejection, and thrown `then` methods. | Getter/proxy side effects remain observable. Return assimilation is a separate probe, so returning a plain object after awaiting it may read its `then` again. This does not inspect whether a Promise is already fulfilled: all thenables suspend. |
| **Exceptions switch between throws and rejections.** | Throw before suspension; use Promise rejection after suspension. Generator control flow preserves `try`/`catch`/`finally`; tests cover getter failures, synchronous body errors, rejected inputs, and cleanup. | A bare `.catch` cannot catch a synchronous call failure. Use `try { await operation() }` or the adapter below. This intentionally differs from ordinary async's rejection-only body-error contract. |
| **Losing lexical bindings or evaluation order during lowering.** | Reuse the compiler's async transformation infrastructure. Tests cover arrows, methods, `this`, `arguments`, `super`, computed access, defaults/rest parameters, nested functions, and ordered loop execution across five targets. | This is focused regression coverage, not proof of correctness for every program. No promise of native async stack stitching or debugger presentation; source-map/debugger behavior needs a dedicated audit. |
| **Starvation and unbounded synchronous work.** | Use an iterative runner so a long series of plain awaits does not recursively grow the stack. Authors can insert ordinary `await` explicitly. | No automatic fairness budget. `await Promise.resolve()` yields to microtasks but does not guarantee timers/I/O run; use a host task-scheduling primitive when that is required. |
| **Helper and intrinsic compatibility.** | Generate collision-safe names, and emit helpers inline even with `--importHelpers`; tests exercise helper-name collisions and CommonJS without tslib. | `--noEmitHelpers` requires equivalent helpers. The implementation uses ambient `Promise.resolve`, `.then`, and `Reflect.apply`; it does not provide intrinsic hardening against monkey-patching or exact native-await microtask counts. No cancellation mechanism is added. |
| **Grammar ambiguity and misleading `?` semantics.** | Require adjacency and recognize conditional async only in supported function forms. Parser/runtime tests retain `async?1:2` as a ternary and cover arrows, expressions, and methods. | `await?` is not null-conditional access: `null` and `undefined` are ordinary synchronous values, and rejected thenables still throw/reject. Third-party syntax tooling remains unsupported. |

### Timing and safe API boundaries

```ts
async? function mark(value: number | PromiseLike<number>, log: string[]) {
    log.push("before");
    await? value;
    log.push("after");
}

const plainLog: string[] = [];
const plain = mark(1, plainLog);
plainLog.push("caller");
// plain is undefined; plainLog is ["before", "after", "caller"].

const promisedLog: string[] = [];
const promised = mark(Promise.resolve(1), promisedLog);
promisedLog.push("caller");
// Before completion: ["before", "caller"].
await promised;
// After completion: ["before", "caller", "after"].
```

Where a public API needs a Promise-only result, uniformly deferred body entry,
and rejection-only errors, adapt at that boundary:

```ts
function writeAllDeferred(chunks: string[]): Promise<void> {
    return Promise.resolve().then(() => writeAll(chunks));
}
```

The `.then` callback delays calling `writeAll` and captures its synchronous
throws as rejections. `Promise.resolve(writeAll(chunks))` would normalize its
return value but would neither defer its body nor catch a synchronous throw.
An ordinary async wrapper also normalizes return/errors, but calling its body
still begins synchronously. Consumers can use standard `try`/`await`/`catch`:

```ts
const chunks = ["first", "second"];
try {
    await writeAll(chunks);
} catch (error) {
    // Handles both a synchronous call failure and a rejected completion.
}
```

Use conditional operations only when both completion paths are part of the
API contract and measurements justify them. None of the above asserts that
changing every ordinary `await` to `await?` is behavior-preserving.

## Build and test

Prerequisites: Go 1.27 and Node.js 24.

```sh
go build -o ./tsgo ./tsc/cmd/tsc
./tsgo --target es2022 example.ts
TSGO_BINARY="$PWD/tsgo" node --test tools/tests/conditional-async/runtime.test.mjs
go -C tsc test ./internal/parser ./internal/printer ./internal/checker
go -C tsc test ./internal/testrunner -run 'TestLocal/(conditionalAsyncAwait|async.*|await.*|forAwait.*)'
```

The runtime suite compiles and runs five output targets and checks native
top-level conditional await. The compiler baseline suite covers syntax,
declaration output, inference, annotations, and errors. The existing async
baselines are retained unchanged.
