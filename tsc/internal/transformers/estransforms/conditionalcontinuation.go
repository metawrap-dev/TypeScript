package estransforms

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Direct continuations cover discarded conditional awaits in straight-line
// bodies and a single-await for loop. All other control flow retains the
// generator lowering. Eligibility is syntactic, never based on a void type.
func (tx *asyncTransformer) tryDirectConditionalBody(node *ast.Node) *ast.Node {
	if !tx.conditionalOnly || !tx.conditionalBody || !isSimpleParameterList(node.Parameters()) || node.Body() == nil || !ast.IsBlock(node.Body()) {
		return nil
	}
	for _, p := range node.Parameters() {
		if p.AsParameterDeclaration().DotDotDotToken != nil {
			return nil
		}
	}
	statements := node.Body().StatementList().Nodes
	if len(statements) == 1 && statements[0].Kind == ast.KindForStatement {
		return tx.tryDirectConditionalLoop(statements[0].AsForStatement())
	}
	// Bound synchronous continuation depth for very large generated bodies.
	if len(statements) == 0 || len(statements) > 32 {
		return nil
	}
	for _, statement := range statements {
		if directConditionalOperand(statement) == nil {
			return nil
		}
	}
	f := tx.Factory()
	// Each continuation shares the original parameter scope and lexical this.
	// No generator object, runner, or synchronous resumption protocol is needed.
	var declarations []*ast.Node
	var next *ast.Node
	var entry []*ast.Node
	for i := len(statements) - 1; i >= 0; i-- {
		pending := f.NewUniqueName("_pending")
		operand := tx.Visitor().VisitNode(directConditionalOperand(statements[i]))
		code := []*ast.Node{tx.directVariable(pending, f.NewConditionalAwaitHelper(operand))}
		callback := next
		if callback == nil {
			callback = tx.directArrow(nil)
		}
		code = append(code, f.NewIfStatement(pending, f.NewReturnStatement(f.NewConditionalContinueHelper(pending, callback)), nil))
		if next != nil {
			code = append(code, f.NewReturnStatement(tx.directCall(next)))
		}
		if i == 0 {
			entry = code
		} else {
			next = f.NewUniqueName("_resume")
			declarations = append(declarations, tx.directVariable(next, tx.directArrow(code)))
		}
	}
	return f.NewBlock(f.NewNodeList(append(declarations, entry...)), true)
}

func directConditionalOperand(statement *ast.Node) *ast.Node {
	if statement.Kind != ast.KindExpressionStatement {
		return nil
	}
	expression := statement.AsExpressionStatement().Expression
	if expression.Kind != ast.KindAwaitExpression || expression.Flags&ast.NodeFlagsConditional == 0 {
		return nil
	}
	operand := expression.AsAwaitExpression().Expression
	if !directContinuationExpressionSafe(operand) {
		return nil
	}
	return operand
}

// Reject constructs that can capture an iteration binding or need the existing
// lexical-arguments/super machinery. Direct eval could observe generated scopes.
func directContinuationExpressionSafe(node *ast.Node) bool {
	if node == nil {
		return true
	}
	if ast.IsFunctionLike(node) {
		return false
	}
	switch node.Kind {
	case ast.KindAwaitExpression, ast.KindYieldExpression, ast.KindSuperKeyword, ast.KindMetaProperty,
		ast.KindFunctionExpression, ast.KindArrowFunction, ast.KindClassExpression:
		return false
	case ast.KindIdentifier:
		if node.Text() == "arguments" || node.Text() == "eval" {
			return false
		}
	}
	return !node.ForEachChild(func(child *ast.Node) bool { return !directContinuationExpressionSafe(child) })
}

func (tx *asyncTransformer) tryDirectConditionalLoop(loop *ast.ForStatement) *ast.Node {
	// A lexical identifier initializer keeps the loop binding private. With no
	// nested function/eval, no per-iteration binding can escape into a closure.
	if loop.Initializer == nil || loop.Initializer.Kind != ast.KindVariableDeclarationList ||
		loop.Initializer.Flags&ast.NodeFlagsLet == 0 || loop.Condition == nil || loop.Incrementor == nil {
		return nil
	}
	list := loop.Initializer.AsVariableDeclarationList()
	if len(list.Declarations.Nodes) != 1 || !ast.IsIdentifier(list.Declarations.Nodes[0].Name()) ||
		!directContinuationExpressionSafe(list.Declarations.Nodes[0].AsVariableDeclaration().Initializer) ||
		!directContinuationExpressionSafe(loop.Condition) || !directContinuationExpressionSafe(loop.Incrementor) {
		return nil
	}
	statement := loop.Statement
	if ast.IsBlock(statement) {
		if len(statement.StatementList().Nodes) != 1 {
			return nil
		}
		statement = statement.StatementList().Nodes[0]
	}
	operand := directConditionalOperand(statement)
	if operand == nil {
		return nil
	}
	f := tx.Factory()
	resume := f.NewUniqueName("_resume")
	pending := f.NewUniqueName("_pending")
	increment := tx.Visitor().VisitNode(loop.Incrementor)
	// Increment only after fulfillment. On rejection no later write is performed.
	callback := tx.directArrow([]*ast.Node{f.NewExpressionStatement(increment), f.NewReturnStatement(tx.directCall(resume))})
	body := []*ast.Node{
		tx.directVariable(pending, f.NewConditionalAwaitHelper(tx.Visitor().VisitNode(operand))),
		f.NewIfStatement(pending, f.NewReturnStatement(f.NewConditionalContinueHelper(pending, callback)), nil),
		f.NewExpressionStatement(increment),
	}
	code := []*ast.Node{
		f.NewVariableStatement(nil, tx.Visitor().VisitNode(loop.Initializer)),
		tx.directVariable(resume, tx.directArrow([]*ast.Node{
			f.NewWhileStatement(tx.Visitor().VisitNode(loop.Condition), f.NewBlock(f.NewNodeList(body), true)),
		})),
		f.NewReturnStatement(tx.directCall(resume)),
	}
	// Retain the original for-loop's block scope, including parameter shadowing.
	return f.NewBlock(f.NewNodeList([]*ast.Node{f.NewBlock(f.NewNodeList(code), true)}), true)
}

func (tx *asyncTransformer) directVariable(name, value *ast.Node) *ast.Node {
	f := tx.Factory()
	return f.NewVariableStatement(nil, f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{
		f.NewVariableDeclaration(name, nil, nil, value),
	}), ast.NodeFlagsConst))
}
func (tx *asyncTransformer) directArrow(statements []*ast.Node) *ast.Node {
	f := tx.Factory()
	return f.NewArrowFunction(nil, nil, f.NewNodeList(nil), nil, nil, f.NewToken(ast.KindEqualsGreaterThanToken), f.NewBlock(f.NewNodeList(statements), true))
}
func (tx *asyncTransformer) directCall(expression *ast.Node) *ast.Node {
	return tx.Factory().NewCallExpression(expression, nil, nil, tx.Factory().NewNodeList(nil), 0)
}
