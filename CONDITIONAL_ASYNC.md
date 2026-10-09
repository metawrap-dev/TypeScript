# Conditional async and await

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

The checker conservatively infers `T | Promise<T>` (or `void | Promise<void>`).
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
