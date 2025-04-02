import * as vscode from 'vscode';
import { FunctionData, StackTraceResponse } from '../types';
import { getWebviewContent } from '../utils/webview';
import { highlightLine } from '../utils/highlight';
import { state, debugLog } from './state';
import { getStackTrace, getFunctionTraces } from './api';

export function showFunctionDetails(functions: FunctionData[], context: vscode.ExtensionContext) {
    state.currentFunctionData = functions;
    
    // Store the current editor when first opening the panel
    if (!state.functionDetailsPanel) {
        state.currentEditor = vscode.window.activeTextEditor;
    }
    
    if (state.functionDetailsPanel) {
        // Update existing panel
        state.functionDetailsPanel.title = 'Function Details';
        updateFunctionDetailsPanel(functions, context);
        state.functionDetailsPanel.reveal(vscode.ViewColumn.Beside);
    } else {
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

        // Add message handler for the panel
        state.functionDetailsPanel.webview.onDidReceiveMessage(async message => {
            debugLog('Received message from webview:', message);
            if (message.command === 'exploreStackTrace') {
                console.log('Received stack trace exploration request for function:', message.functionId);
                const functionId = message.functionId;
                const functionData = functions.find(f => f.id === functionId);
                if (functionData) {
                    await exploreStackTrace(functionId, context);
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
                updateFunctionDetailsPanel(state.currentFunctionData, context);
            } else if (message.command === 'highlightLine' && state.currentEditor) {
                // Only highlight lines when explicitly requested by the panel
                highlightLine(state.currentEditor, message.line);
            } else if (message.command === 'sliderChange' && state.functionDetailsPanel) {
                debugLog('Received slider change:', message.value);
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

        updateFunctionDetailsPanel(functions, context);
        state.functionDetailsPanel.reveal(vscode.ViewColumn.Beside);
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
                <button class="action-button explore-stack-trace" data-function-id="${func.id}">
                    <span class="codicon codicon-debug"></span> Explore Stack Trace
                </button>
            </div>
        </div>
    `).join('');

    // Replace the content placeholder in the template
    const finalHtml = htmlContent.replace('<div id="content"></div>', `<div id="content">${content}</div>`);

    state.functionDetailsPanel.webview.html = finalHtml;
}

async function exploreStackTrace(functionId: string, context: vscode.ExtensionContext) {
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
            return;
        }

        // Highlight the initial line in the editor
        if (state.currentEditor && data.snapshots.length > 0) {
            highlightLine(state.currentEditor, data.snapshots[0].line);
        }

        // Get the webview content
        const htmlContent = getWebviewContent(state.functionDetailsPanel.webview, 'html/stackTrace.html', context);
        
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