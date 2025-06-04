import * as vscode from 'vscode';
import { parsePythonFile } from './treeSitter';
import { state, debugLog } from './state';
import { FunctionData } from '../types';

/**
 * CodeLens provider for Python functions live recording
 */
export class LiveRecCodeLensProvider implements vscode.CodeLensProvider {
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
            
            // Get function execution data from cache
            const filePath = document.uri.fsPath;
            const functionData = state.functionDataCache.get(filePath);

            if (!functionData || functionData.length === 0) {
                debugLog(`No function data found for ${filePath}`);
                return codeLenses;
            }

            // Group functions by name for easier lookup
            const functionsByName = new Map<string, FunctionData[]>();
            functionData.forEach((func: FunctionData) => {
                if (!functionsByName.has(func.function)) {
                    functionsByName.set(func.function, []);
                }
                functionsByName.get(func.function)!.push(func);
            });

            // Create a code lens for each function
            for (const func of functions) {
                const position = new vscode.Position(func.range.start.line, func.range.start.character);
                const range = new vscode.Range(position, position);

                // Get executions for this function by name
                const functionExecutions = functionsByName.get(func.name) || [];

                // Create a code lens to activate live recording for the function
                const liveRecLens = new vscode.CodeLens(range, {
                    title: `📻 Live Record ${func.name} (${functionExecutions.length})`,
                    command: 'pymonitor.startLiveRecording',
                    arguments: [document.uri, func, functionExecutions]
                });

                codeLenses.push(liveRecLens);
            }

            return codeLenses;
        } catch (error) {
            debugLog('Error providing live recording code lenses:', error);
            return [];
        }
    }
} 