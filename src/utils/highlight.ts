import * as vscode from 'vscode';

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

    // Create new highlight
    const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        isWholeLine: true,
    });

    const range = new vscode.Range(line - 1, 0, line - 1, 0);
    editor.setDecorations(decorationType, [range]);

    // Scroll to the line
    editor.selection = new vscode.Selection(line - 1, 0, line - 1, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

    currentHighlight = decorationType;
} 