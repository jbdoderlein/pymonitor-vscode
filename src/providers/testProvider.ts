import * as vscode from 'vscode';
import { FunctionData, StackTraceResponse } from '../types';
import { getWebviewContent } from '../utils/webview';
import { highlightLine, clearHighlight } from '../utils/highlight';
import { state, debugLog } from '../services/state';
import { stat } from 'fs';

export class NodeDependenciesProvider implements vscode.TreeDataProvider<LineInfo|LineContent> {
  constructor(private workspaceRoot: string) {}

  getTreeItem(element: LineInfo|LineContent): vscode.TreeItem {
    return element;
  }

  getChildren(element?: LineInfo|LineContent): Thenable<(LineInfo|LineContent)[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage('No dependency in empty workspace');
      return Promise.resolve([]);
    }
    
    if (element) { // Expand a dependency to show its own dependencies
        if (element instanceof LineInfo && element.locals) {
            const children = Object.entries(element.locals || {}).map(([key, value]) => {
                return new LineContent(`${key} = ${value.value}`, vscode.TreeItemCollapsibleState.None);
            });
            return Promise.resolve(children);
        }
    } else { // Root level: show dependencies from workspace package.json
        let currentStackTraceData = state.currentStackTraceData;
      if (currentStackTraceData) {
        const items = currentStackTraceData.frames.map((frame) => {
            return new LineInfo(frame.line, frame.locals, frame.globals, vscode.TreeItemCollapsibleState.Collapsed);
        });
        return Promise.resolve(items);
      }
          return Promise.resolve([
            new LineInfo(-1, null, null, vscode.TreeItemCollapsibleState.None)
        ]);
      }
    return Promise.resolve([]);
    }

    private _onDidChangeTreeData: vscode.EventEmitter<LineInfo | LineContent | undefined | null | void> = new vscode.EventEmitter<LineInfo | LineContent | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<LineInfo | LineContent | undefined | null | void> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}

export class LineInfo extends vscode.TreeItem {
  constructor(
    public readonly line: number,
    public readonly locals: Record<string, {
        value: string;
        type: string;
    }> | null,
    public readonly globals: Record<string, {
        value: string;
        type: string;
    }> | null,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    if (line === -1) {
        super(`No stack trace available`, collapsibleState);
        this.tooltip = `No stack trace available`;
        this.description = '';
        return;
    }
    super(`Line ${line}`, collapsibleState);
    this.tooltip = `${this.label}`;
    this.description = '';
    this.contextValue = 'lineInfoItem';
  }
}

class LineContent extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.tooltip = `${this.label}`;
    this.description = '';
  }
}