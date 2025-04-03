import * as vscode from 'vscode';
import { parsePythonFile, FunctionInfo } from './treeSitter';
import { debugLog } from './state';

/**
 * CodeLens provider for Python functions debugging
 */
export class DebugFunctionCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    /**
     * Refresh code lenses
     */
    public refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    /**
     * Provide code lenses for Python functions
     */
    public provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        // Only provide code lenses for Python files
        if (document.languageId !== 'python') {
            return [];
        }

        try {
            // Parse the document to find functions
            const functions = parsePythonFile(document);
            const codeLenses: vscode.CodeLens[] = [];

            // Create a code lens for each function
            for (const func of functions) {
                const position = new vscode.Position(func.range.start.line, func.range.start.character);
                const range = new vscode.Range(position, position);

                // Create a code lens to debug the function
                const debugLens = new vscode.CodeLens(range, {
                    title: `▶ Debug ${func.name}`,
                    command: 'pymonitor.debugFunction',
                    arguments: [document.uri, func]
                });

                codeLenses.push(debugLens);
            }

            return codeLenses;
        } catch (error) {
            debugLog('Error providing code lenses:', error);
            return [];
        }
    }
} 