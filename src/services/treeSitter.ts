import * as vscode from 'vscode';
import { debugLog } from './state';
import { Tree } from 'tree-sitter';
import Parser from 'tree-sitter';
import PythonParser from 'tree-sitter-python';
const parser = new Parser();
parser.setLanguage(PythonParser as any); // Type assertion to bypass type error

/**
 * Interface for function information
 */
export interface FunctionInfo {
    name: string;
    range: vscode.Range;
    params: string[];
    docstring?: string;
}

/**
 * Parse a Python file and extract function definitions using regex
 */
export function parsePythonFile(document: vscode.TextDocument): FunctionInfo[] {
    const sourceCode = document.getText();
    const functions: FunctionInfo[] = [];
    const tree : Tree = parser.parse(sourceCode);
    const root = tree.rootNode;

    // Find function definitions
    const functionNodes = root.descendantsOfType('function_definition');

    for (const node of functionNodes) {
        const functionName = node.child(1)?.text;
        const functionParamsList = node.child(2);
        const functionParams = functionParamsList?.children
        .filter(param => param.type === 'identifier' || param.type === 'argument')
        .map(param => param.text);
        
        if (!functionName || !functionParams) {
            continue;
        }

        const functionRange = new vscode.Range(
            document.positionAt(node.startIndex),
            document.positionAt(node.endIndex)
        );

        const functionInfo: FunctionInfo = {
            name: functionName,
            range: functionRange,
            params: functionParams.map(param => param.trim())
        };

        functions.push(functionInfo);
    }
    return functions;
} 