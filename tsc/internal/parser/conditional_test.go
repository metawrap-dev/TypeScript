package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"strings"
	"testing"
)

func TestConditionalAsyncSyntax(t *testing.T) {
	t.Parallel()
	source := `export default async? function f(value: unknown) { return await? value; }
const a = async? (x: unknown) => await? x;
const b = async? x => await? x;
const c = async? function(x: unknown) { return await? x; };
class C { static async? m(x: unknown) { return await? x; } }
const o = { async? m(x: unknown) { return await? x; } };
const async = true; const ternary = async?1:2;`
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.ts"}, source, core.ScriptKindTS)
	if len(file.Diagnostics()) != 0 {
		t.Fatalf("unexpected parse diagnostics: %v", file.Diagnostics())
	}
	modifiers, awaits := 0, 0
	var walk ast.Visitor
	walk = func(node *ast.Node) bool {
		if node.Flags&ast.NodeFlagsConditional != 0 {
			switch node.Kind {
			case ast.KindAsyncKeyword:
				modifiers++
			case ast.KindAwaitExpression:
				awaits++
			default:
				t.Fatalf("conditional flag on unexpected kind %v", node.Kind)
			}
		}
		node.ForEachChild(walk)
		return false
	}
	walk(file.AsNode())
	if modifiers != 6 || awaits != 6 {
		t.Fatalf("got %d modifiers and %d awaits", modifiers, awaits)
	}
	if file.AsNode().SubtreeFacts()&ast.SubtreeContainsConditionalAsync == 0 {
		t.Fatal("missing subtree fact")
	}
	p := printer.NewPrinter(printer.PrinterOptions{}, printer.PrintHandlers{}, nil)
	printed := p.EmitSourceFile(file)
	if strings.Count(printed, "async?") != 6 || strings.Count(printed, "await?") != 6 {
		t.Fatalf("suffixes lost by AST printer:\n%s", printed)
	}
}
