# Buffered-write benchmark

This benchmark compares eight spellings/implementations of the same ordered
buffer writes, compiled by the fork to ES2022 CommonJS and run on Node:

1. Ordinary `async` with an unconditional `await` at every write.
2. Ordinary `async` with `const pending = write(...); if (pending) await pending`.
3. Ordinary `async` with `await?` at every write.
4. `async?` with `await?` at every write.
5. A hand-written synchronous loop with `.then(resume)` continuations on flushes.
6. LazyPromise `fromGen` / `yield* fromEager` at every write.
7. LazyPromise generators with explicit pending checks before yielding.
8. LazyPromise `fromEager` around the hand-written continuation strategy.

The manual checks rely on this benchmark's precise `void | Promise<void>`
contract. They do not implement the generic thenable probing of `await?`.
The fifth strategy preserves synchronous returns without either new keyword;
its layered variant illustrates the extra continuation boilerplate required.

Each trial writes 100,000 records, three 16-byte writes per record (300,000
writes / 4,800,000 bytes). The flat layout performs all writes in one function.
The layered layout calls a separate three-write record function 100,000 times,
consuming each completion before starting the next record. Both layouts run:

- **Memory:** buffer large enough for the entire input; no flush. This measures
  completion in memory, not durable output.
- **Microtask:** 64 KiB buffer; each flush completes in `queueMicrotask`. This
  isolates scheduling overhead; it does not write to an external sink.
- **File:** 64 KiB buffer flushed with awaited `FileHandle.write` calls. Partial
  writes are handled, and the buffer is not reused until completion. File open,
  close, reading, and validation are outside the timer. No `fsync` is requested;
  writes may complete into OS caches. This is not a physical-disk throughput test.

All strategies use the same DataView writes and guard against buffer reuse
while a flush is pending. Each trial verifies write and byte counts and that
no flush remains pending. Memory trials check the stored event indices; file
trials verify every 32-bit field of every record, after timing. Every periodic
scenario includes draining the final partial buffer: 73 full flushes and one
partial flush for the default workload. Setup/allocation of the main buffer,
compilation, and verification are outside timing. Writer-created allocations,
Promise/generator overhead, garbage collection, and waiting for flushes are
inside timing. All returned completions are consumed.

## Reproduce

From the repository root:

```sh
npm ci --ignore-scripts --prefix tools/benchmarks/conditional-async
go build -o ./tsgo ./tsc/cmd/tsc
TSGO_BINARY="$PWD/tsgo" node tools/benchmarks/conditional-async/run.mjs results-run-1.json
TSGO_BINARY="$PWD/tsgo" node tools/benchmarks/conditional-async/run.mjs results-run-2.json
TSGO_BINARY="$PWD/tsgo" node tools/benchmarks/conditional-async/run.mjs results-run-3.json
node tools/benchmarks/conditional-async/summarize.mjs results-run-1.json results-run-2.json results-run-3.json
```

`BENCH_RECORDS`, `BENCH_SAMPLES`, and `BENCH_WARMUPS` override the defaults
100000, 9, and 3. The runner rotates strategy order each round. Each process
warms up every strategy three times per scenario, then records nine timed
samples. Three fresh processes produce 27 samples per strategy/scenario; the
summary pools all samples and reports the median plus full min/max ranges.
No samples are discarded, CPU affinity is not pinned, and GC is not forced.

The checked-in results were collected on 2026-10-09, Node v24.19.0 / V8
13.6.233.17-node.51, Linux x64, Intel Xeon Platinum 8573C, nine exposed logical
CPUs, and an overlay filesystem. The compiler implementation is the code
published in commit e3d0bc7a439b46a50127f709dabe27e8805fb656 (later changes before
measurement only altered documentation/tests). Both native ordinary async and
conditional output use the same target/compiler. The source code of the actual
workload is [writers.ts](writers.ts); the byte writer and measurement harness
are [run.mjs](run.mjs).

[Run 1](results-run-1.json), [run 2](results-run-2.json), and
[run 3](results-run-3.json) contain all raw measurements and environment
metadata. [results-summary.json](results-summary.json) contains the pooled
statistics and is reproducible with [summarize.mjs](summarize.mjs).

These measurements test this transpiler prototype, not a hypothetical native
engine implementation. There is substantial variation in the shared execution
environment; ratios of pooled medians are descriptive, not confidence bounds.
The data does not establish browser behavior, production storage throughput,
or a universal speedup. In particular, the current `async?` generator lowering
is substantially slower for many tiny record functions. No emitter optimization
was made or hidden to obtain these results.

## Optimized lowering follow-up

