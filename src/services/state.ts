import * as vscode from 'vscode';
import { FunctionData, StackTraceResponse } from '../types';

export interface State {
    functionDataCache: Map<string, FunctionData[]>;
    currentEditor: vscode.TextEditor | undefined;
    currentLine: number | null;
    currentStep: number;
    isInStackTraceView: boolean;
    isUpdatingTimeline: boolean;
    functionDetailsPanel: vscode.WebviewPanel | undefined;
    currentFunctionData: FunctionData[] | undefined;
    currentHighlight: vscode.TextEditorDecorationType | null;
    currentStackTraceData: StackTraceResponse | null;
    isProgrammaticSelectionChange: boolean;
}

// Create a singleton instance of the state
const state: State = {
    functionDataCache: new Map(),
    currentEditor: undefined,
    currentLine: null,
    currentStep: 0,
    isInStackTraceView: false,
    isUpdatingTimeline: false,
    functionDetailsPanel: undefined,
    currentFunctionData: undefined,
    currentHighlight: null,
    currentStackTraceData: null,
    isProgrammaticSelectionChange: false
};

export function debugLog(...args: any[]) {
    // Always log for now to help debug the webview opening issue
    console.log('[PyMonitor]', ...args);
}

export { state }; 