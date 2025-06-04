import * as vscode from 'vscode';
import * as path from 'path';
import * as net from 'net';
import { exec } from 'child_process';
import { promisify } from 'util';
import { debugLog } from './state';
import { FunctionData } from '../types';
import { FunctionInfo } from './treeSitter';

const execAsync = promisify(exec);

/**
 * Service for handling live recording functionality
 */
export class LiveRecordingService {
    private static instance: LiveRecordingService;
    private socket: net.Socket | null = null;
    private serverProcess: any = null;
    private statusBarItem: vscode.StatusBarItem;
    private documentSaveListener: vscode.Disposable | null = null;
    private messageBuffer: string = '';

    private constructor() {
        // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.statusBarItem.text = "$(circle-slash) Live Rec: Off";
        this.statusBarItem.tooltip = "No active live recording session";
        this.statusBarItem.show();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): LiveRecordingService {
        if (!LiveRecordingService.instance) {
            LiveRecordingService.instance = new LiveRecordingService();
        }
        return LiveRecordingService.instance;
    }

    /**
     * Start the live recording server
     * @param dbPath Path to the database file
     */
    private async startServer(dbPath: string): Promise<boolean> {
        try {
            // Check if a server is already running
            if (this.serverProcess) {
                debugLog('Live recording server is already running');
                return true;
            }

            // Get Python path from Python extension
            const pythonExtension = vscode.extensions.getExtension('ms-python.python');
            if (!pythonExtension) {
                vscode.window.showErrorMessage('Python extension not found!');
                return false;
            }

            const executionDetails = await pythonExtension.exports.settings.getExecutionDetails();
            const pythonPath = executionDetails.execCommand[0];
            if (!pythonPath) {
                vscode.window.showErrorMessage('No Python executable found');
                return false;
            }

            // Start the server process
            const command = `${pythonPath} -m monitoringpy.interface.liverec.main ${dbPath}`;
            debugLog(`Starting live recording server with command: ${command}`);
            
            this.serverProcess = exec(command);
            
            // Log server output
            this.serverProcess.stdout?.on('data', (data: string) => {
                debugLog(`Live recording server stdout: ${data.toString()}`);
            });
            
            this.serverProcess.stderr?.on('data', (data: string) => {
                debugLog(`Live recording server stderr: ${data.toString()}`);
            });

            // Wait for server to be ready
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            return true;
        } catch (error) {
            debugLog('Error starting live recording server:', error);
            vscode.window.showErrorMessage(`Failed to start live recording server: ${error}`);
            return false;
        }
    }

