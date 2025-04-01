// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { FunctionData, StackTraceResponse } from './types';
import { getFunctionData, getStackTrace, waitForServer } from './services/api';

const execAsync = promisify(exec);

let webServerProcess: ChildProcess | null = null;
let statusBarItem: vscode.StatusBarItem;
let functionDataCache: Map<string, FunctionData[]> = new Map();
let stackTracePanel: vscode.WebviewPanel | null = null;
let functionDetailsPanel: vscode.WebviewPanel | undefined = undefined;
let currentFunctionData: FunctionData[] | null = null;
let currentHighlight: vscode.TextEditorDecorationType | null = null;
let currentLine: number | null = null;
let currentEditor: vscode.TextEditor | undefined = undefined;
let currentStep: number = 0;
let extensionContext: vscode.ExtensionContext;

interface ApiResponse<T> {
	function_calls?: T[];
	total_calls?: number;
	processed_calls?: number;
	error?: string;
}

interface ObjectGraphResponse {
	nodes: Array<{
		id: string;
		type: string;
		metadata: Record<string, any>;
	}>;
	edges: Array<{
		source: string;
		target: string;
		type: string;
	}>;
	error?: string;
}

interface StackFrame {
	function: string;
	file: string;
	line: number;
}

async function startWebServer(pythonPath: string, workspaceRoot: string) {
	try {
		// Check if main.db exists
		const dbPath = path.join(workspaceRoot, 'main.db');
		if (!fs.existsSync(dbPath)) {
			console.log('No main.db found in workspace root');
			return false;
		}

		// Kill existing server if any
		if (webServerProcess) {
			webServerProcess.kill();
			webServerProcess = null;
		}

		// Start the web server in the background
		const command = `${pythonPath} -m monitoringpy.interface.web.explorer ${dbPath} --no-browser --port 5000`;
		console.log('Starting server with command:', command);
		
		webServerProcess = exec(command, { cwd: workspaceRoot });
		
		// Capture and log server output
		webServerProcess.stdout?.on('data', (data) => {
			console.log('Server stdout:', data.toString());
		});
		
		webServerProcess.stderr?.on('data', (data) => {
			console.error('Server stderr:', data.toString());
		});

		webServerProcess.unref(); // This makes the process run independently

		// Wait for server to be ready
		const serverReady = await waitForServer();
		if (!serverReady) {
			throw new Error('Server failed to start within timeout');
		}

		// Update status bar
		statusBarItem.text = "$(radio-tower) PyMonitor Server Running";
		statusBarItem.tooltip = "PyMonitor Web Server is running";
		statusBarItem.show();

		console.log('Web server started and ready');
		return true;
	} catch (error) {
		console.error('Error starting web server:', error);
		statusBarItem.text = "$(error) PyMonitor Server Error";
		statusBarItem.tooltip = "Error starting PyMonitor server";
		statusBarItem.show();
		return false;
	}
}

async function checkMonitoringPy(pythonPath: string): Promise<boolean> {
	try {
		console.log(`Attempting to import monitoringpy using: ${pythonPath}`);
		const { stdout } = await execAsync(`${pythonPath} -c "import monitoringpy; print('monitoringpy version:', monitoringpy.__version__)"`);
		console.log('Import successful:', stdout);
		return true;
	} catch (error) {
		console.error('Import failed:', error);
		return false;
	}
}

async function retryFetch(url: string, maxRetries: number = 3): Promise<Response> {
	for (let i = 0; i < maxRetries; i++) {
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			return response;
		} catch (error) {
			if (i === maxRetries - 1) {
				throw error;
			}
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
	}
	throw new Error('Max retries reached');
}

async function getObjectGraph(): Promise<ObjectGraphResponse | null> {
	try {
		const response = await retryFetch('http://localhost:5000/api/object-graph');
		const data = await response.json() as ObjectGraphResponse;
		if (data.error) {
			throw new Error(data.error);
		}
		return data;
	} catch (error) {
		console.error('Error fetching object graph:', error);
		return null;
	}
}

