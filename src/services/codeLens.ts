import * as vscode from 'vscode';
import { FunctionData } from '../types';
import { state } from './state';

export class PyMonitorCodeLensProvider implements vscode.CodeLensProvider {
    private codeLenses: vscode.CodeLens[] = [];
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor() {
        // Refresh code lenses when function data changes
        setInterval(() => {
            this._onDidChangeCodeLenses.fire();
        }, 5000); // Refresh every 5 seconds
    }

    public refresh() {
        this._onDidChangeCodeLenses.fire();
    }

    public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        this.codeLenses = [];
        
        const filePath = document.uri.fsPath;
        const functionData = state.functionDataCache.get(filePath);
        
        if (!functionData) {
            return [];
        }

        // Group functions by line number
        const functionsByLine = new Map<number, FunctionData[]>();
        functionData.forEach((func: FunctionData) => {
            if (!functionsByLine.has(func.line)) {
                functionsByLine.set(func.line, []);
            }
            functionsByLine.get(func.line)!.push(func);
        });

        // Create code lenses for each function
        functionsByLine.forEach((funcs, line) => {
            const range = new vscode.Range(line - 1, 0, line - 1, 0);
            const command: vscode.Command = {
                command: 'pymonitor.showFunctionDetails',
                title: `📊 ${funcs.length} execution${funcs.length > 1 ? 's' : ''}`,
                arguments: [funcs]
            };
            this.codeLenses.push(new vscode.CodeLens(range, command));
        });

        return this.codeLenses;
    }
} 