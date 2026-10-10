# Conditional async / await highlighting

This small VS Code extension highlights the fork's experimental `async?` and
`await?` syntax in TypeScript and TSX. Each keyword, including its `?`, uses the
existing theme scope for ordinary `async` or `await`. Function declarations,
expressions, methods and arrows keep the built-in TypeScript grammar.

This extension supplies syntax highlighting only. To get diagnostics, inference,
and navigation, use the fork's `tsgo` language server as well. Installing this
extension alone does not teach stock TypeScript the experimental syntax.

## Install

From this directory:

```sh
npm ci
npm test
npx @vscode/vsce package --no-dependencies
code --install-extension conditional-async-highlight-0.1.0.vsix
```

Reload VS Code after installation. The extension automatically applies to `.ts`,
`.mts`, `.cts`, and `.tsx` files; it does not replace the built-in language mode.
Colors depend on your theme.

For the language server, build the fork's `tsgo`, install the TypeScript 7
extension, and set `js/ts.tsdk.path` to the **directory containing `tsgo`**.
Enable `js/ts.experimental.useTsgo`. If using workspace settings, trust the
workspace and select the workspace SDK through the TypeScript version command.
Use the TypeScript 7 output channel to confirm that the selected server is this
fork rather than the bundled compiler.

## Verification

The tests use VS Code's real TextMate engine and Oniguruma with snapshots of
Microsoft's TypeScript and TSX grammars. They check the whole keyword token,
surrounding function scopes, ordinary syntax, comments, strings, template
interpolations, optional properties, and JSX text. This is tokenizer verification;
it is not an editor screenshot or an end-to-end language-server test.

The fixture grammars come from
`microsoft/vscode/extensions/typescript-basics/syntaxes`, retrieved on 2026-10-10,
and identify TypeScript-TmLanguage revision
`48f608692aa6d6ad7bd65b478187906c798234a8`. Microsoft distributes these grammars
under the MIT license; see `test/fixtures/LICENSE.txt`.