async function checkPythonEnvironment() {
	console.log('Checking Python environment...');
	
	// Get Python extension
	const pythonExtension = vscode.extensions.getExtension('ms-python.python');
	if (!pythonExtension) {
		console.error('Error: Python extension not found!');
		vscode.window.showErrorMessage('Python extension not found!');
		return false;
	}

	try {
		// Wait for Python extension to be ready
		if (!pythonExtension.isActive) {
			console.log('Waiting for Python extension to activate...');
			await pythonExtension.activate();
		}

		// Get the Python interpreter path from the Python extension
		const executionDetails = await pythonExtension.exports.settings.getExecutionDetails();
		console.log('Python execution details:', executionDetails);
		
		// The executable path is in the execCommand array
		const pythonPath = executionDetails.execCommand[0];
		if (!pythonPath) {
			throw new Error('No Python executable found in execution details');
		}

		console.log(`Using Python interpreter: ${pythonPath}`);
		
		// Verify Python is working
		try {
			const { stdout } = await execAsync(`${pythonPath} --version`);
			console.log('Python version:', stdout);
		} catch (error) {
			console.error('Error getting Python version:', error);
			throw error;
		}
		
		const hasMonitoringPy = await checkMonitoringPy(pythonPath);
		if (!hasMonitoringPy) {
			const message = 'monitoringpy package is not installed. Please install it using: pip install monitoringpy';
			console.warn(message);
			vscode.window.showWarningMessage(message);
			return false;
		}

		// Get workspace root
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		if (!workspaceRoot) {
			throw new Error('No workspace folder found');
		}

		// Start web server if main.db exists
		const serverStarted = await startWebServer(pythonPath, workspaceRoot);
		if (!serverStarted) {
			console.log('Web server not started - no main.db found');
			return false;
		}

		return true;
	} catch (error) {
		const errorMessage = `Error checking monitoringpy: ${error}`;
		console.error(errorMessage);
		vscode.window.showErrorMessage(errorMessage);
		return false;
	}
}

class PyMonitorCodeLensProvider implements vscode.CodeLensProvider {
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
		const functionData = functionDataCache.get(filePath);
		
		if (!functionData) {
			return [];
		}

		// Group functions by line number
		const functionsByLine = new Map<number, FunctionData[]>();
		functionData.forEach(func => {
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

async function showFunctionDetails(functions: FunctionData[]) {
	currentFunctionData = functions;
	
	// Store the current editor when first opening the panel
	if (!functionDetailsPanel) {
		currentEditor = vscode.window.activeTextEditor;
	}
	
	if (functionDetailsPanel) {
		// Update existing panel
		functionDetailsPanel.title = 'Function Details';
		updateFunctionDetailsPanel(functions);
		functionDetailsPanel.reveal(vscode.ViewColumn.Beside);
	} else {
		// Create new panel
		functionDetailsPanel = vscode.window.createWebviewPanel(
			'functionDetails',
			'Function Details',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionContext.extensionUri, 'dist', 'webview')],
				retainContextWhenHidden: true
			}
		);

		// Add message handler for the panel
		functionDetailsPanel.webview.onDidReceiveMessage(async message => {
			if (message.command === 'exploreStackTrace') {
				console.log('Received stack trace exploration request for function:', message.functionId);
				const functionId = message.functionId;
				const functionData = functions.find(f => f.id === functionId);
				if (functionData) {
					await exploreStackTrace(functionId);
				}
			} else if (message.command === 'backToFunctions' && currentFunctionData) {
				// Remove highlight when going back to function list
				if (currentHighlight) {
					currentHighlight.dispose();
					currentHighlight = null;
					currentLine = null;
				}
				updateFunctionDetailsPanel(currentFunctionData);
			} else if (message.command === 'updateLine') {
				// Handle line updates from the timeline
				console.log('Received line update request:', message.line);
				console.log('Current editor:', currentEditor);
				if (currentEditor) {
					highlightLine(currentEditor, message.line);
				}
			} else if (message.command === 'sliderChange' && functionDetailsPanel) {
				// Handle slider changes
				currentStep = message.value;
				functionDetailsPanel.webview.postMessage({
					command: 'updateStep',
					step: currentStep
				});
			} else if (message.command === 'prevStep' && functionDetailsPanel) {
				// Handle previous button click
				if (currentStep > 0) {
					currentStep--;
					functionDetailsPanel.webview.postMessage({
						command: 'updateStep',
						step: currentStep
					});
				}
			} else if (message.command === 'nextStep' && functionDetailsPanel) {
				// Handle next button click
				const maxStep = parseInt(functionDetailsPanel.webview.html.match(/max="(\d+)"/)?.[1] || '0');
				if (currentStep < maxStep) {
					currentStep++;
					functionDetailsPanel.webview.postMessage({
						command: 'updateStep',
						step: currentStep
					});
				}
			}
		});

		updateFunctionDetailsPanel(functions);
		functionDetailsPanel.reveal(vscode.ViewColumn.Beside);
	}
}

