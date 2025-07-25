import * as vscode from 'vscode';

export interface GraphItem {
    id: string;
    text: string;
    description?: string;
    line?: number;
    type?: 'normal' | 'current' | 'error' | 'warning';
    branch?: number; // Which branch/column this item belongs to
    connections?: {
        up?: boolean;    // Has connection going up
        down?: boolean;  // Has connection going down
        merge?: boolean; // Is a merge point
        branch?: boolean; // Is a branch point
    };
}

export interface GraphData {
    items: GraphItem[];
}

export class GraphWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'graphView';
    private _view?: vscode.WebviewView;
    private _graphData: GraphData = { items: [] };

    constructor(private readonly _extensionContext: vscode.ExtensionContext) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionContext.extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'itemClick':
                        this._onItemClick(message.itemId);
                        break;
                    case 'itemDoubleClick':
                        this._onItemDoubleClick(message.itemId);
                        break;
                    case 'ready':
                        // Webview is ready, send initial data
                        this._updateWebview();
                        break;
                }
            },
            undefined,
            this._extensionContext.subscriptions
        );
    }

    public setGraphData(data: GraphData) {
        this._graphData = data;
        this._updateWebview();
    }

    public addItem(item: GraphItem) {
        this._graphData.items.push(item);
        this._updateWebview();
    }

    public clearGraph() {
        this._graphData = { items: [] };
        this._updateWebview();
    }

    private _updateWebview() {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateGraph',
                data: this._graphData
            });
        }
    }

    private _onItemClick(itemId: string) {
        const item = this._graphData.items.find(n => n.id === itemId);
        if (item) {
            // Fire event for item click
            vscode.commands.executeCommand('graph.itemClick', item);
        }
    }

    private _onItemDoubleClick(itemId: string) {
        const item = this._graphData.items.find(n => n.id === itemId);
        if (item) {
            // Fire event for item double click
            vscode.commands.executeCommand('graph.itemDoubleClick', item);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Graph View</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background-color: var(--vscode-sideBar-background);
            color: var(--vscode-sideBar-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            overflow: hidden;
        }

        .graph-container {
            width: 100%;
            height: 100vh;
            overflow-y: auto;
            overflow-x: hidden;
        }

        .graph-item {
            display: flex;
            align-items: center;
            height: 22px;
            padding: 0;
            cursor: pointer;
            user-select: none;
            position: relative;
        }

        .graph-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .graph-item.current {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .graph-item.error {
            color: var(--vscode-errorForeground);
        }

        .graph-item.warning {
            color: var(--vscode-warningForeground);
        }

        .graph-visual {
            width: 60px;
            height: 22px;
            position: relative;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .graph-line {
            position: absolute;
            width: 2px;
            background-color: var(--vscode-gitDecoration-modifiedResourceForeground);
            left: 50%;
            transform: translateX(-50%);
        }

        .graph-line.up {
            top: 0;
            height: 11px;
        }

        .graph-line.down {
            bottom: 0;
            height: 11px;
        }

        .graph-line.full {
            top: 0;
            height: 100%;
        }

        .graph-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: var(--vscode-gitDecoration-modifiedResourceForeground);
            position: relative;
            z-index: 2;
            border: 1px solid var(--vscode-sideBar-background);
        }

        .graph-dot.current {
            background-color: var(--vscode-button-background);
            border-color: var(--vscode-button-foreground);
            width: 10px;
            height: 10px;
        }

        .graph-dot.error {
            background-color: var(--vscode-errorForeground);
        }

        .graph-dot.warning {
            background-color: var(--vscode-warningForeground);
        }

        .graph-content {
            flex: 1;
            padding-left: 8px;
            overflow: hidden;
            display: flex;
            align-items: center;
        }

        .graph-text {
            font-size: 13px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex: 1;
        }

        .graph-description {
            font-size: 11px;
            opacity: 0.7;
            margin-left: 8px;
            white-space: nowrap;
        }

        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            opacity: 0.6;
            padding: 20px;
        }

        .empty-state-text {
            font-size: 13px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }

        /* Branch lines for multiple columns */
        .graph-visual.branch-0 .graph-line { left: 20%; }
        .graph-visual.branch-1 .graph-line { left: 40%; }
        .graph-visual.branch-2 .graph-line { left: 60%; }
        .graph-visual.branch-3 .graph-line { left: 80%; }

        .graph-visual.branch-0 .graph-dot { left: 20%; transform: translateX(-50%); }
        .graph-visual.branch-1 .graph-dot { left: 40%; transform: translateX(-50%); }
        .graph-visual.branch-2 .graph-dot { left: 60%; transform: translateX(-50%); }
        .graph-visual.branch-3 .graph-dot { left: 80%; transform: translateX(-50%); }
    </style>
</head>
<body>
    <div class="graph-container" id="graph-container">
        <div id="empty-state" class="empty-state">
            <div class="empty-state-text">No graph data available</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let graphData = { items: [] };

        // Notify that webview is ready
        vscode.postMessage({ command: 'ready' });

        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateGraph':
                    graphData = message.data;
                    renderGraph();
                    break;
            }
        });

        function renderGraph() {
            const container = document.getElementById('graph-container');
            const emptyState = document.getElementById('empty-state');
            
            // Clear existing content
            container.innerHTML = '';
            
            if (!graphData.items || graphData.items.length === 0) {
                container.appendChild(emptyState);
                return;
            }

            // Render each item
            graphData.items.forEach((item, index) => {
                const itemElement = document.createElement('div');
                itemElement.className = \`graph-item \${item.type || 'normal'}\`;
                
                // Graph visual part (left side)
                const graphVisual = document.createElement('div');
                graphVisual.className = \`graph-visual branch-\${item.branch || 0}\`;
                
                // Add connecting lines
                const connections = item.connections || {};
                if (connections.up || index > 0) {
                    const upLine = document.createElement('div');
                    upLine.className = 'graph-line up';
                    graphVisual.appendChild(upLine);
                }
                
                if (connections.down || index < graphData.items.length - 1) {
                    const downLine = document.createElement('div');
                    downLine.className = 'graph-line down';
                    graphVisual.appendChild(downLine);
                }
                
                // Add the dot
                const dot = document.createElement('div');
                dot.className = \`graph-dot \${item.type || 'normal'}\`;
                graphVisual.appendChild(dot);
                
                // Content part (right side)
                const content = document.createElement('div');
                content.className = 'graph-content';
                
                const text = document.createElement('div');
                text.className = 'graph-text';
                text.textContent = item.text;
                content.appendChild(text);
                
                if (item.description) {
                    const description = document.createElement('div');
                    description.className = 'graph-description';
                    description.textContent = item.description;
                    content.appendChild(description);
                }
                
                itemElement.appendChild(graphVisual);
                itemElement.appendChild(content);
                
                // Add event listeners
                itemElement.addEventListener('click', () => {
                    vscode.postMessage({
                        command: 'itemClick',
                        itemId: item.id
                    });
                });

                itemElement.addEventListener('dblclick', () => {
                    vscode.postMessage({
                        command: 'itemDoubleClick',
                        itemId: item.id
                    });
                });
                
                container.appendChild(itemElement);
            });
        }

        // Initial render
        renderGraph();
    </script>
</body>
</html>`;
    }
}