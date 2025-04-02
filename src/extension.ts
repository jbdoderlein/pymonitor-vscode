// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { FunctionData } from './types';
import { getFunctionData, waitForServer, getStackTrace } from './services/api';
import { showFunctionDetails as showFunctionDetailsInWebview } from './services/webview';
import { PyMonitorCodeLensProvider } from './services/codeLens';
import { state, debugLog } from './services/state';
import { ConfigService } from './services/config';

const execAsync = promisify(exec);
const config = ConfigService.getInstance();

let webServerProcess: ChildProcess | null = null;
let statusBarItem: vscode.StatusBarItem;
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

async function checkPythonEnvironment(): Promise<boolean> {
	try {
		const pythonExtension = vscode.extensions.getExtension('ms-python.python');
		if (!pythonExtension) {
			vscode.window.showErrorMessage('Python extension not found! Please install it first.');
			return false;
		}

		const executionDetails = await pythonExtension.exports.settings.getExecutionDetails();
		const pythonPath = executionDetails.execCommand[0];
		if (!pythonPath) {
			vscode.window.showErrorMessage('No Python executable found');
			return false;
		}

		// Check if Python is installed and accessible
		try {
			await execAsync(`${pythonPath} --version`);
		} catch (error) {
			vscode.window.showErrorMessage('Python is not accessible. Please check your Python installation.');
			return false;
		}

		return true;
	} catch (error) {
		console.error('Error checking Python environment:', error);
		vscode.window.showErrorMessage('Failed to check Python environment');
		return false;
	}
}

