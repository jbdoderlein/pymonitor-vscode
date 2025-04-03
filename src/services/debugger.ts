import * as vscode from 'vscode';
import { FunctionInfo } from './treeSitter';
import { debugLog } from './state';
import { getFunctionData } from './api';

/**
 * DebugConfiguration for a Python function
 */
interface PyMonitorDebugConfig extends vscode.DebugConfiguration {
    name: string;
    type: string;
    request: string;
    program: string;
    pythonPath?: string;
    args: string[];
    console: string;
    cwd?: string;
    stopOnEntry?: boolean;
    testFunction?: string;
    env?: Record<string, string>;
}

/**
 * Available input options for function debugging
 */
enum DebugInputOption {
    DEFAULT = 'Use default values',
    HISTORY = 'Select from previous function calls',
    MANUAL = 'Enter values manually'
}

/**
 * Service to handle debugging Python functions
 */
export class DebuggerService {
    private static instance: DebuggerService;
    // Store the selected function call ID for reanimation
    private selectedFunctionCallId: string | null = null;

    private constructor() {}

    /**
     * Get the singleton instance
     */
    public static getInstance(): DebuggerService {
        if (!DebuggerService.instance) {
            DebuggerService.instance = new DebuggerService();
        }
        return DebuggerService.instance;
    }

    /**
     * Start a debug session for a specific function
     */
    public async debugFunction(uri: vscode.Uri, functionInfo: FunctionInfo): Promise<boolean> {
        try {
            // Reset selected call ID
            this.selectedFunctionCallId = null;
            
            debugLog(`Starting debug session for function: ${functionInfo.name} in ${uri.fsPath}`);

            // Get Python extension
            const pythonExtension = vscode.extensions.getExtension('ms-python.python');
            if (!pythonExtension) {
                vscode.window.showErrorMessage('Python extension not found! Please install it first.');
                return false;
            }

            // Get Python execution details
            const executionDetails = await pythonExtension.exports.settings.getExecutionDetails();
            const pythonPath = executionDetails.execCommand[0];
            if (!pythonPath) {
                vscode.window.showErrorMessage('No Python executable found');
                return false;
            }

            // Prompt user to choose how to provide function inputs
            const inputOption = await vscode.window.showQuickPick(
                [
                    DebugInputOption.DEFAULT,
                    DebugInputOption.HISTORY,
                    DebugInputOption.MANUAL
                ],
                {
                    placeHolder: 'Select how to provide function inputs',
                    title: `Debug ${functionInfo.name}()`
                }
            );

            if (!inputOption) {
                // User cancelled
                return false;
            }

            // Define function arguments based on user's choice
            let callArgs: Map<string, string> = new Map();
            let useReanimation = false;

            // Process based on user choice
            switch (inputOption) {
                case DebugInputOption.HISTORY:
                    const historicArgs = await this.getFunctionCallHistory(uri.fsPath, functionInfo.name);
                    if (!historicArgs) {
                        return false;
                    }
                    callArgs = historicArgs;
                    // If we have a selected function call ID, we'll use reanimation
                    useReanimation = !!this.selectedFunctionCallId;
                    break;

                case DebugInputOption.MANUAL:
                    const manualArgs = await this.promptForArgumentValues(functionInfo.params);
                    if (!manualArgs) {
                        return false;
                    }
                    callArgs = manualArgs;
                    break;

                case DebugInputOption.DEFAULT:
                default:
                    // Use default values
                    callArgs = this.getDefaultArgumentValues(functionInfo.params);
                    break;
            }

            // Create debug configuration
            const debugConfig: PyMonitorDebugConfig = {
                name: `Debug ${functionInfo.name}`,
                type: 'python',
                request: 'launch',
                program: uri.fsPath,
                pythonPath: pythonPath,
                args: [],
                console: 'integratedTerminal',
                stopOnEntry: true, // Stop at the first line of the function
                // Add an environment variable to indicate we want to debug a specific function
                env: {
                    'PYMONITOR_DEBUG_FUNCTION': functionInfo.name,
                    'PYMONITOR_DEBUG_MODE': 'true'
                }
            };

            // Create a wrapper file that will call the function with selected args
            const wrapperFile = await this.createWrapperFile(uri.fsPath, functionInfo, callArgs, useReanimation);
            if (wrapperFile) {
                debugConfig.program = wrapperFile.fsPath;
                debugConfig.stopOnEntry = false; // We want to stop on the function entry, not the wrapper
            }

            // Start debugging
            vscode.debug.startDebugging(undefined, debugConfig);
            return true;
        } catch (error) {
            debugLog('Error starting debug session:', error);
            vscode.window.showErrorMessage(`Failed to start debug session: ${error}`);
            return false;
        }
    }