    /**
     * Connect to the socket server
     */
    private async connectSocket(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            try {
                // Create socket connection
                this.socket = new net.Socket();
                this.messageBuffer = '';

                // Set up event listeners
                this.socket.on('connect', () => {
                    debugLog('Socket connection established');
                    this.statusBarItem.text = "$(radio-tower) Live Rec: Connected";
                    this.statusBarItem.tooltip = "Live recording server connected";
                    resolve(true);
                });

                this.socket.on('data', (data: Buffer) => {
                    // Append the new data to our buffer
                    this.messageBuffer += data.toString();
                    
                    // Process complete messages (delimited by newlines)
                    let newlineIndex: number;
                    while ((newlineIndex = this.messageBuffer.indexOf('\n')) !== -1) {
                        // Extract the complete message
                        const message = this.messageBuffer.substring(0, newlineIndex);
                        
                        // Remove the processed message from the buffer
                        this.messageBuffer = this.messageBuffer.substring(newlineIndex + 1);
                        
                        // Process the complete message
                        this.handleMessage(message);
                    }
                });

                this.socket.on('error', (error: Error) => {
                    debugLog('Socket error:', error);
                    this.statusBarItem.text = "$(error) Live Rec: Error";
                    this.statusBarItem.tooltip = `Error: ${error.message}`;
                    resolve(false);
                });

                this.socket.on('close', () => {
                    debugLog('Socket connection closed');
                    this.statusBarItem.text = "$(circle-slash) Live Rec: Off";
                    this.statusBarItem.tooltip = "No active live recording session";
                    this.socket = null;
                });

                // Connect to the server
                debugLog('Connecting to socket server at localhost:8765...');
                this.socket.connect(8765, 'localhost');
                
                // Set a timeout in case the connection never succeeds
                setTimeout(() => {
                    if (this.socket && !this.socket.destroyed && !(this.socket as any).connected) {
                        debugLog('Socket connection timeout');
                        this.socket.destroy();
                        resolve(false);
                    }
                }, 5000);
            } catch (error) {
                debugLog('Error connecting to socket server:', error);
                vscode.window.showErrorMessage(`Failed to connect to live recording server: ${error}`);
                resolve(false);
            }
        });
    }

    /**
     * Handle incoming socket messages
     */
    private handleMessage(message: string): void {
        try {
            debugLog(`Received message from live recording server: ${message}`);
            // Parse the JSON message
            const data = JSON.parse(message);
            // Log the parsed data to the console
            console.log('Live recording server response:', data);
        } catch (error) {
            debugLog(`Error parsing message: ${error}`);
        }
    }

    /**
     * Start live recording for a function
     * @param uri Document URI
     * @param func Function information
     * @param previousExecutions Previous executions of the function
     */
    public async startLiveRecording(
        uri: vscode.Uri,
        func: any,
        previousExecutions: FunctionData[] | undefined
    ): Promise<boolean> {
        try {
            // Get the workspace folder
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder found');
                return false;
            }

            // Get the database path
            const dbPath = path.join(workspaceFolder.uri.fsPath, 'main.db');

            // Start the server
            const serverStarted = await this.startServer(dbPath);
            if (!serverStarted) {
                return false;
            }

            // Connect to socket
            const connected = await this.connectSocket();
            if (!connected) {
                return false;
            }

            // If there are previous executions, prompt user to select one
            let selectedExecution: FunctionData | undefined;
            
            if (previousExecutions && previousExecutions.length > 0) {
                const items = previousExecutions.map(exec => {
                    // Check if all required properties exist
                    const startTime = exec.start_time ? new Date(exec.start_time).toLocaleString() : 'unknown time';
                    const functionName = exec.function || 'unnamed function';
                    const duration = exec.duration !== null && exec.duration !== undefined ? exec.duration.toFixed(2) : 'unknown';
                    
                    return {
                        label: `${functionName} (${startTime})`,
                        description: `Duration: ${duration}ms`,
                        execution: exec
                    };
                });

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a previous execution to use as example'
                });

                if (!selected) {
                    // User canceled
                    return false;
                }

                selectedExecution = selected.execution;
            } else {
                vscode.window.showWarningMessage(`No previous executions found for ${func.name}`);
                return false;
            }

            // Set up document save listener
            if (this.documentSaveListener) {
                this.documentSaveListener.dispose();
            }
            
            this.documentSaveListener = vscode.workspace.onDidSaveTextDocument(doc => {
                if (doc.languageId === 'python') {
                    this.sendChangeCommand();
                }
            });

            // Send initial command to set example
            if (!selectedExecution) {
                vscode.window.showErrorMessage('No execution selected');
                return false;
            }

            if (selectedExecution.id === null || selectedExecution.id === undefined) {
                vscode.window.showErrorMessage('Selected execution has no valid ID');
                return false;
            }

            this.sendSetExampleCommand(selectedExecution.id);

            this.statusBarItem.text = `$(record) Live Rec: ${func.name}`;
            this.statusBarItem.tooltip = `Live recording active for ${func.name}`;
            
            vscode.window.showInformationMessage(`Live recording started for ${func.name}`);
            return true;
        } catch (error) {
            debugLog('Error starting live recording:', error);
            vscode.window.showErrorMessage(`Failed to start live recording: ${error}`);
            return false;
        }
    }

    /**
     * Send set_example command to the server
     * @param callId The function call ID to use as example
     */
    private sendSetExampleCommand(callId: number | string): void {
        if (!this.socket) {
            debugLog('Cannot send set_example command: Socket not connected');
            return;
        }

        if (callId === null || callId === undefined) {
            debugLog('Cannot send set_example command: Invalid call_id');
            vscode.window.showErrorMessage('Invalid function call ID');
            return;
        }

        const command = JSON.stringify({
            command: 'set_example',
            call_id: callId
        });

        debugLog(`Sending command: ${command}`);
        // Send the command followed by a newline
        this.socket.write(command + '\n');
    }

    /**
     * Send change command to the server
     */
    private sendChangeCommand(): void {
        if (!this.socket) {
            debugLog('Cannot send change command: Socket not connected');
            return;
        }

        const command = JSON.stringify({
            command: 'change'
        });

        debugLog(`Sending command: ${command}`);
        // Send the command followed by a newline
        this.socket.write(command + '\n');
    }

    /**
     * Stop live recording
     */
    public stopLiveRecording(): void {
        // Clean up socket
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }

        // Clean up server process
        if (this.serverProcess) {
            this.serverProcess.kill();
            this.serverProcess = null;
        }

        // Clean up document save listener
        if (this.documentSaveListener) {
            this.documentSaveListener.dispose();
            this.documentSaveListener = null;
        }

        // Update status bar
        this.statusBarItem.text = "$(circle-slash) Live Rec: Off";
        this.statusBarItem.tooltip = "No active live recording session";

        vscode.window.showInformationMessage('Live recording stopped');
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.stopLiveRecording();
        this.statusBarItem.dispose();
    }
} 