async function startWebServer(pythonPath: string, workspaceRoot: string): Promise<void> {
	try {
		// Kill existing server if any
		if (webServerProcess) {
			webServerProcess.kill();
			webServerProcess = null;
		}

		// Check if main.db exists
		const dbPath = path.join(workspaceRoot, 'main.db');
		if (!fs.existsSync(dbPath)) {
			console.log('No main.db found in workspace root');
			return;
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
	} catch (error) {
		console.error('Error starting web server:', error);
		statusBarItem.text = "$(error) PyMonitor Server Error";
		statusBarItem.tooltip = "Error starting PyMonitor server";
		statusBarItem.show();
	}
}

async function showFunctionDetails(functions: FunctionData[]) {
	state.currentFunctionData = functions;
	
	// Store the current editor when first opening the panel
	if (!state.functionDetailsPanel) {
		state.currentEditor = vscode.window.activeTextEditor;
	}
	
	if (state.functionDetailsPanel) {
		// Update existing panel
		state.functionDetailsPanel.title = 'Function Details';
		updateFunctionDetailsPanel(functions);
		state.functionDetailsPanel.reveal(vscode.ViewColumn.Beside);
	} else {
		// Create new panel
		state.functionDetailsPanel = vscode.window.createWebviewPanel(
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
		state.functionDetailsPanel.webview.onDidReceiveMessage(async message => {
			debugLog('Received message from webview:', message);
			if (message.command === 'exploreStackTrace') {
				console.log('Received stack trace exploration request for function:', message.functionId);
				const functionId = message.functionId;
				const functionData = functions.find(f => f.id === functionId);
				if (functionData) {
					await exploreStackTrace(functionId);
				}
			} else if (message.command === 'backToFunctions' && state.currentFunctionData) {
				debugLog('Going back to functions list');
				// Remove highlight when going back to function list
				if (state.currentHighlight) {
					state.currentHighlight.dispose();
					state.currentHighlight = null;
					state.currentLine = null;
				}
				state.isInStackTraceView = false;
				updateFunctionDetailsPanel(state.currentFunctionData);
			} else if (message.command === 'updateLine' && state.isInStackTraceView) {
				debugLog('Received line update:', message.line, 'isUpdatingTimeline:', state.isUpdatingTimeline);
				// Handle line updates from the timeline
				if (state.currentEditor) {
					highlightLine(state.currentEditor, message.line);
				}
			} else if (message.command === 'sliderChange' && state.functionDetailsPanel) {
				debugLog('Received slider change:', message.value, 'isUpdatingTimeline:', state.isUpdatingTimeline);
				// Handle slider changes
				state.isUpdatingTimeline = true;
				state.currentStep = message.value;
				state.functionDetailsPanel.webview.postMessage({
					command: 'updateStep',
					step: state.currentStep
				});
				setTimeout(() => { 
					state.isUpdatingTimeline = false;
					debugLog('Reset isUpdatingTimeline to false');
				}, 100);
			} else if (message.command === 'prevStep' && state.functionDetailsPanel) {
				debugLog('Received prevStep, currentStep:', state.currentStep);
				// Handle previous button click
				if (state.currentStep > 0) {
					state.isUpdatingTimeline = true;
					state.currentStep--;
					state.functionDetailsPanel.webview.postMessage({
						command: 'updateStep',
						step: state.currentStep
					});
					setTimeout(() => { 
						state.isUpdatingTimeline = false;
						debugLog('Reset isUpdatingTimeline to false after prevStep');
					}, 100);
				}
			} else if (message.command === 'nextStep' && state.functionDetailsPanel) {
				debugLog('Received nextStep, currentStep:', state.currentStep);
				// Handle next button click
				const maxStep = parseInt(state.functionDetailsPanel.webview.html.match(/max="(\d+)"/)?.[1] || '0');
				if (state.currentStep < maxStep) {
					state.isUpdatingTimeline = true;
					state.currentStep++;
					state.functionDetailsPanel.webview.postMessage({
						command: 'updateStep',
						step: state.currentStep
					});
					setTimeout(() => { 
						state.isUpdatingTimeline = false;
						debugLog('Reset isUpdatingTimeline to false after nextStep');
					}, 100);
				}
			}
		});

		updateFunctionDetailsPanel(functions);
		state.functionDetailsPanel.reveal(vscode.ViewColumn.Beside);
	}
}

function updateFunctionDetailsPanel(functions: FunctionData[]) {
	if (!state.functionDetailsPanel) {
		return;
	}

	// Reset stack trace view flag when going back to function list
	state.isInStackTraceView = false;

	// Get the webview content
	const htmlContent = getWebviewContent(state.functionDetailsPanel.webview, 'html/functionDetails.html');
	
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
	state.functionDetailsPanel.webview.html = finalHtml;
}

async function exploreStackTrace(functionId: string) {
	try {
		const data = await getStackTrace(functionId);
		if (!data) {
			vscode.window.showErrorMessage('Failed to fetch stack trace data');
			return;
		}

		// Reset step counter and set stack trace view flag
		state.currentStep = 0;
		state.isInStackTraceView = true;

		if (!state.functionDetailsPanel) {
			return;
		}

		// Get the webview content
		const htmlContent = getWebviewContent(state.functionDetailsPanel.webview, 'html/stackTrace.html');
		
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
				<div class="local-timeline">
					<h4>Local Timeline for Line ${data.snapshots[0].line}</h4>
					<div class="timeline-controls">
						<button class="timeline-button" id="localPrevButton" disabled>
							<span class="codicon codicon-chevron-left"></span> Previous
						</button>
						<div class="timeline-slider">
							<input type="range" 
								   id="localTimelineSlider" 
								   min="0" 
								   max="0" 
								   value="0"
								   step="1">
							<div class="timeline-info">
								Snapshot <span id="localCurrentStep">1</span> of <span id="localTotalSteps">1</span>
							</div>
						</div>
						<button class="timeline-button" id="localNextButton" disabled>
							Next <span class="codicon codicon-chevron-right"></span>
						</button>
					</div>
				</div>
			</div>
		`;

		// Replace the content placeholder in the template
		const finalHtml = htmlContent.replace('<div id="content"></div>', `<div id="content">${content}</div>`);

		state.functionDetailsPanel.title = `Stack Trace - ${data.function_name}`;
		state.functionDetailsPanel.webview.html = finalHtml;
		
		// Send snapshots data to the webview
		state.functionDetailsPanel.webview.postMessage({
			command: 'setSnapshots',
			snapshots: data.snapshots
		});
		
		state.functionDetailsPanel.reveal(vscode.ViewColumn.Beside);
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

// Single function to handle line highlighting
function highlightLine(editor: vscode.TextEditor, line: number) {
	debugLog('Highlighting line:', line);
	
	// Remove previous highlight if any
	if (state.currentHighlight) {
		state.currentHighlight.dispose();
		state.currentHighlight = null;
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

	state.currentHighlight = decorationType;
	state.currentLine = line;
}

export async function activate(context: vscode.ExtensionContext) {
	console.log('PyMonitor extension is now active!');

	// Store extension context for accessing resources
	extensionContext = context;

	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'pymonitor.restartServer';

	// Register commands
	const checkCommand = vscode.commands.registerCommand('pymonitor.checkPython', checkPythonEnvironment);
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

	const showFunctionDetailsCommand = vscode.commands.registerCommand('pymonitor.showFunctionDetails', (functions: FunctionData[]) => {
		showFunctionDetailsInWebview(functions, context);
	});

	// Register code lens provider
	const codeLensProvider = new PyMonitorCodeLensProvider();
	context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider));

	// Register a document change event listener for Python files
	const documentListener = vscode.workspace.onDidOpenTextDocument(async (document) => {
		if (document.languageId === 'python') {
			console.log(`Python file opened: ${document.fileName}`);
			
			// Check if server is running
			const serverReady = await waitForServer();
			if (!serverReady) {
				vscode.window.showErrorMessage('PyMonitor server is not running. Please start it using the "PyMonitor: Restart Server" command.');
				return;
			}

			const functionData = await getFunctionData(document.fileName);
			if (functionData) {
				console.log('Function data for file:', functionData);
				state.functionDataCache.set(document.fileName, functionData);
				codeLensProvider.refresh();
			}
		}
	});

	// Add this line to track editor changes
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				state.currentEditor = editor;
			}
		})
	);

	// Update the click handler to only send messages to panel
	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(event => {
			if (event.textEditor === state.currentEditor && 
				event.selections.length > 0 && 
				state.isInStackTraceView && 
				!state.isUpdatingTimeline) {
				const line = event.selections[0].active.line + 1;
				debugLog('Editor line clicked:', line);
				
				// Send line click to panel, let it handle the logic
				if (state.functionDetailsPanel) {
					state.functionDetailsPanel.webview.postMessage({
						command: 'editorLineClick',
						line: line
					});
				}
			}
		})
	);

	// Initial setup - start server once when extension is activated
	const envReady = await checkPythonEnvironment();
	if (!envReady) {
		vscode.window.showErrorMessage('Failed to initialize PyMonitor. Check the output panel for details.');
	} else {
		// Get workspace root and Python path
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

		// Start the server
		await startWebServer(pythonPath, workspaceRoot);

		// Load function data for all already opened Python files
		const openDocuments = vscode.workspace.textDocuments.filter(doc => doc.languageId === 'python');
		for (const doc of openDocuments) {
			console.log(`Loading data for already opened file: ${doc.fileName}`);
			const functionData = await getFunctionData(doc.fileName);
			if (functionData) {
				state.functionDataCache.set(doc.fileName, functionData);
			}
		}
		codeLensProvider.refresh();
	}

	context.subscriptions.push(checkCommand, restartCommand, showFunctionDetailsCommand, documentListener, statusBarItem);
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