    /**
     * Create default argument values based on parameter names
     */
    private getDefaultArgumentValues(params: string[]): Map<string, string> {
        const args = new Map<string, string>();
        
        for (const param of params) {
            // Create simple default values based on parameter names
            if (param.includes('path') || param.includes('file') || param.includes('name')) {
                args.set(param, `"example_${param}"`);
            } else if (param.includes('num') || param.includes('count') || param.includes('index')) {
                args.set(param, '0');
            } else if (param.includes('bool') || param.includes('flag') || param.includes('enable')) {
                args.set(param, 'True');
            } else if (param.includes('list') || param.includes('array')) {
                args.set(param, '[]');
            } else if (param.includes('dict') || param.includes('map') || param.includes('config')) {
                args.set(param, '{}');
            } else {
                args.set(param, 'None');
            }
        }
        
        return args;
    }

    /**
     * Get function call history from API to show as options
     */
    private async getFunctionCallHistory(filePath: string, functionName: string): Promise<Map<string, string> | null> {
        try {
            // Get function call history from API
            const functionCalls = await getFunctionData(filePath);
            
            if (!functionCalls || functionCalls.length === 0) {
                vscode.window.showInformationMessage('No previous function calls found in history.');
                return null;
            }

            // Filter to only include calls for the specific function
            const relevantCalls = functionCalls.filter(call => call.function === functionName);
            
            if (relevantCalls.length === 0) {
                vscode.window.showInformationMessage(`No previous calls found for function "${functionName}".`);
                return null;
            }

            // Create options with date and argument preview
            const callOptions = relevantCalls.map(call => {
                const date = new Date(call.start_time).toLocaleString();
                const argsPreview = Object.entries(call.locals || {})
                    .map(([name, data]) => `${name}=${data.value}`)
                    .join(', ').substring(0, 50) + (Object.keys(call.locals || {}).length > 2 ? '...' : '');
                
                return {
                    label: `${date}`,
                    description: argsPreview,
                    call: call
                };
            });

            // Let user select from call history
            const selectedCall = await vscode.window.showQuickPick(callOptions, {
                placeHolder: 'Select a previous function call to use its arguments',
                title: `Previous calls to ${functionName}()`
            });

            if (!selectedCall) {
                // User cancelled
                return null;
            }

            // Store the selected call ID for reanimation
            this.selectedFunctionCallId = selectedCall.call.id;
            
            // Convert the selected call's arguments to a Map
            const args = new Map<string, string>();
            
            for (const [name, data] of Object.entries(selectedCall.call.locals || {})) {
                let valueStr: string;
                
                // Format the value based on type
                if (typeof data.value === 'string') {
                    // Ensure strings are properly quoted
                    valueStr = JSON.stringify(data.value);
                } else if (data.type === 'list' || data.type === 'dict' || data.type === 'tuple') {
                    // Use the literal representation for collections
                    valueStr = data.value;
                } else {
                    // For other types, use the value directly
                    valueStr = data.value;
                }
                
                args.set(name, valueStr);
            }
            
            return args;
        } catch (error) {
            debugLog('Error getting function call history:', error);
            vscode.window.showErrorMessage('Failed to retrieve function call history');
            return null;
        }
    }

    /**
     * Prompt the user to enter values for each parameter
     */
    private async promptForArgumentValues(params: string[]): Promise<Map<string, string> | null> {
        const args = new Map<string, string>();
        
        // For each parameter, prompt the user to enter a value
        for (const param of params) {
            const defaultValue = this.getDefaultArgumentValues([param]).get(param) || 'None';
            
            const inputValue = await vscode.window.showInputBox({
                prompt: `Enter value for parameter "${param}"`,
                value: defaultValue,
                title: `Parameter: ${param}`,
                valueSelection: [0, defaultValue.length]
            });
            
            if (inputValue === undefined) {
                // User cancelled
                return null;
            }
            
            args.set(param, inputValue);
        }
        
        return args;
    }

