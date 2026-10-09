package ast

type FunctionFlags uint32

const (
	FunctionFlagsNormal         FunctionFlags = 0
	FunctionFlagsGenerator      FunctionFlags = 1 << 0
	FunctionFlagsAsync          FunctionFlags = 1 << 1
	FunctionFlagsInvalid        FunctionFlags = 1 << 2
	FunctionFlagsAsyncGenerator FunctionFlags = FunctionFlagsAsync | FunctionFlagsGenerator
)

func GetFunctionFlags(node *Node) FunctionFlags {
	if node == nil {
		return FunctionFlagsInvalid
	}
	data := node.BodyData()
	if data == nil {
		return FunctionFlagsInvalid
	}
	flags := FunctionFlagsNormal
	switch node.Kind {
	case KindFunctionDeclaration, KindFunctionExpression, KindMethodDeclaration:
		if data.AsteriskToken != nil {
			flags |= FunctionFlagsGenerator
		}
		fallthrough
	case KindArrowFunction:
		if HasSyntacticModifier(node, ModifierFlagsAsync) {
			flags |= FunctionFlagsAsync
		}
	}
	if data.Body == nil {
		flags |= FunctionFlagsInvalid
	}
	return flags
}

// IsConditionalAsyncFunction distinguishes async? from ordinary async functions.
func IsConditionalAsyncFunction(node *Node) bool {
	if node == nil || node.Modifiers() == nil {
		return false
	}
	for _, modifier := range node.Modifiers().Nodes {
		if modifier.Kind == KindAsyncKeyword && modifier.Flags&NodeFlagsConditional != 0 {
			return true
		}
	}
	return false
}
