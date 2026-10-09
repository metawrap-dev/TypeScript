# Conditional async compiler tests

Build and run from the repository root:

```sh
go build -o ./tsgo ./tsc/cmd/tsc
TSGO_BINARY="$PWD/tsgo" node --test tools/tests/conditional-async/runtime.test.mjs
go -C tsc test ./internal/testrunner -run 'TestLocal/conditionalAsyncAwait'
```

The runtime suite compiles the fixtures for ES2015, ES2016, ES2017, ES2022,
and ESNext, then runs the output. It exercises synchronous scheduling,
thenables, rejection and getter errors, forced suspension, lexical bindings,
methods, default/rest parameters, for-await, ordinary async functions and
async generators, and top-level conditional await with imported helpers.
Compiler baselines separately cover inferred and annotated return types,
declaration emission, and rejected annotations and conditional generators.
