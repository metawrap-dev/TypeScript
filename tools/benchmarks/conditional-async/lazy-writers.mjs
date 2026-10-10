import { fromEager, fromGen } from '@lazy-promise/core';

// Keep native promises only at the underlying flush boundary. Each subscription
// executes exactly once; generator syntax is the library's async/await analogue.
function lazyRecord(buffer, i) {
    return fromGen(function* () {
        yield* fromEager(() => buffer.write(i * 3));
        yield* fromEager(() => buffer.write(i * 3 + 1));
        yield* fromEager(() => buffer.write(i * 3 + 2));
    });
}
export function lazyGenerator(buffer, records) {
    return fromGen(function* () {
        for (let i = 0; i < records * 3; i++) yield* fromEager(() => buffer.write(i));
    });
}
export function layeredLazyGenerator(buffer, records) {
    return fromGen(function* () {
        for (let i = 0; i < records; i++) yield* lazyRecord(buffer, i);
    });
}

// Also measure a library adapter around the existing hand-optimized continuation
// workload. This retains manual bookkeeping; it is not the generator syntax.
export function lazyManualAdapter(manual) {
    return (buffer, records) => fromEager(() => manual(buffer, records));
}

// Start and consume a single subscription inside the timed region. Do not call
// toEager() unconditionally: that would erase synchronous completion. Allocate
// a native waiting promise only if subscribe() has not already settled.
export function consumeLazy(completion) {
    let settled = false;
    let failed = false;
    let failure;
    let resolvePending;
    let rejectPending;
    const subscription = completion.subscribe({
        resolve() { settled = true; resolvePending?.(); },
        reject(error) { settled = true; failed = true; failure = error; rejectPending?.(error); },
    });
    if (settled) {
        subscription.dispose();
        if (failed) throw failure;
        return;
    }
    return new Promise((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
    }).finally(() => subscription.dispose());
}

// Avoid wrapping/yielding synchronous writes, at the cost of the same explicit
// pending-value checks that motivate await?. Still use fromGen for sequencing.
function checkedLazyRecord(buffer, i) {
    return fromGen(function* () {
        for (let part = 0; part < 3; part++) {
            const pending = buffer.write(i * 3 + part);
            if (pending) yield* fromEager(() => pending);
        }
    });
}
export function lazyCheckedGenerator(buffer, records) {
    return fromGen(function* () {
        for (let i = 0; i < records * 3; i++) {
            const pending = buffer.write(i);
            if (pending) yield* fromEager(() => pending);
        }
    });
}
export function layeredLazyCheckedGenerator(buffer, records) {
    return fromGen(function* () {
        for (let i = 0; i < records; i++) yield* checkedLazyRecord(buffer, i);
    });
}