`optimized-run-1.json`, `optimized-run-2.json`, and `optimized-run-3.json` use the
same workload and settings after moving conditional probes before generator
yields, eliminating plain-value probe arrays, discarding unused await values,
and skipping return probing for actual `undefined`. `optimized-summary.json`
pools their 27 samples per case. The original results remain unchanged.

Run the commands above with `optimized-run-N.json` output paths, then pass those
three paths to `summarize.mjs` to reproduce the follow-up summary. Read the RFC's
follow-up section for all-strategy tables and shared-environment limitations.
Tests separately check that these changes preserve void and value completion,
thenable/rejection behavior, and output ordering.

## Direct continuation follow-up

`continuation-run-{1,2,3}.json` and `continuation-summary.json` use the unchanged
workload after direct continuation generation was added for the record function
and the flat/outer for loops. Both paths are selected by source syntax, retain
generic thenable handling, and emit no generators. Other source shapes retain
the optimized generator fallback. Use those output paths with the reproduction
commands above; pass all three paths to `summarize.mjs`. The earlier batches are
retained, and the RFC reports all strategies from each batch separately.

The manual sync continuation strategy explicitly resumes ordinary control flow
via `pending.then(resume)` only on a flush. It relies on undefined/native-Promise
results and is not a full implementation of the proposal's thenable semantics.

## Delayed callback follow-up

`lazy-run-{1,2,3}.json` and `lazy-summary.json` repeat the same workload after
short sequences (up to four awaits) were changed to inline synchronous work and
create callbacks only inside thenable branches. Supported loops run inline
until their first suspension, then create and reuse one resume callback. Larger
sequences retain shared continuations to bound output size. Use these paths with
the same reproduction commands. The RFC retains all prior measurement batches
and reports the latest all-strategy tables, raw ranges, and code-size tradeoff.
Compilation and runtime correctness checks completed before these measurement runs.

## LazyPromise comparison

The library linked by [lazypromise.com](https://lazypromise.com/) is
`@lazy-promise/core`, not the unrelated `lazypromise` npm package. The isolated
benchmark package pins version **0.0.46**, including a lockfile. Run:

```sh
npm ci --ignore-scripts --prefix tools/benchmarks/conditional-async
TSGO_BINARY="$PWD/tsgo" node --test tools/benchmarks/conditional-async/comparison.test.mjs
TSGO_BINARY="$PWD/tsgo" node tools/benchmarks/conditional-async/run.mjs tools/benchmarks/conditional-async/lazypromise-run-1.json
TSGO_BINARY="$PWD/tsgo" node tools/benchmarks/conditional-async/run.mjs tools/benchmarks/conditional-async/lazypromise-run-2.json
TSGO_BINARY="$PWD/tsgo" node tools/benchmarks/conditional-async/run.mjs tools/benchmarks/conditional-async/lazypromise-run-3.json
node tools/benchmarks/conditional-async/summarize.mjs tools/benchmarks/conditional-async/lazypromise-run-{1,2,3}.json > tools/benchmarks/conditional-async/lazypromise-summary.json
```

[lazy-writers.mjs](lazy-writers.mjs) uses the published library's documented
[generator syntax](https://lazypromise.com/generator-syntax/) and
[native-Promise interop](https://lazypromise.com/interop-with-native-promises/).
Its three variants distinguish expressive generator sequencing, generator
sequencing with explicit sync checks, and a thin adapter around fully manual
continuations. The adapter retains all the hand-written sequencing boilerplate;
it is an efficient library baseline, not a generator-syntax result.

Each operation is constructed and subscribed once **inside the timer**. Native
flush promises are unchanged. `consumeLazy` starts the subscription immediately,
returns undefined if it settles inline, and only allocates a waiting native
Promise when necessary. Calling `toEager()` or using ordinary await for every
LazyPromise would conceal its synchronous completion capability. Reported
`synchronousCompletion` means that the entire subscribed workload finished
before that boundary returned; the LazyPromise object itself is always returned
by the library strategy, unlike the conditional function's void/Promise result.

The comparison tests verify immediate completion, ordered writes, backpressure,
repeated flushes, failures before and after suspension, and lazy versus eager
entry. Cancellation, typed errors, dependency injection, tracing, resubscription,
and arbitrary thenables are outside this native-flush workload. LazyPromise
supports features beyond this proposal: these are not interchangeable API
contracts. Conditional functions execute when called; LazyPromise executes when
subscribed and exposes errors through its rejection sink. The test adapter
rethrows a synchronous sink error solely to consume both strategies uniformly.
No general Promise/A+ or library conformance claim is made.

`lazypromise-run-{1,2,3}.json` and `lazypromise-summary.json` contain the new
same-batch measurements (27 samples per case); previous batches remain intact.
