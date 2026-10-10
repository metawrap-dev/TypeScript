# Request for comments: conditional async and await

## TL;DR / Summary

This is a **request for comments on an experimental TypeScript fork**. Buffered
writes usually complete immediately and occasionally need an asynchronous flush.
Repeated `const temp = ...; if (temp) await temp` checks are painful and ugly;
`await?` expresses that sequencing directly. `async?` preserves synchronous
completion through the calling layers, returning a Promise only when needed.

**Latest measurements — layered buffered writer:** 100,000 records, 300,000
writes, 4.8 MB; pooled medians of 27 samples across three fresh Node processes.
The same latest batch is used for every entry. Lower times are better.

| Implementation | Memory, no flush | Microtask flushes | File writes |
| --- | ---: | ---: | ---: |
| ordinary `async` + `await` | 30.75 ms | 29.75 ms | 43.25 ms |
| ordinary `async` + manual checks | 11.40 ms | 9.30 ms | 17.05 ms |
| ordinary `async` + `await?` | 25.97 ms | 24.28 ms | 34.49 ms |
| **`async?` + `await?`** | 6.56 ms | 6.07 ms | 12.94 ms |
| manual synchronous continuations | 4.58 ms | 4.50 ms | 11.11 ms |
| LazyPromise generator | 184.55 ms | 184.71 ms | 205.00 ms |
| LazyPromise generator + pending checks | 125.57 ms | 122.32 ms | 139.12 ms |
| LazyPromise manual continuation adapter | 7.14 ms | 8.16 ms | 14.64 ms |
| RxJS Observable sequencing (`expand`) | 970.63 ms | 940.00 ms | 935.61 ms |
| RxJS sequencing + pending checks | 877.57 ms | 874.03 ms | 901.72 ms |
| RxJS manual continuation adapter | 4.58 ms | 4.35 ms | 12.06 ms |

This batch includes **RxJS 7.8.2** and **`@lazy-promise/core` 0.0.46**.
Their operator/generator flows are slower than the supported direct-continuation
compiler output for these tiny writes. Both libraries can preserve synchronous
completion; RxJS's manual continuation adapter is competitive and faster in
memory, while retaining the manual sequencing code. This does not establish a
universal winner or require new syntax to achieve synchronous completion.

Supported short sequences and `for` loops create continuation callbacks only
when they suspend; larger sequences use shared callbacks, and complex bodies
retain a generator fallback. This is a working prototype, **not an ECMAScript
standard or an upstream TypeScript feature**.

