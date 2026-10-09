# Conditional async compiler tests

Build and run from the repository root:

```sh
go build -o ./tsgo ./tsc/cmd/tsc
TSGO_BINARY="$PWD/tsgo" node --test tools/tests/conditional-async/runtime.test.mjs
go -C tsc test ./internal/testrunner -run 'TestLocal/conditionalAsync'
```

The runtime suite compiles the fixtures for ES2015, ES2016, ES2017, ES2022,
and ESNext, then runs the output. It exercises synchronous scheduling,
thenables, rejection and getter errors, forced suspension, lexical bindings,
methods, default/rest parameters, for-await, ordinary async functions and
async generators, and top-level conditional await with imported helpers.
Compiler baselines separately cover inferred and annotated return types,
declaration emission, and rejected annotations and conditional generators.

Direct continuation tests cover every write's suspension position, value
ignoring, synchronous/async error timing, thenable probing and receiver binding,
method this, loop increment timing and shadowing, generated names and helper
collisions, source Promise shadowing, no Promise allocation on the synchronous
path, and fallback for captured iteration bindings. Compiler baselines cover
both continuation and generator output across four targets.
