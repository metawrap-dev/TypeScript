import { EMPTY, defaultIfEmpty, defer, expand, from, ignoreElements, map, observeOn, of, queueScheduler } from 'rxjs';

// queueScheduler is synchronous. Trampoline step notifications so a long run
// of synchronous writes after a flush does not grow the JavaScript call stack.
function completionObservable(pending) {
    return pending ? from(pending) : EMPTY;
}
function writeObservable(buffer, value) {
    return defer(() => completionObservable(buffer.write(value)));
}
function sequence(count, operation, checked) {
    return defer(() => of(0).pipe(
        expand(index => {
            if (index === count) return EMPTY;
            const step = checked ? completionObservable(operation(index)) : operation(index);
            // Completion (including EMPTY) advances exactly once, regardless of
            // whether the underlying void flush promise emits undefined.
            return step.pipe(defaultIfEmpty(undefined), map(() => index + 1), observeOn(queueScheduler));
        }, 1),
        ignoreElements(),
    ));
}
function recordObservable(buffer, i, checked) {
    return sequence(3, part => checked ? buffer.write(i * 3 + part) : writeObservable(buffer, i * 3 + part), checked);
}
export function rxExpand(buffer, records) {
    return sequence(records * 3, value => writeObservable(buffer, value), false);
}
export function layeredRxExpand(buffer, records) {
    return sequence(records, i => recordObservable(buffer, i, false), false);
}
export function rxCheckedExpand(buffer, records) {
    return sequence(records * 3, value => buffer.write(value), true);
}
export function layeredRxCheckedExpand(buffer, records) {
    return sequence(records, i => recordObservable(buffer, i, true), false);
}
export function rxManualAdapter(manual) {
    return (buffer, records) => defer(() => completionObservable(manual(buffer, records)));
}

// Subscribe once inside the timer, observing complete rather than next: pending
// writes may emit undefined and EMPTY emits nothing. Preserve inline completion.
export function consumeObservable(completion) {
    let settled = false;
    let failed = false;
    let failure;
    let resolvePending;
    let rejectPending;
    const subscription = completion.subscribe({
        complete() { settled = true; resolvePending?.(); },
        error(error) { settled = true; failed = true; failure = error; rejectPending?.(error); },
    });
    if (settled) {
        subscription.unsubscribe();
        if (failed) throw failure;
        return;
    }
    return new Promise((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
    }).finally(() => subscription.unsubscribe());
}
