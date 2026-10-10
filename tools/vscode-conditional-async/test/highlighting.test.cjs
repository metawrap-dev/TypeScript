const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const tm = require('vscode-textmate');
const onig = require('vscode-oniguruma');

let registry;
let plainRegistry;
before(async () => {
    const bytes = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
    await onig.loadWASM(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const options = {
        onigLib: Promise.resolve({
            createOnigScanner: patterns => new onig.OnigScanner(patterns),
            createOnigString: value => new onig.OnigString(value),
        }),
        loadGrammar: async scope => {
            const file = scope === 'source.ts' ? 'fixtures/TypeScript.tmLanguage.json'
                : scope === 'source.tsx' ? 'fixtures/TypeScriptReact.tmLanguage.json'
                : scope === 'conditional.async-await.ts' ? '../syntaxes/conditional-async.tmLanguage.json'
                : undefined;
            return file ? tm.parseRawGrammar(fs.readFileSync(path.join(__dirname, file), 'utf8'), file) : null;
        },
    };
    registry = new tm.Registry({ ...options, getInjections: scope =>
        ['source.ts', 'source.tsx'].includes(scope) ? ['conditional.async-await.ts'] : [] });
    plainRegistry = new tm.Registry(options);
});

async function tokenize(code, scope = 'source.ts', useInjection = true) {
    const grammar = await (useInjection ? registry : plainRegistry).loadGrammar(scope);
    let state = tm.INITIAL;
    return code.split('\n').flatMap((line, lineNumber) => {
        const result = grammar.tokenizeLine(line, state);
        state = result.ruleStack;
        return result.tokens.map(token => ({ line: lineNumber,
            text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes }));
    });
}

for (const scope of ['source.ts', 'source.tsx']) {
    for (const [name, code] of [
        ['declaration', 'async? function write() { await? buffer.write("hello"); }'],
        ['expression', 'const write = async? function () { await? buffer.flush(); };'],
        ['arrow', 'const write = async? () => { await? buffer.flush(); };'],
        ['multiline arrow', 'const write = async? (\n x: number\n) => { await? x; };'],
        ['typed arrow', 'const write = async? (x: string): void | Promise<void> => { await? buffer.write(x); };'],
        ['generic arrow', 'const write = async? <T,>(x: T) => { await? x; };'],
        ['single parameter arrow', 'const write = async? x => { await? x; };'],
        ['method', 'class Writer { async? write() { await? buffer.flush(); } }'],
        ['template expression', 'async? function write() { return `result: ${await? read()}`; }'],
    ]) {
        test(`${scope}: ${name}`, async () => {
            const tokens = await tokenize(code, scope);
            for (const [text, expected] of [['async?', 'storage.modifier.async.ts'], ['await?', 'keyword.control.flow.ts']]) {
                const token = tokens.find(token => token.text === text);
                assert.ok(token, `missing whole token ${text}`);
                assert.ok(token.scopes.includes(expected), `${text}: ${token.scopes.join(' ')}`);
                assert.ok(!token.scopes.includes('keyword.operator.ternary.ts'));
            }
        });
    }
    test(`${scope}: following declaration keeps its function scope`, async () => {
        const tokens = await tokenize('async? function first() {\n await? read();\n}\nconst next = 1;', scope);
        const next = tokens.find(token => token.text === 'const');
        assert.ok(next.scopes.includes(scope === 'source.tsx' ? 'storage.type.tsx' : 'storage.type.ts'));
        assert.ok(!next.scopes.includes('meta.function.expression.ts'));
    });
    test(`${scope}: ordinary code, comments, strings, regexes and optional properties unchanged`, async () => {
        const code = [
            'async function ordinary() { await read(); }',
            'const result = flag ? one : two;',
            'const text = "async? function x() { await? value; }";',
            '// async? function x() { await? value; }',
            '/* async? () => await? value */',
            'const template = `async? function x() { await? value; }`;',
            'const pattern = /async? await?/;',
            'interface Shape { async?: boolean; await?: number; async?(): void; await?(): void; await? : number; }',
            'object.async?.(); object.await?.();',
        ].join('\n');
        assert.deepEqual(await tokenize(code, scope), await tokenize(code, scope, false));
    });
}

test('TSX children and attributes are unchanged', async () => {
    const code = 'const view = <div title="async? await?">async? function x() await? value</div>;';
    assert.deepEqual(await tokenize(code, 'source.tsx'), await tokenize(code, 'source.tsx', false));
});

test('TSX expression supports conditional await', async () => {
    const tokens = await tokenize('async? function view() { return <div>{await? read()}</div>; }', 'source.tsx');
    assert.ok(tokens.find(token => token.text === 'await?')?.scopes.includes('keyword.control.flow.ts'));
});
