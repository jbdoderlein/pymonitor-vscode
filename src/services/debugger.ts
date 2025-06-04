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
    private selectedFunctionCallId: string | number | null = null;

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

            // Ensure there's a breakpoint at the function start
            await this.ensureBreakpointAtFunction(uri, functionInfo);

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
     * Ensure a breakpoint exists at the start of the function
     */
    private async ensureBreakpointAtFunction(uri: vscode.Uri, functionInfo: FunctionInfo): Promise<void> {
        try {
            // Check if there's already a breakpoint at the function location
            const existingBreakpoints = vscode.debug.breakpoints;
            const functionStartLine = functionInfo.range.start.line;
            
            // Check if any breakpoint already exists at this location
            const breakpointExists = existingBreakpoints.some(bp => {
                if (bp instanceof vscode.SourceBreakpoint) {
                    const location = bp.location;
                    return location.uri.toString() === uri.toString() && 
                           location.range.start.line === functionStartLine;
                }
                return false;
            });
            
            // If no breakpoint exists, add one
            if (!breakpointExists) {
                debugLog(`Adding breakpoint at start of function ${functionInfo.name} (line ${functionStartLine + 1})`);
                const breakpoint = new vscode.SourceBreakpoint(
                    new vscode.Location(
                        uri,
                        new vscode.Position(functionStartLine+1, 0)
                    )
                );
                vscode.debug.addBreakpoints([breakpoint]);
                
                // Inform the user
                vscode.window.showInformationMessage(
                    `Added breakpoint at the start of function ${functionInfo.name}`
                );
            } else {
                debugLog(`Breakpoint already exists at function ${functionInfo.name}`);
            }
        } catch (error) {
            debugLog('Error ensuring breakpoint at function:', error);
            vscode.window.showWarningMessage(
                `Could not add breakpoint at function ${functionInfo.name}: ${error}`
            );
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
            content += `import debugpy\n`;
            content += `import monitoringpy\n`;
            content += `import importlib\n`;
            content += `import inspect\n`;
            content += `import types\n`;
            content += `import dis\n`;
            content += `import bytecode\n\n`;
            content += `sys.path.insert(0, "${workspaceFolder.uri.fsPath.replace(/\\/g, '\\\\')}")\n\n`;
            content += `# Import the target module\n`;
            content += `from ${moduleName} import ${functionInfo.name}\n\n`;
            content += `db_path = os.path.join("${workspaceFolder.uri.fsPath.replace(/\\/g, '\\\\')}", "main.db")\n\n`;
            content += `monitoringpy.init_monitoring(db_path=db_path, pyrapl_enabled=False)\n`;
            content += `monitoringpy.pymonitor_line(${functionInfo.name})\n\n`;
            
            // Add the function that reloads the code of the function being tested
            content += `# Function to reload the code of the function being tested\n`;
            content += `def reload_and_modify_function(module_path, function_name):\n`;
            content += `    """Reload the module and return a modified version of the function.\n`;
            content += `    \n`;
            content += `    Args:\n`;
            content += `        module_path: The import path of the module (e.g. 'mypackage.mymodule')\n`;
            content += `        function_name: The name of the function to reload and modify\n`;
            content += `    \n`;
            content += `    Returns:\n`;
            content += `        The modified function object\n`;
            content += `    """\n`;
            content += `    print(f"Reloading function {function_name} from {module_path}")\n`;
            content += `    \n`;
            content += `    # Reload the module\n`;
            content += `    try:\n`;
            content += `        # Get the module object\n`;
            content += `        module = sys.modules.get(module_path)\n`;
            content += `        if not module:\n`;
            content += `            print(f"Module {module_path} not found in sys.modules, importing")\n`;
            content += `            module = importlib.import_module(module_path)\n`;
            content += `        else:\n`;
            content += `            print(f"Module {module_path} found, reloading")\n`;
            content += `            module = importlib.reload(module)\n`;
            content += `        \n`;
            content += `        # Get the function object\n`;
            content += `        func = getattr(module, function_name)\n`;
            content += `        print(f"Function {function_name} loaded: {func}")\n`;
            content += `        \n`;
            content += `        # Method 1: Source code modification approach (not used)\n`;
            content += `        # Get the source code of the function\n`;
            content += `        source = inspect.getsource(func)\n`;
            content += `        print(f"Original source code:\\n{source}")\n`;
            content += `        \n`;
            content += `        # ===================================================================\n`;
            content += `        # Method 2: Bytecode modification to insert a debugpy breakpoint\n`;
            content += `        # This directly modifies the function bytecode instead of source code\n`;
            content += `        # NOTE: Currently disabled as it's causing issues\n`;
            content += `        # ===================================================================\n`;
            content += `        try:\n`;
            content += `            print("Bytecode modification is currently disabled - using original function")\n`;
            content += `            # Commented out due to bytecode compatibility issues\n`;
            content += `            # The following code injects a debugpy.breakpoint() call at the start of the function\n`;
            content += `            \n`;
            content += `            # print("Applying bytecode modification to add debugpy breakpoint")\n`;
            content += `            # code = func.__code__\n`;
            content += `            # original = bytecode.Bytecode.from_code(code)\n`;
            content += `            # \n`;
            content += `            # # Get the location of the first instruction\n`;
            content += `            # if len(original) > 0:\n`;
            content += `            #     location = original[0].location\n`;
            content += `            #     \n`;
            content += `            #     # Print original bytecode for debugging\n`;
            content += `            #     print("Original bytecode:")\n`;
            content += `            #     for i, instr in enumerate(original):\n`;
            content += `            #         print(f"  {i}: {instr}")\n`;
            content += `            #     \n`;
            content += `            #     # First, add import debugpy instruction\n`;
            content += `            #     original.insert(1, bytecode.Instr("LOAD_CONST", 1, location=location))\n`;  
            content += `            #     original.insert(2, bytecode.Instr("LOAD_CONST", None, location=location))\n`;
            content += `            #     original.insert(3, bytecode.Instr("IMPORT_NAME", "debugpy", location=location))\n`;
            content += `            #     original.insert(4, bytecode.Instr("STORE_FAST", "debugpy", location=location))\n`;
            content += `            #     \n`;
            content += `            #     # Then insert bytecode instructions to call debugpy.breakpoint()\n`;
            content += `            #     original.insert(5, bytecode.Instr("LOAD_FAST", "debugpy", location=location))\n`;
            content += `            #     original.insert(6, bytecode.Instr("LOAD_ATTR", (True, "breakpoint"), location=location))\n`;
            content += `            #     original.insert(7, bytecode.Instr("PUSH_NULL", location=location))\n`;
            content += `            #     original.insert(8, bytecode.Instr("CALL", 0, location=location))\n`;
            content += `            #     original.insert(9, bytecode.Instr("POP_TOP", location=location))\n`;
            content += `            #     \n`;
            content += `            #     # Print modified bytecode for debugging\n`;
            content += `            #     print("Modified bytecode:")\n`;
            content += `            #     for i, instr in enumerate(original):\n`;
            content += `            #         print(f"  {i}: {instr}")\n`;
            content += `            #     \n`;
            content += `            #     # Update the function with the modified bytecode\n`;
            content += `            #     func.__code__ = original.to_code()\n`;
            content += `            #     print("Successfully modified function bytecode to add debugpy breakpoint")\n`;
            content += `            # else:\n`;
            content += `            #     print("Warning: Empty bytecode, cannot insert breakpoint")\n`;
            content += `        except Exception as e:\n`;
            content += `            print(f"Error during bytecode operation: {e}")\n`;
            content += `            import traceback\n`;
            content += `            traceback.print_exc()\n`;
            content += `        \n`;
            content += `        # Apply the monitoring decorator\n`;
            content += `        print("Applying monitoringpy.pymonitor_line decorator")\n`;
            content += `        func = monitoringpy.pymonitor_line(func)\n`;
            content += `        \n`;
            content += `        # Replace the original function in the module and globals\n`;
            content += `        setattr(module, function_name, func)\n`;
            content += `        globals()[function_name] = func\n`;
            content += `        \n`;
            content += `        return func\n`;
            content += `    except Exception as e:\n`;
            content += `        print(f"Error reloading function: {e}")\n`;
            content += `        import traceback\n`;
            content += `        traceback.print_exc()\n`;
            content += `        return None\n\n`;
            
            // Add a simple wrapper function to make reloading easier
            content += `# Simple wrapper to quickly reload the current function\n`;
            content += `def fast_reload():\n`;
            content += `    """Quickly reload the current function.\n`;
            content += `    Returns the reloaded function object.\n`;
            content += `    """\n`;
            content += `    return reload_and_modify_function("${moduleName}", "${functionInfo.name}")\n\n`;
            
            // Add the frame-finding utility function that will be used to load snapshots
            content += `# Utility function to find the correct frame and load a snapshot\n`;
            content += `def wrapper_load_snapshot(snapshot_id):\n`;
            content += `    import inspect\n`;
            content += `    import sys\n\n`;
            content += `    def find_target_frame():\n`;
            content += `        """Find the most appropriate frame from the current call stack"""\n`;
            content += `        frames = inspect.stack()\n\n`;
            content += `        # First try to find a frame that belongs to user code (not debugger internals)\n`;
            content += `        user_frames = []\n`;
            content += `        for frame_info in frames:\n`;
            content += `            # Skip debugger internal frames\n`;
            content += `            filename = frame_info.filename\n`;
            content += `            if any(x in filename for x in ['debugpy', '_pydevd_', 'pydevd_', '/usr/lib/python']):\n`;
            content += `                continue\n\n`;
            content += `            # Found user code - particularly look for our target function\n`;
            content += `            if frame_info.frame.f_code.co_name == "${functionInfo.name}":\n`;
            content += `                print(f"Found target function frame: {frame_info.function}")\n`;
            content += `                return frame_info.frame\n\n`;
            content += `            # Otherwise add to potential user frames\n`;
            content += `            user_frames.append(frame_info.frame)\n\n`;
            content += `        # If we found user frames, use the first one\n`;
            content += `        if user_frames:\n`;
            content += `            print(f"Using first user frame: {user_frames[0].f_code.co_name}")\n`;
            content += `            return user_frames[0]\n\n`;
            content += `        # Fallback: walk up the stack to find a plausible frame\n`;
            content += `        for frame_info in frames:\n`;
            content += `            # Find a frame that has non-empty locals (often a sign of user code)\n`;
            content += `            if frame_info.frame.f_locals and not frame_info.filename.startswith('/'):\n`;
            content += `                print(f"Using fallback frame: {frame_info.function}")\n`;
            content += `                return frame_info.frame\n\n`;
            content += `        # Last resort: just return the current frame\n`;
            content += `        print("Using current frame as last resort")\n`;
            content += `        return sys._getframe()\n\n`;
            content += `    # Find the best target frame\n`;
            content += `    target_frame = find_target_frame()\n\n`;
            content += `    # Try to load the snapshot into the identified frame\n`;
            content += `    try:\n`;
            content += `        print(f"Loading snapshot {snapshot_id} into frame {target_frame.f_code.co_name}")\n`;
            content += `        result = monitoringpy.load_snapshot_in_frame(\n`;
            content += `            db_path=db_path,\n`;
            content += `            snapshot_id=snapshot_id,\n`;
            content += `            frame=target_frame\n`;
            content += `        )\n`;
            content += `        print(f"Snapshot {snapshot_id} loaded with result: {result}")\n`;
            content += `        return True\n`;
            content += `    except Exception as e:\n`;
            content += `        print(f"Error loading snapshot: {e}")\n`;
            content += `        import traceback\n`;
            content += `        traceback.print_exc()\n`;
            content += `        return False\n\n`;
            
            // If using reanimation, use the monitoringpy library
            if (useReanimation && this.selectedFunctionCallId) {
                content += `# Find the database file\n`;
                content += `try:\n`;
                content += `    # First reload and modify the function with a debugpy breakpoint\n`;
                content += `    modified_function = reload_and_modify_function("${moduleName}", "${functionInfo.name}")\n`;
                content += `    \n`;
                content += `    # Load function execution data for inspection\n`;
                content += `    args, kwargs = monitoringpy.load_execution_data(\n`;
                content += `        function_execution_id="${this.selectedFunctionCallId}",\n`;
                content += `        db_path=db_path\n`;
                content += `    )\n`;
                content += `    \n`;
                content += `    # Call the modified function with exact arguments from the recorded execution\n`;
                content += `    result = modified_function(*args, **kwargs)\n`;
                content += `    \n`;
                content += `except Exception as e:\n`;
                content += `    print(f"Error during function reanimation: {e}")\n`;
                content += `    \n`;
                content += `    # Alternative: use full reanimation if direct call fails\n`;
                content += `    print("Trying full reanimation...")\n`;
                content += `    try:\n`;
                content += `        # Note: full reanimation may not use our modified function\n`;
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
                content += `    # First reload and modify the function with a debugpy breakpoint\n`;
                content += `    modified_function = reload_and_modify_function("${moduleName}", "${functionInfo.name}")\n`;
                content += `    # Call the modified function\n`;
                content += `    result = modified_function(${callArgs})\n`;
                content += `    print(f"Result: {result}")\n`;
                content += `    \n`;
                content += `    # Note: While debugging, you can also use the fast_reload() function to\n`;
                content += `    # quickly reload this function without needing to specify module or function name:\n`;
                content += `    # new_function = fast_reload()\n`;
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

    /**
     * Step over (next) in the current debug session
     */
    public async stepOver(): Promise<boolean> {
        try {
            const activeSession = vscode.debug.activeDebugSession;
            if (!activeSession) {
                vscode.window.showErrorMessage('No active debug session found');
                return false;
            }

            // Execute 'next' command on the active thread
            // Assuming thread ID 1, which is typically the main thread
            await activeSession.customRequest('next', { threadId: 1 });
            return true;
        } catch (error) {
            debugLog('Error executing step over command:', error);
            vscode.window.showErrorMessage(`Failed to execute step over: ${error}`);
            return false;
        }
    }

    /**
     * Evaluates an expression in the current debug context
     * @param expression The expression to evaluate
     * @param frameId Optional frame ID to evaluate in a specific stack frame
     * @param threadId Optional thread ID to evaluate in a specific thread
     * @returns The result of the evaluation or null if evaluation failed
     */
    public async evaluate(expression: string, frameId?: number, threadId?: number): Promise<any> {
        try {
            const session = vscode.debug.activeDebugSession;
            if (!session) {
                console.log('No active debug session');
                return null;
            }

            // Create the arguments for the evaluate request
            const args: any = {
                expression: expression,
                context: 'variables'
            };

            // Add frameId if provided
            if (frameId !== undefined) {
                args.frameId = frameId;
            }

            // Add threadId if provided
            if (threadId !== undefined) {
                args.threadId = threadId;
            }

            // Log more detailed information about our request
            console.log('=== DAP Evaluate Request ===');
            console.log(`Session ID: ${session.id}`);
            console.log(`Session Type: ${session.type}`);
            console.log(`Expression: ${expression}`);
            console.log(`Frame ID: ${frameId !== undefined ? frameId : 'Not specified'}`);
            console.log(`Thread ID: ${threadId !== undefined ? threadId : 'Not specified'}`);
            console.log(`Arguments: ${JSON.stringify(args)}`);

            // Send the evaluate request to the debug adapter
            console.log(`Sending evaluate request to debug adapter...`);
            const response = await session.customRequest('evaluate', args);
            
            // Log detailed response info
            console.log('=== DAP Evaluate Response ===');
            console.log(`Result: ${response.result}`);
            console.log(`Type: ${response.type}`);
            console.log(`Presentation Hint: ${response.presentationHint}`);
            console.log(`Variables Reference: ${response.variablesReference}`);
            console.log(`Named Variables: ${response.namedVariables}`);
            console.log(`Indexed Variables: ${response.indexedVariables}`);
            console.log(`Memory Reference: ${response.memoryReference}`);
            console.log('Full Response:', response);
            
            return response;
        } catch (error) {
            console.error('=== DAP Evaluate Error ===');
            console.error(`Error evaluating expression: ${expression}`);
            console.error(`Error details:`, error);
            return null;
        }
    }

    /**
     * Goes to a specific snapshot during a debug session
     * Uses the Debug Adapter Protocol's goto request and monitoringpy's load_snapshot_in_frame
     * 
     * @param snapshotId The ID of the snapshot to load
     * @param dbPath Path to the database file
     * @param frameId Optional frame ID to evaluate in a specific stack frame
     * @returns True if successful, false otherwise
     */
    public async goToSnapshot(snapshotId: number, dbPath: string, frameId?: number): Promise<boolean> {
        try {
            const session = vscode.debug.activeDebugSession;
            if (!session) {
                console.log('No active debug session');
                vscode.window.showErrorMessage('No active debug session found');
                return false;
            }

            console.log(`=== Go To Snapshot Debug Info ===`);
            console.log(`Snapshot ID: ${snapshotId}`);
            console.log(`DB Path: ${dbPath}`);
            console.log(`Frame ID provided: ${frameId !== undefined ? frameId : 'Not specified'}`);
            
            // Get the thread ID for the evaluation
            let threadId: number | undefined;
            try {
                console.log('Requesting thread information...');
                const threadsResponse = await session.customRequest('threads');
                console.log('Threads response:', threadsResponse);
                
                if (threadsResponse.threads && threadsResponse.threads.length > 0) {
                    // Use the first thread - typically the main thread
                    threadId = threadsResponse.threads[0].id;
                    console.log(`Using thread ID: ${threadId}`);
                    
                    // If no frameId provided, get stack frames and select one
                    if (frameId === undefined) {
                        const stackTraceResponse = await session.customRequest('stackTrace', {
                            threadId: threadId
                        });
                        
                        console.log('Stack frames:', stackTraceResponse);
                        
                        if (stackTraceResponse.stackFrames && stackTraceResponse.stackFrames.length > 0) {
                            // Get the first user code frame (not in system libraries)
                            const userFrames = stackTraceResponse.stackFrames.filter((frame: any) => {
                                const source = frame.source?.path || '';
                                return !source.includes('debugpy') && 
                                       !source.includes('/usr/lib/python') &&
                                       !source.startsWith('/home/jbdod/.vscode/extensions/');
                            });
                            
                            if (userFrames.length > 0) {
                                frameId = userFrames[0].id;
                                console.log(`Auto-selected frame ID: ${frameId} (${userFrames[0].name} at ${userFrames[0].source?.path}:${userFrames[0].line})`);
                            } else {
                                // Fall back to the top frame if no user frames found
                                frameId = stackTraceResponse.stackFrames[0].id;
                                console.log(`Auto-selected top frame ID: ${frameId} (${stackTraceResponse.stackFrames[0].name})`);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error getting thread/frame information:', error);
                // Continue with undefined threadId
            }
            
            // Now call the evaluate method with both frameId and threadId
            console.log(`Evaluating monitoringpy.load_snapshot_in_frame with frameId: ${frameId}, threadId: ${threadId}`);
            const loadSnapshotCommand = `monitoringpy.load_snapshot_in_frame(db_path="${dbPath}", snapshot_id=${snapshotId}, frame=None)`;
            
            try {
                const response = await this.evaluate(loadSnapshotCommand, frameId, threadId);
                console.log('Load snapshot response:', response);
                
                if (response && response.result !== '') {
                    console.log('Successfully loaded snapshot state');
                    vscode.window.showInformationMessage(`Successfully loaded state from snapshot #${snapshotId}`);
                    return true;
                } else {
                    console.error('Failed to load snapshot state:', response);
                    vscode.window.showErrorMessage(`Failed to load snapshot #${snapshotId} state`);
                    return false;
                }
            } catch (error) {
                console.error('Error loading snapshot state:', error);
                vscode.window.showErrorMessage(`Error loading snapshot state: ${error}`);
                return false;
            }
        } catch (error) {
            console.error('Error in goToSnapshot:', error);
            vscode.window.showErrorMessage(`Failed to go to snapshot: ${error}`);
            return false;
        }
    }

    /**
     * Gets valid goto targets for a specific line
     * @param line The source line number (1-based)
     * @param source Optional source information, if omitted will use the active editor
     * @param threadId Optional thread ID
     * @returns Array of GotoTarget objects or null if operation failed
     */
    public async getGotoTargets(line: number, source?: vscode.Uri, threadId?: number): Promise<any[] | null> {
        try {
            const session = vscode.debug.activeDebugSession;
            if (!session) {
                console.log('No active debug session');
                return null;
            }
            
            // If no source provided, try to get it from active editor
            if (!source) {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    console.error('No active editor found to get source for goto targets');
                    return null;
                }
                source = editor.document.uri;
            }
            
            console.log(`=== DAP GotoTargets Request ===`);
            console.log(`Source: ${source.toString()}`);
            console.log(`Line: ${line}`);
            
            // Create args for the gotoTargets request
            const gotoTargetsArgs = {
                source: {
                    path: source.fsPath
                },
                line: line
            };
            
            console.log(`Sending gotoTargets request with args: ${JSON.stringify(gotoTargetsArgs)}`);
            
            // Send the gotoTargets request
            const response = await session.customRequest('gotoTargets', gotoTargetsArgs);
            
            console.log('=== DAP GotoTargets Response ===');
            console.log('Full Response:', response);
            
            if (response && response.targets && response.targets.length > 0) {
                console.log(`Found ${response.targets.length} goto targets for line ${line}`);
                return response.targets;
            } else {
                console.log(`No goto targets found for line ${line}`);
                return [];
            }
        } catch (error) {
            console.error('=== DAP GotoTargets Error ===');
            console.error(`Error getting goto targets for line: ${line}`);
            console.error(`Error details:`, error);
            return null;
        }
    }

    /**
     * Navigates to a specific line in the current debug session
     * @param targetLine The line number to navigate to (1-based)
     * @param threadId Optional thread ID (defaults to using the first available thread)
     * @returns True if successful, false otherwise
     */
    public async gotoLine(targetLine: number, threadId?: number): Promise<boolean> {
        try {
            const session = vscode.debug.activeDebugSession;
            if (!session) {
                console.log('No active debug session');
                vscode.window.showErrorMessage('No active debug session found');
                return false;
            }
            
            console.log(`=== DAP Goto Line Debug Info ===`);
            console.log(`Target line: ${targetLine}`);
            console.log(`Thread ID provided: ${threadId !== undefined ? threadId : 'Not specified'}`);
            
            // Get the thread ID if not provided
            if (threadId === undefined) {
                try {
                    console.log('Requesting thread information for goto...');
                    const threadsResponse = await session.customRequest('threads');
                    console.log('Threads response:', threadsResponse);
                    
                    if (threadsResponse.threads && threadsResponse.threads.length > 0) {
                        // Use the first thread - typically the main thread
                        threadId = threadsResponse.threads[0].id;
                        console.log(`Using thread ID: ${threadId} for goto request`);
                    } else {
                        vscode.window.showErrorMessage('No threads found for goto operation');
                        return false;
                    }
                } catch (error) {
                    console.error('Error getting thread information for goto:', error);
                    vscode.window.showErrorMessage(`Error getting thread information: ${error}`);
                    return false;
                }
            }
            
            // First request valid goto targets for the line
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor found');
                return false;
            }
            
            const targets = await this.getGotoTargets(targetLine, editor.document.uri);
            if (!targets || targets.length === 0) {
                vscode.window.showErrorMessage(`No valid goto targets found for line ${targetLine}`);
                return false;
            }
            
            // Use the first available target
            const targetId = targets[0].id;
            console.log(`Using target ID: ${targetId} for goto request`);
            
            // Create the goto request arguments
            const gotoArgs = {
                threadId: threadId,
                targetId: targetId
            };
            
            console.log(`Sending goto request with args: ${JSON.stringify(gotoArgs)}`);
            
            // Send the goto request to the debug adapter
            const response = await session.customRequest('goto', gotoArgs);
            
            // Log detailed response info
            console.log('=== DAP Goto Response ===');
            console.log('Full Response:', response);
            
            vscode.window.showInformationMessage(`Navigated to line ${targetLine}`);
            return true;
        } catch (error) {
            console.error('=== DAP Goto Error ===');
            console.error(`Error navigating to line: ${targetLine}`);
            console.error(`Error details:`, error);
            vscode.window.showErrorMessage(`Failed to navigate to line ${targetLine}: ${error}`);
            return false;
        }
    }

    /**
     * Navigates to a specific line and loads a snapshot state in one operation
     * Useful for snapshot-based debugging where you want to move to a specific line
     * and restore the state at that point.
     * 
     * @param targetLine The line number to navigate to (1-based)
     * @param snapshotId The ID of the snapshot to load
     * @param dbPath Path to the database file
     * @returns True if successful, false otherwise
     */
    public async gotoLineAndLoadState(targetLine: number, snapshotId: number, dbPath: string): Promise<boolean> {
        try {
            const session = vscode.debug.activeDebugSession;
            if (!session) {
                console.log('No active debug session');
                vscode.window.showErrorMessage('No active debug session found');
                return false;
            }
            
            console.log(`=== DAP Goto Line and Load State ===`);
            console.log(`Target line: ${targetLine}`);
            console.log(`Snapshot ID: ${snapshotId}`);
            console.log(`DB Path: ${dbPath}`);
            
            // Get the active editor
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor found');
                return false;
            }
            
            // First, get thread information
            let threadId: number | undefined;
            try {
                console.log('Requesting thread information...');
                const threadsResponse = await session.customRequest('threads');
                console.log('Threads response:', threadsResponse);
                
                if (threadsResponse.threads && threadsResponse.threads.length > 0) {
                    // Use the first thread - typically the main thread
                    threadId = threadsResponse.threads[0].id;
                    console.log(`Using thread ID: ${threadId}`);
                } else {
                    vscode.window.showErrorMessage('No threads found for operation');
                    return false;
                }
            } catch (error) {
                console.error('Error getting thread information:', error);
                vscode.window.showErrorMessage(`Error getting thread information: ${error}`);
                return false;
            }
            
            // Get goto targets for the line
            console.log(`Getting goto targets for line ${targetLine}...`);
            const targets = await this.getGotoTargets(targetLine, editor.document.uri);
            if (!targets || targets.length === 0) {
                vscode.window.showErrorMessage(`No valid goto targets found for line ${targetLine}`);
                return false;
            }
            
            // Use the first available target
            const targetId = targets[0].id;
            console.log(`Using target ID: ${targetId} for goto request`);
            
            // First, navigate to the target line
            console.log(`Step 1: Navigating to line ${targetLine} with target ID ${targetId}`);
            try {
                const gotoArgs = {
                    threadId: threadId,
                    targetId: targetId
                };
                
                console.log(`Sending goto request with args: ${JSON.stringify(gotoArgs)}`);
                const gotoResponse = await session.customRequest('goto', gotoArgs);
                console.log(`Goto response:`, gotoResponse);
            } catch (error) {
                console.error('Failed to navigate to line:', error);
                vscode.window.showErrorMessage(`Failed to navigate to line ${targetLine}: ${error}`);
                return false;
            }
            
            // Then, load the snapshot state
            console.log(`Step 2: Loading snapshot state ${snapshotId}`);
            const stateResult = await this.goToSnapshot(snapshotId, dbPath);
            if (!stateResult) {
                console.error('Failed to load state');
                return false;
            }
            
            console.log('Successfully navigated to line and loaded state');
            vscode.window.showInformationMessage(`Navigated to line ${targetLine} and loaded snapshot #${snapshotId}`);
            return true;
        } catch (error) {
            console.error('=== DAP Goto and Load State Error ===');
            console.error(`Error details:`, error);
            vscode.window.showErrorMessage(`Failed to navigate and load state: ${error}`);
            return false;
        }
    }
} 