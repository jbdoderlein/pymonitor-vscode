import * as vscode from 'vscode';
import { state } from '../services/state';

let currentHighlight: vscode.TextEditorDecorationType | null = null;

/**
 * Highlight a line in the editor
 */
export function highlightLine(editor: vscode.TextEditor, line: number) {
    // Remove previous highlight if any
    if (currentHighlight) {
        currentHighlight.dispose();
        currentHighlight = null;
    }

    // Create new highlight with a distinct color
    const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.stackFrameHighlightBackground'),
        borderColor: new vscode.ThemeColor('editorInfo.foreground'),
        borderStyle: 'solid',
        borderWidth: '0 0 0 2px',
        isWholeLine: true,
    });

    const range = new vscode.Range(line - 1, 0, line - 1, 0);
    editor.setDecorations(decorationType, [range]);

    // Set flag to prevent selection change event from triggering
    state.isProgrammaticSelectionChange = true;
    
    // Scroll to the line
    editor.selection = new vscode.Selection(line - 1, 0, line - 1, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    
    // Reset flag after a short delay
    setTimeout(() => {
        state.isProgrammaticSelectionChange = false;
    }, 100);

    currentHighlight = decorationType;
    state.currentHighlight = decorationType;
}

/**
 * Clear any existing highlight
 */
export function clearHighlight() {
    if (currentHighlight) {
        currentHighlight.dispose();
        currentHighlight = null;
    }
    
    if (state.currentHighlight) {
        state.currentHighlight.dispose();
        state.currentHighlight = null;
    }
    
    state.currentLine = null;
} 