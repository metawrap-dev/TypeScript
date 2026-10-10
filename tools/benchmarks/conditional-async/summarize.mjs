import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const inputs = process.argv.slice(2);
const runs = (inputs.length ? inputs : [1, 2, 3].map(n => path.join(dir, `results-run-${n}.json`)))
    .map(file => JSON.parse(readFileSync(file, 'utf8')));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rows = [];
for (let scenario = 0; scenario < runs[0].results.length; scenario++) {
    const first = runs[0].results[scenario];
    for (let strategy = 0; strategy < first.rows.length; strategy++) {
        const samples = runs.flatMap(run => {
            const entry = run.results[scenario];
            if (entry.layout !== first.layout || entry.mode !== first.mode || run.writes !== runs[0].writes) throw new Error('Incompatible reports');
            if (entry.rows.length !== first.rows.length || entry.rows[strategy].strategy !== first.rows[strategy].strategy || run.lazyPromiseVersion !== runs[0].lazyPromiseVersion) throw new Error('Incompatible strategies or dependency versions');
            return entry.rows[strategy].rawMs;
        });
        rows.push({ layout: first.layout, mode: first.mode, strategy: first.rows[strategy].strategy,
            samples: samples.length, medianMs: median(samples), minMs: Math.min(...samples), maxMs: Math.max(...samples) });
    }
}
console.log(JSON.stringify({ processes: runs.length, records: runs[0].records, writes: runs[0].writes, bytes: runs[0].bytes, rows }, null, 2));