Measured on Node v24.19.0, targeting ES2022, on 2026-10-10. These synthetic
results vary in a shared environment; file writes omit `fsync`. They do not
predict native-engine performance or establish statistical equivalence. See
[the full latest results and tradeoffs](#rxjs-and-lazypromise-comparison)
for both layouts, earlier comparisons, raw samples, and limitations.

## RxJS and LazyPromise comparison

All **eleven strategies** above were measured together on the same workload:
100,000 records, 300,000 small writes, 4.8 MB; three fresh Node processes, three
warmups and nine samples per case in each, with rotated strategy order. No
compiler changes were made for this batch. Earlier batches remain below.

**Flat writer — pooled medians:**

| Implementation | Memory, no flush | Microtask flushes | File writes |
| --- | ---: | ---: | ---: |
| ordinary `async` + `await` | 18.26 ms | 17.54 ms | 29.31 ms |
| ordinary `async` + manual checks | 4.25 ms | 3.13 ms | 10.97 ms |
| ordinary `async` + `await?` | 5.49 ms | 3.75 ms | 10.59 ms |
| **`async?` + `await?`** | 4.81 ms | 3.92 ms | 18.20 ms |
| manual synchronous continuations | 3.94 ms | 2.36 ms | 10.40 ms |
| LazyPromise generator | 41.29 ms | 43.60 ms | 66.46 ms |
| LazyPromise generator + pending checks | 5.60 ms | 4.88 ms | 17.74 ms |
| LazyPromise manual continuation adapter | 2.93 ms | 2.78 ms | 14.50 ms |
| RxJS Observable sequencing (`expand`) | 484.66 ms | 513.44 ms | 713.75 ms |
| RxJS sequencing + pending checks | 429.40 ms | 477.79 ms | 673.87 ms |
| RxJS manual continuation adapter | 2.44 ms | 2.54 ms | 9.50 ms |

The RxJS comparison uses the published library and implements three alternatives:

- **Observable sequencing:** `defer` creates cold write operations and `expand`
  with concurrency one requests the next write after completion. The layered
  form has nested three-write record flows. This avoids a synchronous
  `range`/`concatMap` source enqueuing the entire workload during a flush.
- **Pending checks:** calls each write directly, then selects `from(pending)`
  for a flush or `EMPTY` for synchronous completion, avoiding a per-write
  `defer` wrapper while retaining RxJS sequencing.
- **Manual adapter:** `defer` wraps the existing hand-written synchronous
  continuation algorithm. This is a competitive library baseline but retains
  the explicit resume code; it is not an operator-sequencing result.

`defaultIfEmpty` advances completion-only operations, and `ignoreElements` makes
only overall completion significant. `observeOn(queueScheduler)` prevents
recursive stack growth after suspension. Without a delay, that scheduler runs
synchronously: it adds neither a native microtask nor a timer to plain writes.
Its scheduling and subscription costs are included in the measurements.

The harness constructs and subscribes each flow once **inside the timer** and
consumes its `complete`/`error` notifications. It returns inline on synchronous
completion and allocates a native waiting Promise only if pending. Unconditionally
using `firstValueFrom` or `lastValueFrom` would conceal this capability. Native
flush promises, buffer sizes, stored bytes, and output validation are unchanged.

The shared comparison suite now passes **48 tests**, including completion modes,
ordered writes, repeated flush backpressure, synchronous failures and rejected
flushes, and lazy subscription entry. Four RxJS cases process 15,000 writes after
an initial suspension to check stack safety. All 66 timed cases contain 27 samples.

These are different API contracts: conditional functions start at the call;
RxJS Observables and LazyPromise flows start at subscription. Library errors
are delivered through error/rejection notifications; the harness converts these
to throw/reject solely for uniform consumption. RxJS supports multiple emissions
and rich stream operators; those features, cancellation, memory usage, and
resubscription are outside this benchmark. Unsubscribing from a Promise-backed
Observable does not cancel its underlying native file write. The operator flows
perform additional per-write work; that structural observation is not a CPU
profile or a general claim about RxJS performance.

**Variation is substantial.** No samples were discarded. For layered memory,
ordinary async/await ranges from 24.59 to 1,171.85 ms, conditional functions from
5.04 to 9.98 ms, and RxJS Observable sequencing from 767.43 to 9,083.22 ms.
Pooled medians describe this synthetic shared-environment batch, not statistical
confidence or universal speedups. File writes omit `fsync` and may use OS caches.
Benchmark a real application before choosing syntax or a library from these results.

- [RxJS implementations](tools/benchmarks/conditional-async/rx-writers.mjs),
  [comparison tests](tools/benchmarks/conditional-async/comparison.test.mjs), and
  [reproduction commands](tools/benchmarks/conditional-async/README.md#rxjs-comparison).
- [Run 1](tools/benchmarks/conditional-async/rxjs-run-1.json),
  [run 2](tools/benchmarks/conditional-async/rxjs-run-2.json),
  [run 3](tools/benchmarks/conditional-async/rxjs-run-3.json), and
  [pooled medians, full ranges, and sample counts](tools/benchmarks/conditional-async/rxjs-summary.json).
- Primary references: [expand](https://rxjs.dev/api/index/function/expand),
  [defer](https://rxjs.dev/api/index/function/defer),
  [queueScheduler](https://rxjs.dev/api/index/const/queueScheduler), and
  [RxJS 7.8.2 source](https://github.com/ReactiveX/rxjs/tree/7.8.2).

## LazyPromise comparison

This earlier eight-strategy batch predates the RxJS comparison above.

The comparison uses the same 100,000 records / 300,000 writes / 4.8 MB workload,
with all eight strategies measured together: three fresh processes, nine samples
per case per process, three warmups, and rotated order. No compiler changes were
made for this batch. Earlier result batches are retained below; compare strategies
within a batch rather than attributing cross-batch differences to implementation.

**Flat writer — pooled medians:**

| Implementation | Memory, no flush | Microtask flushes | File writes |
| --- | ---: | ---: | ---: |
| ordinary `async` + `await` | 16.96 ms | 17.27 ms | 22.50 ms |
| ordinary `async` + manual checks | 2.39 ms | 3.31 ms | 8.35 ms |
| ordinary `async` + `await?` | 3.46 ms | 3.66 ms | 9.43 ms |
| **`async?` + `await?`** | 3.33 ms | 3.68 ms | 9.88 ms |
| manual synchronous continuations | 2.47 ms | 2.34 ms | 7.44 ms |
| LazyPromise generator | 37.10 ms | 39.11 ms | 45.92 ms |
| LazyPromise generator + pending checks | 3.05 ms | 4.09 ms | 9.37 ms |
| LazyPromise manual continuation adapter | 2.15 ms | 2.30 ms | 7.46 ms |

The full layered results for this eight-strategy batch are in the linked summary
JSON. The latest summary above also includes RxJS. Each trial checks byte counts, flush
counts, buffer reuse, and stored output. Tests also compare synchronous completion,
ordering through repeated asynchronous flushes, and failures before/after suspension.

The library comparison implements three useful alternatives:

- **Generator:** `fromGen(function* () { yield* fromEager(() => write(...)); })`,
  including a nested three-write record generator in the layered layout.
- **Checked generator:** only yields when `const pending = write(...)` returns a
  Promise. This avoids wrapping and yielding synchronous writes but requires
  explicit checks. Layered records still use nested generator subscriptions.
- **Manual adapter:** `fromEager(() => manualContinuation(...))`, preserving the
  hand-written continuation algorithm. This provides an efficient library baseline
  while retaining the bookkeeping that conditional syntax aims to remove.

All LazyPromise workloads are constructed and subscribed once inside the timer;
subscription starts immediately. The harness returns inline on synchronous
settlement and allocates a native waiting Promise only for pending completion.
It does not normalize every LazyPromise through `toEager()` or ordinary `await`,
which would hide the library's synchronous completion. Native flush promises and
byte-writing logic are identical across strategies.

LazyPromise is a viable library alternative for synchronous notification, with
additional cancellation and typed-error capabilities. Its generator flow also
creates wrappers, generators, and subscriptions while sequencing operations; our
supported short functions/loops instead emit direct continuations. These are
structural differences, not a CPU-profile attribution. The optimized library
variants show why timing the straight generator spelling alone would be incomplete.

The APIs have different contracts: `async?` starts when called and returns a plain
value or Promise; LazyPromise returns an object, starts on subscription, and can
execute again on another subscription. Errors are delivered to its rejection sink.
Our test adapter rethrows inline rejection to consume both implementations uniformly;
that adapter is not a claim that LazyPromise itself throws like `async?`. Cancellation,
tracing, dependency injection, resubscription, and generic thenable behavior are
outside this native-flush comparison. File writes omit `fsync`; shared-environment
variation and OS caching apply to all rows. These numbers do not predict production
or browser performance, or a hypothetical native conditional-await implementation.

Sources and reproducibility:

- [Library source](https://github.com/lazy-promise/lazy-promise),
  [generator syntax](https://lazypromise.com/generator-syntax/), and
  [native Promise interop](https://lazypromise.com/interop-with-native-promises/).
- [Comparison implementations](tools/benchmarks/conditional-async/lazy-writers.mjs),
  [shared behavioral tests](tools/benchmarks/conditional-async/comparison.test.mjs), and
  [installation and reproduction commands](tools/benchmarks/conditional-async/README.md#lazypromise-comparison).
- [Run 1](tools/benchmarks/conditional-async/lazypromise-run-1.json),
  [run 2](tools/benchmarks/conditional-async/lazypromise-run-2.json),
  [run 3](tools/benchmarks/conditional-async/lazypromise-run-3.json), and
  [pooled medians, full ranges, and sample counts](tools/benchmarks/conditional-async/lazypromise-summary.json).

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

## Buffered-write measurements: benefits and prototype costs

We measured the motivating pattern rather than assuming that prettier syntax
must produce faster code. **Skipping unconditional awaits helps, but tiny
layered `async?` functions expose substantial generator overhead.** The original
results below motivated a lowering optimization; the follow-up measurements
and explanation immediately after these tables describe the updated output.

**Latest result: delaying callback creation reduces layered in-memory `async?`
from 9.00 ms to 6.04 ms.** In the same new batch, ordinary async/await takes
27.52 ms and manual continuations take 5.94 ms. The generated and manual
in-memory medians are now within about 2%; this is not a statistical equivalence
claim. The complete latest tables and earlier batches below show the gains,
remaining costs, and variation.

“Manual sync continuation” is hand-written JavaScript control flow: run ordinary
calls and loops while results are `undefined`; when a write returns a Promise,
return `pending.then(resume)` to continue after flushing. It creates no generator
and does not suspend for synchronous writes. The layered version has explicit
payload/trailer callbacks. This benchmark implementation assumes its precise
`void | Promise<void>` contract, whereas the compiler must handle arbitrary
thenables, getter effects, and error timing.

Each trial writes **100,000 records / 300,000 small writes / 4.8 MB**. Periodic
scenarios flush a **64 KiB buffer** (73 full flushes plus one final partial
flush). The microtask sink isolates scheduling overhead; the file sink actually
writes and verifies the complete output, without `fsync`. The in-memory case
fits the entire input in its buffer and does not flush.

**Flat writer:** one function loops over all writes. Lower times are better;
entries are pooled medians of **27 samples across three fresh Node processes**.

| Implementation | In memory, no flush | Microtask flushes | File writes |
| --- | ---: | ---: | ---: |
| ordinary async + await | 20.35 ms | 19.08 ms | 27.33 ms |
| ordinary async + manual checks | 2.35 ms | 3.51 ms | 10.56 ms |
| ordinary async + await? | 4.06 ms | 5.07 ms | 11.94 ms |
| async? + await? | 14.65 ms | 15.46 ms | 22.44 ms |
| manual sync continuation | 2.64 ms | 2.46 ms | 9.75 ms |

**Layered writer:** the outer loop calls a separate header/payload/trailer
function for each record. Every variant waits for completion where required;
the byte sequence and total work are identical to the flat case.

| Implementation | In memory, no flush | Microtask flushes | File writes |
| --- | ---: | ---: | ---: |
| ordinary async + await | 35.81 ms | 35.90 ms | 48.00 ms |
| ordinary async + manual checks | 10.64 ms | 10.77 ms | 19.31 ms |
| ordinary async + await? | 27.72 ms | 30.75 ms | 40.96 ms |
| async? + await? | 155.06 ms | 150.89 ms | 179.01 ms |
| manual sync continuation | 7.14 ms | 6.40 ms | 15.77 ms |

In the flat in-memory case, ordinary `async` plus `await?` took **4.06 ms**
versus **20.35 ms** for unconditional awaits, about **5.0× less elapsed time**.
The existing manual checks were faster still at **2.35 ms**. `async?` plus
`await?` took **14.65 ms**, offering synchronous return semantics at a higher
cost than manual continuation code (**2.64 ms**).

The layered in-memory case is the clearest current limitation: `async?` plus
`await?` took **155.06 ms**, about **4.3× the elapsed time** of ordinary
async/await (**35.81 ms**). It was also slower in both layered flush scenarios.
This is consistent with substantial generator/runner/probe overhead for tiny
functions; these measurements do not isolate the cost of each component.
Ordinary async record functions still return Promises even with `await?`, so
conditional awaiting at the outer layer cannot make that path synchronous.

These original results support the motivation to avoid needless suspension and repeated
checks, while identifying **efficient conditional-function lowering as an open
implementation problem**. The manual continuation variant shows that the
synchronous contract is feasible with existing JavaScript; the proposed syntax
makes that control flow easier to author, but the original lowering did not
match its performance. Only `async?` and the manual continuation variant
returned `undefined` synchronously in the no-flush trials; all strategies
returned a Promise when a flush was required. The variants therefore share
ordered output, not identical scheduling/API contracts.

Measured on **2026-10-09**, Node **v24.19.0**, V8 **13.6.233.17-node.51**,
Linux x64, Intel Xeon Platinum 8573C, with nine exposed logical CPUs and an
overlay filesystem. Output target: **ES2022 CommonJS**, with all variants
compiled by the same fork. Each process used three warmup rounds and nine
measurement rounds per strategy/scenario, rotating order. Compilation, buffer
setup, file open/close, and output verification were outside the timer; final
flushes, allocations by the writers, GC, and completion waits were inside.

This shared environment has substantial sample variation. For example,
layered `async?` microtask trials ranged from **131.01 to 300.63 ms**; we kept
all samples. The file results include OS caching and do not measure durable
physical-disk throughput. These are synthetic buffered-writing workloads,
not a browser benchmark, a full application workload, or a prediction of native
engine performance. We request independent replications and workload-specific
measurements, especially for alternative lowerings.

See [benchmark source, method, and reproduction commands](tools/benchmarks/conditional-async/README.md),
[all raw runs](tools/benchmarks/conditional-async/results-run-1.json),
[run 2](tools/benchmarks/conditional-async/results-run-2.json),
[run 3](tools/benchmarks/conditional-async/results-run-3.json), and
[pooled medians and ranges](tools/benchmarks/conditional-async/results-summary.json).

### Why layering costs more, and what we improved

The layered writer writes the same bytes, but calls a three-write record function
100,000 times instead of doing all writes inside one function. In the original
conditional output, **each record call constructed a generator function, a
generator object, and a runner closure**. Every plain `await?` still created a
probe array and a tagged yield packet, yielded a generator result, and called
back into `generator.next`. Three inner awaits plus one outer await meant
400,000 such yield/resume cycles even when every write returned `undefined`.
Each completed record also went through return-value probing.

This is compiler-generated work, not extra buffered output or more flushes.
The flat variant amortizes its generator setup across the whole loop; the
layered variant pays that setup per record. This explains the structural
source of the regression. We have not attributed individual milliseconds to
allocations, generator calls, JIT decisions, or garbage collection with an
allocation/CPU profile.

The updated lowering makes three changes:

- Probe before yielding. Plain conditional awaits continue inside the generator
  without a yield/resume cycle; the probe returns `null` without allocating an
  array. Thenables retain receiver-preserving wrappers and Promise assimilation.
- For a standalone `await?`, discard the result without retaining a separate
  value temporary. A value-consuming await still retains its plain result.
- At completion, return immediately for `undefined`; no completion probe or
  wrapper is needed. Other return values still undergo thenable assimilation.

The runner consequently needs no tagged packets or synchronous resumption
loop. Ordinary `await` still yields unconditionally. Error timing, single operand
and getter evaluation, rejection handling, and ordered buffer reuse are preserved.

**Void handling works when applied to discarded values and actual `undefined`
completion. A static `void` annotation alone is insufficient.** TypeScript can
accept a value-returning callback where `() => void` is expected. A function
that returns that callback's result can therefore return a runtime thenable
even though the expression has static type `void`. Skipping its assimilation
would change completion and rejection behavior. Likewise, ignoring an awaited
value never licenses skipping the wait itself. The optimizations depend on
syntax and runtime values, without making type annotations change JavaScript
behavior. Tests cover discarded fulfillment/rejection and a contextual-void
callback that returns a plain value, resolved Promise, or rejected Promise.

We reran the unchanged workload in three fresh processes, pooling 27 samples
per case. The original raw results are retained separately. The following table
compares the **`async?` + `await?`** medians before and after the change; lower
is better. Speedups compare separate measurement batches, not paired trials.

| Layout / sink | Original | Updated | Original / updated |
| --- | ---: | ---: | ---: |
| flat / memory | 14.65 ms | 3.81 ms | 3.84× |
| flat / microtask | 15.46 ms | 4.68 ms | 3.30× |
| flat / file | 22.44 ms | 12.63 ms | 1.78× |
| layered / memory | 155.06 ms | 124.95 ms | 1.24× |
| layered / microtask | 150.89 ms | 111.21 ms | 1.36× |
| layered / file | 179.01 ms | 122.48 ms | 1.46× |

For comparison, these are **all strategies in the updated batch**:

**Flat writer**

| Implementation | In memory | Microtask flushes | File writes |
| --- | ---: | ---: | ---: |
| ordinary async + await | 22.71 ms | 22.74 ms | 25.93 ms |
| ordinary async + manual checks | 2.81 ms | 3.84 ms | 9.78 ms |
| ordinary async + await? | 3.06 ms | 4.63 ms | 11.07 ms |
| async? + await? | 3.81 ms | 4.68 ms | 12.63 ms |
| manual sync continuation | 3.99 ms | 3.03 ms | 8.69 ms |

**Layered writer**

| Implementation | In memory | Microtask flushes | File writes |
| --- | ---: | ---: | ---: |
| ordinary async + await | 43.83 ms | 42.79 ms | 45.87 ms |
| ordinary async + manual checks | 15.13 ms | 10.95 ms | 18.87 ms |
| ordinary async + await? | 39.45 ms | 27.08 ms | 38.84 ms |
| async? + await? | 124.95 ms | 111.21 ms | 122.48 ms |
| manual sync continuation | 6.04 ms | 6.14 ms | 16.09 ms |

The flat case improves substantially; the layered case improves but still loses
to ordinary async/await and manual continuations. Generator-function/object and
runner setup still occur per record. These results motivated the direct continuation lowering described next.
General-purpose continuation/state-machine lowering still must preserve locals,
lexical bindings, `try`/`finally`, loops, and synchronous error behavior; complex
bodies retain the generator fallback. The shared environment remains noisy: updated layered
microtask samples span 89.76–322.64 ms. Other strategies' medians also moved between
batches, so these numbers support an implementation improvement, not a precise
universal speedup. See `optimized-run-{1,2,3}.json` and `optimized-summary.json`
under `tools/benchmarks/conditional-async/` for all raw samples and ranges.

### First direct continuation generation: measurements

We now generate ordinary continuations for the benchmark's three-write record
function and ordinary resume loops for its outer/flat loops. The synchronous
path no longer constructs generator functions, generator objects, or runners.
It still uses receiver-preserving thenable probing; only actual suspension
calls the Promise continuation helper. This is the same broad execution pattern
as the manual implementation, with the proposal's broader thenable semantics.

The unchanged workload was rerun in three fresh processes, with 27 pooled
samples per case. **These are all strategies in the first direct-generation batch:**

**Flat writer**

| Implementation | In memory | Microtask flushes | File writes |
| --- | ---: | ---: | ---: |
| ordinary async + await | 23.83 ms | 20.42 ms | 25.82 ms |
| ordinary async + manual checks | 2.55 ms | 3.70 ms | 9.17 ms |
| ordinary async + await? | 3.08 ms | 4.38 ms | 10.89 ms |
| async? + await? | 3.20 ms | 4.82 ms | 10.18 ms |
| manual sync continuation | 3.45 ms | 2.66 ms | 8.20 ms |

**Layered writer**

| Implementation | In memory | Microtask flushes | File writes |
| --- | ---: | ---: | ---: |
| ordinary async + await | 30.01 ms | 27.12 ms | 34.28 ms |
| ordinary async + manual checks | 10.48 ms | 9.31 ms | 14.23 ms |
| ordinary async + await? | 25.97 ms | 21.65 ms | 30.45 ms |
| async? + await? | 9.00 ms | 6.86 ms | 12.61 ms |
| manual sync continuation | 6.44 ms | 4.71 ms | 9.17 ms |

**Layered `async?` before/after direct generation:**

| Sink | Optimized generator | Direct continuation | Generator / direct |
| --- | ---: | ---: | ---: |
| memory | 124.95 ms | 9.00 ms | 13.89× |
| microtask | 111.21 ms | 6.86 ms | 16.21× |
| file | 122.48 ms | 12.61 ms | 9.71× |

The remaining difference from manual continuations includes general thenable
probes, wrapped Promise normalization on suspension, discarded final fulfillment
handling, and differences in the generated closure/control-flow shape. We have
not separately profiled these costs, and matching handwritten code's exact
speed is not guaranteed. The flat writer was already amortizing generator
setup, so removing it yields a much smaller improvement there.

These before/after ratios compare separate batches. Other strategies moved
between batches, so the same-batch comparison is the stronger guide to relative
performance. We retained every sample, including outliers: direct layered file
trials range from 10.24 to 95.76 ms. Environment and method are unchanged;
these are synthetic Node workloads, not native-engine predictions. See
`continuation-run-{1,2,3}.json` and `continuation-summary.json` alongside the
previous results for all raw timings and ranges.

### Delayed callback creation: latest measurements

For short sequences of up to four discarded awaits, synchronous work is now
inline. Each thenable branch creates an arrow for the remaining work; the
plain branch continues inline. This duplicates suffix code across branches,
so the optimization is limited to four awaits. Longer direct sequences retain
shared callbacks to bound code size. Supported loops also start inline: the
first suspension creates one resume callback, which is reused for subsequent
flushes. Thus the motivating three-write record and its outer loop create **no
continuation closures on wholly synchronous calls**. This does not claim zero
engine allocations: activation/context storage can still cost memory.

The same workload and settings were rerun in three fresh processes, with
27 pooled samples per case and no discarded observations. **All strategies in
the latest batch:**

**Flat writer**

| Implementation | In memory | Microtask flushes | File writes |
| --- | ---: | ---: | ---: |
| ordinary async + await | 20.16 ms | 19.41 ms | 25.09 ms |
| ordinary async + manual checks | 2.44 ms | 3.82 ms | 9.54 ms |
| ordinary async + await? | 2.47 ms | 4.27 ms | 10.97 ms |
| async? + await? | 2.74 ms | 4.58 ms | 10.67 ms |
| manual sync continuation | 3.70 ms | 2.53 ms | 8.40 ms |

**Layered writer**

| Implementation | In memory | Microtask flushes | File writes |
| --- | ---: | ---: | ---: |
| ordinary async + await | 27.52 ms | 26.19 ms | 33.60 ms |
| ordinary async + manual checks | 9.54 ms | 9.33 ms | 15.23 ms |
| ordinary async + await? | 23.48 ms | 21.38 ms | 29.62 ms |
| async? + await? | 6.04 ms | 5.39 ms | 11.25 ms |
| manual sync continuation | 5.94 ms | 4.01 ms | 10.38 ms |

**`async?` before/after delayed callback creation:**

| Layout / sink | First direct output | Delayed callbacks | Change in elapsed time |
| --- | ---: | ---: | ---: |
| flat / memory | 3.20 ms | 2.74 ms | -14.5% |
| flat / microtask | 4.82 ms | 4.58 ms | -5.1% |
| flat / file | 10.18 ms | 10.67 ms | +4.8% |
| layered / memory | 9.00 ms | 6.04 ms | -32.8% |
| layered / microtask | 6.86 ms | 5.39 ms | -21.4% |
| layered / file | 12.61 ms | 11.25 ms | -10.8% |

The reduction is largest in the layered in-memory case, where every record
previously created shared continuation closures. The same-batch manual result
is now close in memory, while it remains faster with periodic flushes. The flat
file median increased slightly; this change does not win every measured case.
The before/after percentages compare separate batches and should not be read as
precise causal estimates. Other strategies also moved between batches, and
updated layered file samples span 9.44–21.50 ms. Independent replication is still
needed. All raw data and ranges are retained in `lazy-run-{1,2,3}.json` and
`lazy-summary.json` under `tools/benchmarks/conditional-async/`.

The semantics remain unchanged: operand and getter evaluation, receiver
preservation, nested thenable assimilation, discarded fulfillment, rejection,
lexical `this`, and post-fulfillment loop increments retain their behavior.
Tests cover suspension at each record write, all-thenable sequences, loop
resumption, no Promise allocation on plain paths, and the retained shared
continuation path for a five-await sequence.

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

The emitter selects direct continuations for eligible discarded-await sequences
and single-await for loops; other bodies use generators and a small runner,
using TypeScript's existing preservation of lexical bindings and control flow.
Plain conditional awaits allocate no probe/yield packets or Promise and
introduce no microtask. The fallback still allocates a generator; the direct
path uses ordinary continuations instead. Short sequences and supported loops
create callbacks only after an actual suspension is required; larger sequences
still allocate shared callbacks up front. Performance depends on
body shape and workload; the measurements above distinguish those paths.

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
        var _a;
        for (const chunk of chunks) {
            ((_a = __conditionalAwait(writeChunk(chunk))) ? yield _a : void 0);
        }
    });
}
async function ordinaryAsync(chunk) {
    var _a;
    ((_a = __conditionalAwait(writeChunk(chunk))) ? await _a : void 0);
}
```

The compiler emits these helpers once per output file when needed:

```js
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
```

`__conditionalAwait` returns a thenable wrapper or `null`, with no probe
allocation for plain values. Conditional awaits test this before yielding;
plain values run inline in the generator without involving the runner. Every
actual yield suspends through `Promise.resolve`, including ordinary awaits.
A standalone await discards its result and needs only a promise temporary;
value-consuming awaits also retain the original value for the plain branch.
Return values are checked for thenables, with an immediate `undefined` fast
path. The generated `ordinaryAsync` remains native async at this target and
always returns a Promise, even when its conditional await does not suspend.

This output is standard ES2022 JavaScript. Older supported targets use the
existing async transform where necessary; this example does not promise ES5
support. The `P` helper parameter is currently unused.

### Direct continuation output

The direct path is selected syntactically for a block containing 1–32 standalone
conditional-await statements, or a block containing one `for` loop with a
single identifier `let` initializer and a single standalone conditional await
as its body. Parameters must be simple identifiers without defaults or rest.
Nested awaits/functions/classes, direct eval, `arguments`, `super`, and
`new.target` in the relevant expressions retain the generator fallback, as do
value-consuming awaits, explicit returns, branches, `try`/`finally`, and other
loop shapes. Sequences of one to four awaits inline synchronous work and create
callbacks only on suspension branches. Their suffixes are duplicated across
branches, so this optimization is capped at four awaits to bound code growth.
Sequences of five to 32 awaits retain shared continuations; the 32-statement
limit bounds synchronous call depth. A supported loop runs inline initially,
then creates one reusable callback on its first suspension. No type annotation
changes which runtime semantics apply.

For example, this source:

```ts
declare function writeChunk(chunk: string): void | Promise<void>;
async? function writeRecord(chunks: string[]): void | Promise<void> {
    await? writeChunk(chunks[0]);
    await? writeChunk(chunks[1]);
    await? writeChunk(chunks[2]);
}
async? function writeMany(chunks: string[]): void | Promise<void> {
    for (let i = 0; i < chunks.length; i++) await? writeChunk(chunks[i]);
}
```

produces the following ES2022 output (leading `"use strict"` omitted):

```js
var __conditionalAwait = (this && this.__conditionalAwait) || function (value) {
    var then = value !== null && (typeof value === "object" || typeof value === "function") ? value.then : void 0;
    return typeof then === "function" ? { then: function (resolve, reject) { Reflect.apply(then, value, [resolve, reject]); } } : null;
};
var __conditionalContinue = (this && this.__conditionalContinue) || function (pending, resume) {
    return Promise.resolve(pending).then(resume);
};
function writeRecord(chunks) {
    const _pending_1 = __conditionalAwait(writeChunk(chunks[0]));
    if (_pending_1)
        return __conditionalContinue(_pending_1, () => {
            const _pending_4 = __conditionalAwait(writeChunk(chunks[1]));
            if (_pending_4)
                return __conditionalContinue(_pending_4, () => {
                    const _pending_6 = __conditionalAwait(writeChunk(chunks[2]));
                    if (_pending_6)
                        return __conditionalContinue(_pending_6, () => {
                        });
                });
            const _pending_5 = __conditionalAwait(writeChunk(chunks[2]));
            if (_pending_5)
                return __conditionalContinue(_pending_5, () => {
                });
        });
    const _pending_2 = __conditionalAwait(writeChunk(chunks[1]));
    if (_pending_2)
        return __conditionalContinue(_pending_2, () => {
            const _pending_7 = __conditionalAwait(writeChunk(chunks[2]));
            if (_pending_7)
                return __conditionalContinue(_pending_7, () => {
                });
        });
    const _pending_3 = __conditionalAwait(writeChunk(chunks[2]));
    if (_pending_3)
        return __conditionalContinue(_pending_3, () => {
        });
}
function writeMany(chunks) {
    {
        let i = 0;
        while (i < chunks.length) {
            const _pending_8 = __conditionalAwait(writeChunk(chunks[i]));
            if (_pending_8) {
                const _resume_1 = () => {
                    i++;
                    while (i < chunks.length) {
                        const _pending_9 = __conditionalAwait(writeChunk(chunks[i]));
                        if (_pending_9)
                            return __conditionalContinue(_pending_9, _resume_1);
                        i++;
                    }
                };
                return __conditionalContinue(_pending_8, _resume_1);
            }
            i++;
        }
    }
}
```

The empty final callback discards the last thenable's fulfillment value, while
retaining rejection. Each continuation runs only after the preceding write
completes. The short sequence creates no continuation closures when all writes
are plain; each duplicated suffix executes in only one selected branch. The
loop likewise creates no resume callback until it suspends, then reuses that
callback for later flushes. It increments after fulfillment, and synchronous
iterations use `while` rather than recursive calls. Arrow callbacks retain lexical `this`;
loop bindings keep an enclosing block scope. Throws before suspension escape
synchronously; throws in a resumed callback reject its Promise.

The `__conditionalContinue` helper remains inline under `--importHelpers` and
is collision-safe like the existing helpers. With `--noEmitHelpers`, consumers
must supply it when direct continuations are emitted. Its global helper scope
also avoids capturing a source parameter named `Promise`.

Tests cover each suspension position, discarded values, rejections, throwing
then/getters, receiver preservation, deferred then invocation, method `this`,
loop condition/increment timing, loop variable shadowing, generated-name and
helper collisions, a source parameter named `Promise`, 100,000 synchronous
iterations without Promise allocation, and fallback for captured loop bindings.

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
| **Confusing meaning and insufficient performance evidence** (H1, H3): shorthand may obscure semantic cost. | Publish actual emitted code, explicit timing/error contracts, and allocation tests. Plain awaits no longer yield or allocate probe packets; tests process 100,000 plain awaits. Discarded values and actual undefined completion have fast paths. | **Measured tradeoff.** The buffered-write results above favor conditional waits over unconditional ones in flat loops, the optimized lowering reduces overhead, but direct continuations now beat ordinary async/await in the measured layered workloads; manual continuations still win. General control flow retains generator setup, and code size and thenable normalization cost remain. Native engine performance is unmeasured; benchmark the real workload before adoption. |
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