function updateFunctionDetailsPanel(functions: FunctionData[]) {
	if (!functionDetailsPanel) {
		return;
	}

	// Get the webview content
	const htmlContent = getWebviewContent(functionDetailsPanel.webview, 'html/functionDetails.html');
	
	// Generate the function cards content
	const content = functions.map(func => `
		<div class="function-card">
			<div class="function-header">
				<h3>${func.function}</h3>
				<span class="line-number">Line ${func.line}</span>
			</div>
			<div class="time-info">
				<div>Start: ${new Date(func.start_time).toLocaleString()}</div>
				<div>End: ${new Date(func.end_time).toLocaleString()}</div>
			</div>
			<div class="section">
				<h4>Local Variables</h4>
				<div class="variables-grid">
					${Object.entries(func.locals).map(([name, data]) => `
						<div class="variable-card">
							<div class="variable-name">${name}</div>
							<div class="variable-type">${data.type}</div>
							<div class="variable-value">${data.value}</div>
						</div>
					`).join('')}
				</div>
			</div>
			<div class="section">
				<h4>Return Value</h4>
				<div class="variables-grid">
					<div class="variable-card">
						<div class="variable-name">return</div>
						<div class="variable-type">${func.return_value.type}</div>
						<div class="variable-value">${func.return_value.value}</div>
					</div>
				</div>
			</div>
			<div class="section">
				<h4>Stack Trace</h4>
				<div class="stack-trace">
					<button class="explore-stack-trace" data-function-id="${func.id}">
						<span class="codicon codicon-debug"></span> Explore Stack Trace
					</button>
				</div>
			</div>
		</div>
	`).join('');

	// Replace the content placeholder in the template
	const finalHtml = htmlContent.replace('<div id="content"></div>', `<div id="content">${content}</div>`);
	
	// Set the panel HTML
	functionDetailsPanel.webview.html = finalHtml;
}

async function exploreStackTrace(functionId: string) {
	try {
		const data = await getStackTrace(functionId);
		if (!data) {
			vscode.window.showErrorMessage('Failed to fetch stack trace data');
			return;
		}

		// Reset step counter
		currentStep = 0;

		if (!functionDetailsPanel) {
			return;
		}

		// Get the webview content
		const htmlContent = getWebviewContent(functionDetailsPanel.webview, 'html/stackTrace.html');
		
		// Generate the stack trace content
		const content = `
			<div class="stack-trace-container">
				<div class="header">
					<h3>${data.function_name}</h3>
					<div class="file-info">${data.file}:${data.line}</div>
				</div>
				<div class="timeline">
					<h4>Execution Timeline</h4>
					<div class="timeline-controls">
						<button class="timeline-button" id="prevButton" ${data.snapshots.length <= 1 ? 'disabled' : ''}>
							<span class="codicon codicon-chevron-left"></span> Previous
						</button>
						<div class="timeline-slider">
							<input type="range" 
								   id="timelineSlider" 
								   min="0" 
								   max="${data.snapshots.length - 1}" 
								   value="0"
								   step="1">
							<div class="timeline-info">
								Step <span id="currentStep">1</span> of ${data.snapshots.length}
							</div>
						</div>
						<button class="timeline-button" id="nextButton" ${data.snapshots.length <= 1 ? 'disabled' : ''}>
							Next <span class="codicon codicon-chevron-right"></span>
						</button>
					</div>
					<div id="currentFrame" class="frame">
						<div class="frame-header">
							<span class="frame-line">Line ${data.snapshots[0].line}</span>
							<span class="frame-time">${new Date(data.snapshots[0].timestamp).toLocaleTimeString()}</span>
						</div>
						<div class="frame-locals">
							${Object.entries(data.snapshots[0].locals).map(([name, value]: [string, any]) => `
								<div class="local-variable">
									<span class="var-name">${name}:</span>
									<span class="var-value">${value.value}</span>
								</div>
							`).join('')}
						</div>
					</div>
				</div>
			</div>
		`;

		// Replace the content placeholder in the template
		const finalHtml = htmlContent.replace('<div id="content"></div>', `<div id="content">${content}</div>`);

		functionDetailsPanel.title = `Stack Trace - ${data.function_name}`;
		functionDetailsPanel.webview.html = finalHtml;
		
		// Send snapshots data to the webview
		functionDetailsPanel.webview.postMessage({
			command: 'setSnapshots',
			snapshots: data.snapshots
		});
		
		functionDetailsPanel.reveal(vscode.ViewColumn.Beside);
	} catch (error) {
		console.error('Error exploring stack trace:', error);
		vscode.window.showErrorMessage('Failed to explore stack trace');
	}
}