    /**
     * Create a temporary Python file that will import and call the target function
     */
    private async createWrapperFile(
        targetFile: string, 
        functionInfo: FunctionInfo, 
        argValues: Map<string, string>,
        useReanimation: boolean = false
    ): Promise<vscode.Uri | null> {
        try {
            // Get workspace folder
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(targetFile));
            if (!workspaceFolder) {
                return null;
            }

            // Create file content
            const modulePath = vscode.workspace.asRelativePath(targetFile, false);
            const moduleName = modulePath.replace(/\.[^/.]+$/, '').replace(/\//g, '.');
            
            let content = `# PyMonitor debug wrapper - temporary file\n`;
            content += `import sys\n`;
            content += `import os\n`;
            content += `import monitoringpy\n\n`;
            content += `sys.path.insert(0, "${workspaceFolder.uri.fsPath.replace(/\\/g, '\\\\')}")\n\n`;
            content += `# Import the target module\n`;
            content += `from ${moduleName} import ${functionInfo.name}\n\n`;
            content += `db_path = os.path.join("${workspaceFolder.uri.fsPath.replace(/\\/g, '\\\\')}", "main.db")\n\n`;
            content += `monitoringpy.init_monitoring(db_path=db_path, pyrapl_enabled=False)\n`;
            content += `monitoringpy.pymonitor_line(${functionInfo.name})\n`;
            


            // If using reanimation, use the monitoringpy library
            if (useReanimation && this.selectedFunctionCallId) {
                content += `# Find the database file\n`;
                content += `try:\n`;
                content += `    # Load function execution data for inspection\n`;
                content += `    args, kwargs = monitoringpy.load_execution_data(\n`;
                content += `        function_execution_id="${this.selectedFunctionCallId}",\n`;
                content += `        db_path=db_path\n`;
                content += `    )\n`;
                content += `    \n`;
                content += `    # Call the function with exact arguments from the recorded execution\n`;
                content += `    result = ${functionInfo.name}(*args, **kwargs)\n`;
                content += `    \n`;
                content += `except Exception as e:\n`;
                content += `    print(f"Error during function reanimation: {e}")\n`;
                content += `    \n`;
                content += `    # Alternative: use full reanimation if direct call fails\n`;
                content += `    print("Trying full reanimation...")\n`;
                content += `    try:\n`;
                content += `        result = monitoringpy.reanimate_function(\n`;
                content += `            function_execution_id="${this.selectedFunctionCallId}",\n`;
                content += `            db_path=db_path,\n`;
                content += `            import_path="${workspaceFolder.uri.fsPath.replace(/\\/g, '\\\\')}"\n`;
                content += `        )\n`;
                content += `        print(f"Reanimation result: {result}")\n`;
                content += `    except Exception as e2:\n`;
                content += `        print(f"Reanimation also failed: {e2}")\n`;
            } else {
                // Standard approach with explicit arguments
                
                content += `# Call the function\n`;
                // Create a function call with the provided arguments
                const callArgs = functionInfo.params
                    .map(param => `${param}=${argValues.get(param) || 'None'}`)
                    .join(', ');
                
                content += `if __name__ == "__main__":\n`;
                content += `    print(f"Calling ${functionInfo.name}(${callArgs})")\n`;
                content += `    result = ${functionInfo.name}(${callArgs})\n`;
                content += `    print(f"Result: {result}")\n`;
            }
            
            // Create temporary file
            const tempDir = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'pymonitor');
            await vscode.workspace.fs.createDirectory(tempDir);
            
            const tempFile = vscode.Uri.joinPath(tempDir, `debug_${functionInfo.name}.py`);
            await vscode.workspace.fs.writeFile(tempFile, Buffer.from(content, 'utf8'));
            
            return tempFile;
        } catch (error) {
            debugLog('Error creating wrapper file:', error);
            return null;
        }
    }
} 