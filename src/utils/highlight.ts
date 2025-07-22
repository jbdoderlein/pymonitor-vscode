import * as vscode from 'vscode';
import { state } from '../services/state';

let currentHighlight: vscode.TextEditorDecorationType | null = null;

/**
 * Highlight a line in the editor
 * @param editor - The text editor to highlight in
 * @param line - The line number to highlight (1-based)
 * @param moveCursor - Whether to move the cursor to the line (default: false)
 */
export function highlightLine(editor: vscode.TextEditor, line: number, moveCursor: boolean = false) {
    // Remove previous highlight if any
    if (currentHighlight) {
        currentHighlight.dispose();
        currentHighlight = null;
    }

    // Create new highlight with a distinct color (different from debugger yellow)
    const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editorInfo.background'), // Light blue background
        borderColor: new vscode.ThemeColor('editorInfo.foreground'),      // Blue border
        borderStyle: 'solid',
        borderWidth: '0 0 0 3px',  // Slightly thicker border for visibility
        isWholeLine: true,
    });

    const range = new vscode.Range(line - 1, 0, line - 1, 0);
    editor.setDecorations(decorationType, [range]);

    // Only move cursor and scroll if explicitly requested
    // if (moveCursor) {
    //     // Set flag to prevent selection change event from triggering
    //     state.isProgrammaticSelectionChange = true;
        
    //     // Scroll to the line
    //     editor.selection = new vscode.Selection(line - 1, 0, line - 1, 0);
    //     editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        
    //     // Reset flag after a short delay
    //     setTimeout(() => {
    //         state.isProgrammaticSelectionChange = false;
    //     }, 100);
    // }

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