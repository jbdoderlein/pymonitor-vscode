// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { FunctionData } from './types';
import { getFunctionData, waitForServer } from './services/api';
import { showFunctionDetails as showFunctionDetailsInWebview } from './services/webview';
import { PyMonitorCodeLensProvider } from './services/codeLens';
import { state, debugLog } from './services/state';
import { ConfigService } from './services/config';
import { DebugFunctionCodeLensProvider } from './services/debugCodeLens';
import { DebuggerService } from './services/debugger';

const execAsync = promisify(exec);
const config = ConfigService.getInstance();

let webServerProcess: ChildProcess | null = null;
let statusBarItem: vscode.StatusBarItem;
let extensionContext: vscode.ExtensionContext;

// Add a flag to track programmatic selection changes, export it for use in highlight.ts
export let isProgrammaticSelectionChange = false;

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

	// Register code lens providers
	const codeLensProvider = new PyMonitorCodeLensProvider();
	context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider));

	// Register debug code lens provider
	const debugCodeLensProvider = new DebugFunctionCodeLensProvider();
	context.subscriptions.push(vscode.languages.registerCodeLensProvider(
		{ scheme: 'file', language: 'python' }, 
		debugCodeLensProvider
	));

	// Debug function command
	const debugFunctionCommand = vscode.commands.registerCommand('pymonitor.debugFunction', async (uri: vscode.Uri, functionInfo: any) => {
		const debugService = DebuggerService.getInstance();
		await debugService.debugFunction(uri, functionInfo);
	});

	context.subscriptions.push(debugFunctionCommand);

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

			// Refresh debug code lenses
			debugCodeLensProvider.refresh();
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
			// Skip programmatic selection changes (from highlighting)
			if (state.isProgrammaticSelectionChange) {
				return;
			}
			
			if (event.textEditor === state.currentEditor && 
				event.selections.length > 0 && 
				state.isInStackTraceView) {
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
