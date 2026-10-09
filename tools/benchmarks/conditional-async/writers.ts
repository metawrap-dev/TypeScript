export interface BufferWriter { write(value: number): void | Promise<void>; }

// Every record contains three 16-byte writes. Each strategy writes identical bytes.
export async function ordinary(buffer: BufferWriter, records: number) {
    for (let i = 0; i < records * 3; i++) await buffer.write(i);
}
export async function manualChecks(buffer: BufferWriter, records: number) {
    for (let i = 0; i < records * 3; i++) {
        const pending = buffer.write(i);
        if (pending) await pending;
    }
}
export async function conditionalAwait(buffer: BufferWriter, records: number) {
    for (let i = 0; i < records * 3; i++) await? buffer.write(i);
}
export async? function conditionalFunction(buffer: BufferWriter, records: number) {
    for (let i = 0; i < records * 3; i++) await? buffer.write(i);
}
export function manualContinuation(buffer: BufferWriter, records: number): void | Promise<void> {
    let i = 0;
    function resume(): void | Promise<void> {
        while (i < records * 3) {
            const pending = buffer.write(i++);
            if (pending) return pending.then(resume);
        }
    }
    return resume();
}

async function ordinaryRecord(buffer: BufferWriter, i: number) {
    await buffer.write(i * 3);
    await buffer.write(i * 3 + 1);
    await buffer.write(i * 3 + 2);
}
async function manualRecord(buffer: BufferWriter, i: number) {
    const header = buffer.write(i * 3);
    if (header) await header;
    const payload = buffer.write(i * 3 + 1);
    if (payload) await payload;
    const trailer = buffer.write(i * 3 + 2);
    if (trailer) await trailer;
}
async function conditionalAwaitRecord(buffer: BufferWriter, i: number) {
    await? buffer.write(i * 3);
    await? buffer.write(i * 3 + 1);
    await? buffer.write(i * 3 + 2);
}
async? function conditionalRecord(buffer: BufferWriter, i: number) {
    await? buffer.write(i * 3);
    await? buffer.write(i * 3 + 1);
    await? buffer.write(i * 3 + 2);
}
function continuationRecord(buffer: BufferWriter, i: number): void | Promise<void> {
    const header = buffer.write(i * 3);
    if (header) return header.then(payload);
    return payload();
    function payload(): void | Promise<void> {
        const pending = buffer.write(i * 3 + 1);
        if (pending) return pending.then(trailer);
        return trailer();
    }
    function trailer(): void | Promise<void> { return buffer.write(i * 3 + 2); }
}
export async function layeredOrdinary(buffer: BufferWriter, records: number) {
    for (let i = 0; i < records; i++) await ordinaryRecord(buffer, i);
}
export async function layeredManualChecks(buffer: BufferWriter, records: number) {
    for (let i = 0; i < records; i++) await manualRecord(buffer, i);
}
export async function layeredConditionalAwait(buffer: BufferWriter, records: number) {
    for (let i = 0; i < records; i++) await? conditionalAwaitRecord(buffer, i);
}
export async? function layeredConditionalFunction(buffer: BufferWriter, records: number) {
    for (let i = 0; i < records; i++) await? conditionalRecord(buffer, i);
}
export function layeredManualContinuation(buffer: BufferWriter, records: number): void | Promise<void> {
    let i = 0;
    function resume(): void | Promise<void> {
        while (i < records) {
            const pending = continuationRecord(buffer, i++);
            if (pending) return pending.then(resume);
        }
    }
    return resume();
}
