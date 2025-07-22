import * as vscode from 'vscode';
import * as path from 'path';
import { FunctionData, StackTraceResponse } from '../types';
import { getWebviewContent } from '../utils/webview';
import { highlightLine, clearHighlight } from '../utils/highlight';
import { state, debugLog } from './state';
import { getStackTrace, getFunctionTraces, getFunctionData, refreshApiData, getTracesList, compareTraces } from './api';

export function showFunctionDetails(functions: FunctionData[], context: vscode.ExtensionContext) {
    state.currentFunctionData = functions;
    
    // Store the current editor when first opening the panel
    if (!state.functionDetailsPanel) {
        state.currentEditor = vscode.window.activeTextEditor;
    }
    
    // Check if panel exists and is not disposed
    if (state.functionDetailsPanel) {
        try {
            // Try to access the webview property - this will throw if disposed
            const isAccessible = state.functionDetailsPanel.webview;
            
            if (state.functionDetailsPanel.active) {
                // Update existing panel
                state.functionDetailsPanel.title = 'Function Details';
                updateFunctionDetailsPanel(functions, context);
                state.functionDetailsPanel.reveal(vscode.ViewColumn.Beside);
                return;
            } else {
                // Panel exists but is not active, reveal it
                updateFunctionDetailsPanel(functions, context);
                state.functionDetailsPanel.reveal(vscode.ViewColumn.Beside);
                return;
            }
        } catch (error) {
            // Panel is disposed, clear the reference
            debugLog('Webview panel is disposed, creating new one');
            state.functionDetailsPanel = undefined;
        }
    }
    
    // Create new panel
    state.functionDetailsPanel = vscode.window.createWebviewPanel(
        'functionDetails',
        'Function Details',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
            retainContextWhenHidden: true
        }
    );

    // Add disposal listener to clean up state
    state.functionDetailsPanel.onDidDispose(() => {
        debugLog('Webview panel disposed, clearing state');
        state.functionDetailsPanel = undefined;
        state.isInStackTraceView = false;
        // Clear any existing highlights
        clearHighlight();
    });

    // Listen for debug session changes to update button state
    const debugSessionListener = vscode.debug.onDidChangeActiveDebugSession((session) => {
        console.log('[JB]Debug session changed:', session);
        if (state.functionDetailsPanel && state.isInStackTraceView) {
            const isDebugging = session !== undefined;
            state.functionDetailsPanel.webview.postMessage({
                command: 'debugSessionStatus',
                isDebugging: isDebugging
            });
        }
    });

    // Add message handler for the panel
    state.functionDetailsPanel.webview.onDidReceiveMessage(async message => {
        debugLog('Received message from webview:', message);
        if (message.command === 'exploreStackTrace') {
            console.log('Received stack trace exploration request for function:', message.functionId);
            const functionId = parseInt(message.functionId);
            
            // First, check if the function is in our current set
            let functionData = functions.find(f => f.id === functionId);
            
            // If not found in the current set, check in the most recent data
            if (!functionData && state.currentFunctionData) {
                functionData = state.currentFunctionData.find(f => f.id === functionId);
            }
            
            // Either way, try to explore the stack trace if the ID is provided
            try {
                await exploreStackTrace(functionId, context);
            } catch (error) {
                console.error('Error exploring stack trace:', error);
                vscode.window.showErrorMessage(`Failed to explore stack trace for function ID ${functionId}`);
            }
        } else if (message.command === 'backToFunctions') {
            debugLog('Going back to functions list');
            // Remove highlight when going back to function list
            clearHighlight();
            state.isInStackTraceView = false;
            if (state.currentFunctionData) {
                updateFunctionDetailsPanel(state.currentFunctionData, context);
            }
        } else if (message.command === 'highlightLine' && state.currentEditor) {
            // Only highlight lines when explicitly requested by the panel
            // Move cursor when user explicitly clicks on a line in the webview
            highlightLine(state.currentEditor, message.line, true);
        } else if (message.command === 'reloadFunctionData') {
            debugLog('Reloading function data');
            await reloadFunctionData(context);
        } else if (message.command === 'goToSnapshotState') {
            console.log('Go to snapshot state:', message.snapshotId, 'DB path:', message.dbPath, 'Line:', message.line);
            
            // Focus on state loading only - navigation can be added later once this works
            if (message.snapshotId !== undefined && message.dbPath) {
                console.log('Loading snapshot state directly without navigation');
                vscode.commands.executeCommand('pymonitor.goToSnapshotState', message.snapshotId, message.dbPath);
            } else {
                console.error('Missing required parameters for goToSnapshotState');
            }
        } else if (message.command === 'reloadStackRecording') {
            debugLog('Reloading stack recording data');
            await reloadStackRecordingData(context);
        } else if (message.command === 'getTracesList') {
            debugLog('Received getTracesList command');
            debugLog('About to call getTracesList API function');
            try {
                const traces = await getTracesList();
                debugLog('getTracesList API returned:', traces?.length || 0, 'traces');
                if (traces && state.functionDetailsPanel) {
                    debugLog('Sending tracesListLoaded message to webview');
                    state.functionDetailsPanel.webview.postMessage({
                        command: 'tracesListLoaded',
                        traces: traces
                    });
                    debugLog('Traces list sent to webview');
                } else {
                    debugLog('Failed to get traces list or panel not available');
                    debugLog('- traces available:', !!traces);
                    debugLog('- panel available:', !!state.functionDetailsPanel);
                    if (!state.functionDetailsPanel) {
                        vscode.window.showErrorMessage('Function details panel is not available');
                    } else {
                        vscode.window.showErrorMessage('Failed to get traces list');
                    }
                }
            } catch (error) {
                debugLog('Error getting traces list:', error);
                vscode.window.showErrorMessage('Failed to get traces list');
            }
        } else if (message.command === 'compareTraces') {
            debugLog('Received compareTraces command');
            debugLog('Trace1Id:', message.trace1Id, 'Trace2Id:', message.trace2Id);
            debugLog('About to call compareTraces API function');
            try {
                const result = await compareTraces(message.trace1Id, message.trace2Id);
                debugLog('compareTraces API returned result:', !!result);
                if (result && state.functionDetailsPanel) {
                    debugLog('Getting trace data for display...');
                    // Get the trace data for display
                    const currentTraceData = await getStackTrace(message.trace1Id);
                    const compareTraceData = await getStackTrace(message.trace2Id);
                    debugLog('Current trace data loaded:', !!currentTraceData);
                    debugLog('Compare trace data loaded:', !!compareTraceData);
                    
                    debugLog('Sending comparisonResult message to webview');
                    state.functionDetailsPanel.webview.postMessage({
                        command: 'comparisonResult',
                        success: true,
                        data: result,
                        currentTraceData: currentTraceData,
                        compareTraceData: compareTraceData
                    });
                    debugLog('Traces comparison result sent to webview');
                } else {
                    debugLog('Failed to compare traces or panel not available');
                    debugLog('- result available:', !!result);
                    debugLog('- panel available:', !!state.functionDetailsPanel);
                    if (!state.functionDetailsPanel) {
                        vscode.window.showErrorMessage('Function details panel is not available');
                    } else {
                        vscode.window.showErrorMessage('Failed to compare traces');
                        state.functionDetailsPanel.webview.postMessage({
                            command: 'comparisonResult',
                            success: false,
                            error: 'Failed to compare traces'
                        });
                    }
                }
            } catch (error) {
                debugLog('Error comparing traces:', error);
                vscode.window.showErrorMessage('Failed to compare traces');
                if (state.functionDetailsPanel) {
                    state.functionDetailsPanel.webview.postMessage({
                        command: 'comparisonResult',
                        success: false,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                }
            }
        }
    });

    updateFunctionDetailsPanel(functions, context);
    state.functionDetailsPanel.reveal(vscode.ViewColumn.Beside);
}

/**
 * Reload function data from the API for the current file
 */
async function reloadFunctionData(context: vscode.ExtensionContext): Promise<void> {
    try {
        if (!state.currentEditor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const filePath = state.currentEditor.document.fileName;
        debugLog(`Reloading function data for ${filePath}`);

        // Fetch fresh data from the API
        const refreshedData = await getFunctionData(filePath);
        
        if (!refreshedData) {
            vscode.window.showErrorMessage('Failed to reload function data');
            return;
        }

        // Update the state
        state.functionDataCache.set(filePath, refreshedData);
        state.currentFunctionData = refreshedData;

        // Update the webview
        if (state.functionDetailsPanel) {
            // If in stack trace view, go back to function list
            if (state.isInStackTraceView) {
                state.isInStackTraceView = false;
                
                // Clear any existing highlights
                clearHighlight();
            }
            
            // Update the panel with new data
            updateFunctionDetailsPanel(refreshedData, context);
            
            // Give the webview a moment to update before sending the message
            setTimeout(() => {
                if (state.functionDetailsPanel) {
                    // Notify the webview that data has been reloaded
                    state.functionDetailsPanel.webview.postMessage({
                        command: 'dataReloaded'
                    });
                    
                    debugLog('Function data reloaded successfully');
                }
            }, 100);
        }
    } catch (error) {
        console.error('Error reloading function data:', error);
        vscode.window.showErrorMessage('Failed to reload function data');
    }
}

function updateFunctionDetailsPanel(functions: FunctionData[], context: vscode.ExtensionContext) {
    if (!state.functionDetailsPanel) {
        return;
    }

    // Reset stack trace view flag when going back to function list
    state.isInStackTraceView = false;

    // Get the webview content
    const htmlContent = getWebviewContent(state.functionDetailsPanel.webview, 'html/functionDetails.html', context);
    
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
                <div>Duration: ${func.duration !== null && func.duration !== undefined ? func.duration.toFixed(3) : 'unknown'}s</div>
            </div>
            <div class="section">
                <h4>Arguments</h4>
                <div class="variables-grid">
                    ${Object.entries(func.locals || {}).map(([name, data]) => `
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
                        <div class="variable-type">${func.return_value?.type || 'None'}</div>
                        <div class="variable-value">${func.return_value?.value || 'None'}</div>
                    </div>
                </div>
            </div>
            <div class="function-actions">
                ${func.has_stack_recording ? `
                <button class="action-button explore-stack-trace" data-function-id="${func.id}">
                    <span class="codicon codicon-debug"></span> Explore Stack Trace
                </button>
                ` : `
                <button class="action-button explore-stack-trace" disabled>
                    <span class="codicon codicon-debug"></span> No Stack Recording
                </button>
                `}
            </div>
        </div>
    `).join('');

    // Replace the content placeholder in the template
    const finalHtml = htmlContent.replace('<div id="content"></div>', `<div id="content">${content}</div>`);

    state.functionDetailsPanel.webview.html = finalHtml;
}

// Export the exploreStackTrace function so it can be used by the extension
export async function exploreStackTrace(functionId: number | string, context: vscode.ExtensionContext) {
    try {
        const data = await getStackTrace(functionId);
        if (!data) {
            vscode.window.showErrorMessage('Failed to fetch stack trace data');
            return;
        }

        // Store the stack trace data in state
        state.currentStackTraceData = data;

        // Reset step counter and set stack trace view flag
        state.currentStep = 0;
        state.isInStackTraceView = true;

        if (!state.functionDetailsPanel) {
            vscode.window.showErrorMessage('Function details panel is not available');
            return;
        }
        
        // Check if the webview is disposed
        try {
            const isAccessible = state.functionDetailsPanel.webview;
        } catch (error) {
            vscode.window.showErrorMessage('Function details panel is disposed. Please reopen it from the codelens.');
            return;
        }

        // Get the webview content
        const htmlContent = getWebviewContent(state.functionDetailsPanel.webview, 'html/stackRecording.html', context);
        
        // Generate the stack trace content
        const content = `
            <div class="stack-trace-container">
                <div class="header">
                    <h3>${data.function.name}</h3>
                    <div class="file-info">${data.function.file}:${data.function.line}</div>
                </div>
                <div class="timeline">
                    <h4>Execution Timeline</h4>
                    <div class="timeline-controls">
                        <button class="timeline-button" id="prevButton" ${data.frames.length <= 1 ? 'disabled' : ''}>
                            <span class="codicon codicon-chevron-left"></span> Previous
                        </button>
                        <div class="timeline-slider">
                            <input type="range" 
                                   id="timelineSlider" 
                                   min="0" 
                                   max="${data.frames.length - 1}" 
                                   value="0"
                                   step="1">
                            <div class="timeline-info">
                                Step <span id="currentStep">1</span> of ${data.frames.length}
                            </div>
                        </div>
                        <button class="timeline-button" id="nextButton" ${data.frames.length <= 1 ? 'disabled' : ''}>
                            Next <span class="codicon codicon-chevron-right"></span>
                        </button>
                    </div>
                    <div class="debug-actions">
                        <button class="debug-action-button" id="goToStateButton">
                            <span class="codicon codicon-debug-alt"></span> Load State at this Point
                        </button>
                    </div>
                </div>
                
                <!-- Current Frame Display - This was missing -->
                <div class="frame" id="currentFrame">
                    <div class="frame-header">
                        <span class="frame-line">Line ${data.frames[0]?.line || 'N/A'}</span>
                        <span class="frame-time">${data.frames[0] ? new Date(data.frames[0].timestamp).toLocaleTimeString() : 'N/A'}</span>
                    </div>
                    <div class="frame-locals">
                        ${data.frames[0]?.locals ? 
                            Object.entries(data.frames[0].locals).map(([name, value]) => `
                                <div class="local-variable">
                                    <span class="var-name">${name}:</span>
                                    <span class="var-value">${value.value}</span>
                                </div>
                            `).join('') : 
                            '<div class="empty-message">No local variables</div>'
                        }
                    </div>
                </div>

                <!-- Local Timeline Section -->
                <div class="local-timeline">
                    <h4>Line-specific Timeline</h4>
                    <div class="timeline-controls">
                        <button class="timeline-button" id="localPrevButton">
                            <span class="codicon codicon-chevron-left"></span> Prev
                        </button>
                        <div class="timeline-slider">
                            <input type="range" 
                                   id="localTimelineSlider" 
                                   min="0" 
                                   max="0" 
                                   value="0"
                                   step="1">
                            <div class="timeline-info">
                                Step <span id="localCurrentStep">1</span> of <span id="localTotalSteps">1</span>
                            </div>
                        </div>
                        <button class="timeline-button" id="localNextButton">
                            Next <span class="codicon codicon-chevron-right"></span>
                        </button>
                    </div>
                </div>

                <div class="variables-container">
                    <div class="variable-section">
                        <h4>Global Variables</h4>
                        <div class="variables-grid" id="globals">
                            ${data.frames[0]?.globals ? 
                                Object.entries(data.frames[0].globals).map(([name, data]) => `
                                    <div class="variable-card">
                                        <div class="variable-name">${name}</div>
                                        <div class="variable-type">${data.type}</div>
                                        <div class="variable-value">${data.value}</div>
                                    </div>
                                `).join('') : 
                                '<div class="empty-message">No global variables</div>'
                            }
                        </div>
                    </div>
                </div>
            </div>
            <div class="actions">
                <button class="back-button" id="backButton">
                    <span class="codicon codicon-arrow-left"></span> Back to Function List
                </button>
            </div>
        `;

        // Set the HTML content
        state.functionDetailsPanel.webview.html = htmlContent.replace('<div id="content"></div>', content);

        // Update the panel title
        state.functionDetailsPanel.title = `Stack Recording - ${data.function.name}`;

        // Send the stack trace data to the webview
        state.functionDetailsPanel.webview.postMessage({
            command: 'updateStackTrace',
            data: data,
            snapshots: data.frames
        });

        // Send initial snapshots to initialize the UI
        state.functionDetailsPanel.webview.postMessage({
            command: 'setSnapshots',
            snapshots: data.frames,
            functionId: data.function.id,
            functionData: data.function
        });

        // Send database path to the webview
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(state.currentEditor?.document.uri!);
        if (workspaceFolder) {
            const dbPath = path.join(workspaceFolder.uri.fsPath, 'main.db');
            state.functionDetailsPanel.webview.postMessage({
                command: 'setDbPath',
                dbPath: dbPath
            });
        }

        // Send debug session status to enable/disable the "Load State" button
        const isDebugging = vscode.debug.activeDebugSession !== undefined;
        state.functionDetailsPanel.webview.postMessage({
            command: 'debugSessionStatus',
            isDebugging: isDebugging
        });

        // Highlight the first step's line
        if (data.frames.length > 0) {
            const lineNumber = data.frames[0].line;
            // Only highlight if we have a line number
            if (lineNumber) {
                if (state.currentEditor) {
                    // Don't move cursor when just refreshing highlights during data reload
                    highlightLine(state.currentEditor, lineNumber, false);
                }
            }
        }
    } catch (error) {
        console.error('Error exploring stack trace:', error);
        if (error instanceof Error) {
            vscode.window.showErrorMessage(`Failed to explore stack trace: ${error.message}`);
        } else {
            vscode.window.showErrorMessage('Failed to explore stack trace');
        }
    }
}

/**
 * Reload stack recording data for the current function
 */
async function reloadStackRecordingData(context: vscode.ExtensionContext): Promise<void> {
    try {
        if (!state.functionDetailsPanel || !state.currentStackTraceData) {
            debugLog('No active stack recording panel or data');
            return;
        }

        debugLog('Reloading stack recording data...');
        
        // First refresh the API data
        const refreshSuccess = await refreshApiData();
        if (!refreshSuccess) {
            debugLog('WARNING: Failed to refresh API data, continuing anyway...');
        }

        // Get the function ID from current stack trace data
        const functionId = state.currentStackTraceData.function.id;
        if (!functionId) {
            debugLog('No function ID available for reload');
            return;
        }

        debugLog(`Fetching fresh stack trace data for function ID: ${functionId}`);
        
        // Fetch fresh stack trace data
        const freshData = await getStackTrace(functionId);
        if (!freshData) {
            debugLog('Failed to fetch fresh stack trace data');
            vscode.window.showErrorMessage('Failed to reload stack recording data');
            return;
        }

        debugLog(`Received ${freshData.frames.length} frames in fresh data`);

        // Update the current stack trace data in state
        state.currentStackTraceData = freshData;

        // Send updated data to the webview
        if (state.functionDetailsPanel) {
            state.functionDetailsPanel.webview.postMessage({
                command: 'updateStackTrace',
                data: freshData,
                snapshots: freshData.frames
            });
            
            debugLog('Stack recording data reloaded and sent to webview');
            
            // Show a brief success message
            vscode.window.showInformationMessage('Stack recording data reloaded', { modal: false });
        }

    } catch (error) {
        debugLog('Error reloading stack recording data:', error);
        vscode.window.showErrorMessage(`Failed to reload stack recording data: ${error}`);
    }
} 