/**
 * Get webview content with properly resolved CSS and JS paths
 */
function getWebviewContent(webview: vscode.Webview, templatePath: string): string {
	try {
		// The webview files are copied to the dist directory during build
		const webviewPath = vscode.Uri.joinPath(extensionContext.extensionUri, 'dist', 'webview');
		const htmlPath = vscode.Uri.joinPath(webviewPath, templatePath);
		
		console.log(`Loading HTML template from: ${htmlPath.fsPath}`);
		const htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');
		
		// Replace CSS and JS file paths with webview URIs
		const cssPattern = /href="css\/([^"]+)"/g;
		const jsPattern = /src="js\/([^"]+)"/g;
		
		let resolvedHtml = htmlContent.replace(cssPattern, (match, file) => {
			const cssPath = vscode.Uri.joinPath(webviewPath, 'css', file);
			return `href="${webview.asWebviewUri(cssPath)}"`;
		});
		
		resolvedHtml = resolvedHtml.replace(jsPattern, (match, file) => {
			const jsPath = vscode.Uri.joinPath(webviewPath, 'js', file);
			return `src="${webview.asWebviewUri(jsPath)}"`;
		});
		
		return resolvedHtml;
	} catch (error) {
		console.error(`Error loading template: ${error}`);
		return `<html><body><h1>Error loading template</h1><p>${error}</p></body></html>`;
	}
}

function highlightLine(editor: vscode.TextEditor, line: number) {
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
	currentLine = line;
}

export async function activate(context: vscode.ExtensionContext) {
	console.log('PyMonitor extension is now active!');

	// Store extension context for accessing resources
	extensionContext = context;

	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'pymonitor.restartServer';

	// Register commands
	const checkCommand = vscode.commands.registerCommand('pymonitor.checkPython', () => {
		console.log('Check command triggered');
		checkPythonEnvironment();
	});

	const restartCommand = vscode.commands.registerCommand('pymonitor.restartServer', async () => {
		console.log('Restart server command triggered');
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		const pythonExtension = vscode.extensions.getExtension('ms-python.python');
		if (!pythonExtension) {
			vscode.window.showErrorMessage('Python extension not found!');
			return;
		}

		const executionDetails = await pythonExtension.exports.settings.getExecutionDetails();
		const pythonPath = executionDetails.execCommand[0];
		if (!pythonPath) {
			vscode.window.showErrorMessage('No Python executable found');
			return;
		}

		await startWebServer(pythonPath, workspaceRoot);
	});

	const showDetailsCommand = vscode.commands.registerCommand('pymonitor.showFunctionDetails', (functions: FunctionData[]) => {
		showFunctionDetails(functions);
	});

	// Register code lens provider
	const codeLensProvider = new PyMonitorCodeLensProvider();
	context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: 'file', language: 'python' }, codeLensProvider));

	// Register a document change event listener for Python files
	const documentListener = vscode.workspace.onDidOpenTextDocument(async (document) => {
		if (document.languageId === 'python') {
			console.log(`Python file opened: ${document.fileName}`);
			const functionData = await getFunctionData(document.fileName);
			if (functionData) {
				console.log('Function data for file:', functionData);
				functionDataCache.set(document.fileName, functionData);
				codeLensProvider.refresh();
			}
		}
	});

	// Add this line to track editor changes
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				currentEditor = editor;
			}
		})
	);

	// Initial setup - start server once when extension is activated
	const envReady = await checkPythonEnvironment();
	if (!envReady) {
		vscode.window.showErrorMessage('Failed to initialize PyMonitor. Check the output panel for details.');
	} else {
		// Load function data for all already opened Python files
		const openDocuments = vscode.workspace.textDocuments.filter(doc => doc.languageId === 'python');
		for (const doc of openDocuments) {
			console.log(`Loading data for already opened file: ${doc.fileName}`);
			const functionData = await getFunctionData(doc.fileName);
			if (functionData) {
				functionDataCache.set(doc.fileName, functionData);
			}
		}
		codeLensProvider.refresh();
	}

	context.subscriptions.push(checkCommand, restartCommand, showDetailsCommand, documentListener, statusBarItem);
}

// This method is called when your extension is deactivated
export function deactivate() {
	// Clean up web server process
	if (webServerProcess) {
		webServerProcess.kill();
		webServerProcess = null;
	}
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}
