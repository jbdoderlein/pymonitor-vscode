(function() {
    const vscode = acquireVsCodeApi();

    // Get DOM elements (will be set after content loads)
    let backButton = null;
    let timelineSlider = null;
    let prevButton = null;
    let nextButton = null;
    let currentStepDisplay = null;
    let currentFrame = null;
    
    // Local timeline elements
    let localTimelineSlider = null;
    let localPrevButton = null;
    let localNextButton = null;
    let localCurrentStepDisplay = null;
    let localTotalStepsDisplay = null;
    
    // Debug action elements
    let goToStateButton = null;
    
    // Store snapshots data and current steps
    let snapshots = [];
    let currentStep = 0;      // Current position in the global timeline
    let localSnapshots = [];  // Snapshots for the current line
    let localStep = 0;        // Current position in the local timeline
    let dbPath = '';          // Path to the database - will be set when data is loaded
    let isDebugging = false;  // Flag to track if there's an active debug session
    
    // Helper to log debug messages
    function debugLog(...args) {
        // Uncomment this line for debugging
        console.log(...args);
    }
    
    // Initialize DOM elements and event listeners after content is loaded
    function initializeEventListeners() {
        debugLog('Initializing event listeners');
        
        // Get DOM elements
        backButton = document.getElementById('backButton');
        timelineSlider = document.getElementById('timelineSlider');
        prevButton = document.getElementById('prevButton');
        nextButton = document.getElementById('nextButton');
        currentStepDisplay = document.getElementById('currentStep');
        currentFrame = document.getElementById('currentFrame');
        
        // Local timeline elements
        localTimelineSlider = document.getElementById('localTimelineSlider');
        localPrevButton = document.getElementById('localPrevButton');
        localNextButton = document.getElementById('localNextButton');
        localCurrentStepDisplay = document.getElementById('localCurrentStep');
        localTotalStepsDisplay = document.getElementById('localTotalSteps');
        
        // Debug action elements
        goToStateButton = document.getElementById('goToStateButton');
        
        setupEventListeners();
    }
    
    // Set up all event listeners
    function setupEventListeners() {
        // Handle back button click
        if (backButton) {
            debugLog('Setting up back button event listener');
            backButton.addEventListener('click', () => {
                debugLog('Back button clicked, sending backToFunctions message');
                vscode.postMessage({
                    command: 'backToFunctions'
                });
            });
        } else {
            debugLog('Back button not found');
        }
    
        // Handle timeline slider change
        if (timelineSlider) {
            timelineSlider.addEventListener('input', (event) => {
                const newStep = parseInt(event.target.value);
                if (newStep !== currentStep && newStep >= 0 && newStep < snapshots.length) {
                    updateCurrentStepAndUI(newStep);
                }
            });
        }
        
        // Handle previous button click
        if (prevButton) {
            prevButton.addEventListener('click', () => {
                if (currentStep > 0) {
                    updateCurrentStepAndUI(currentStep - 1);
                }
            });
        }
        
        // Handle next button click
        if (nextButton) {
            nextButton.addEventListener('click', () => {
                if (currentStep < snapshots.length - 1) {
                    updateCurrentStepAndUI(currentStep + 1);
                }
            });
        }

        // Handle local timeline slider change
        if (localTimelineSlider) {
            localTimelineSlider.addEventListener('input', (event) => {
                const value = parseInt(event.target.value);
                if (value !== localStep && localSnapshots.length > 0) {
                    localStep = value;
                    // Map local step to global step
                    const snapshot = localSnapshots[localStep];
                    const globalIndex = snapshots.findIndex(s => s.snapshot_id === snapshot.snapshot_id);
                    
                    if (globalIndex !== -1 && globalIndex !== currentStep) {
                        updateCurrentStepAndUI(globalIndex);
                    }
                }
            });
        }
        
        // Handle local previous button click
        if (localPrevButton) {
            localPrevButton.addEventListener('click', () => {
                if (localStep > 0 && localSnapshots.length > 0) {
                    localStep--;
                    // Map local step to global step
                    const snapshot = localSnapshots[localStep];
                    const globalIndex = snapshots.findIndex(s => s.snapshot_id === snapshot.snapshot_id);
                    
                    if (globalIndex !== -1 && globalIndex !== currentStep) {
                        updateCurrentStepAndUI(globalIndex);
                    }
                }
            });
        }
        
        // Handle local next button click
        if (localNextButton) {
            localNextButton.addEventListener('click', () => {
                if (localStep < localSnapshots.length - 1 && localSnapshots.length > 0) {
                    localStep++;
                    // Map local step to global step
                    const snapshot = localSnapshots[localStep];
                    const globalIndex = snapshots.findIndex(s => s.snapshot_id === snapshot.snapshot_id);
                    
                    if (globalIndex !== -1 && globalIndex !== currentStep) {
                        updateCurrentStepAndUI(globalIndex);
                    }
                }
            });
        }
        
        // Handle "Go to this state" button click
        if (goToStateButton) {
            goToStateButton.addEventListener('click', () => {
                if (snapshots.length > 0 && currentStep < snapshots.length) {
                    const snapshot = snapshots[currentStep];
                    debugLog(`Go to snapshot state feature disabled - database path not available`);
                    
                    // For now, just show a message that this feature is not available
                    // Once we have the database path from the API, this can be re-enabled
                    debugLog(`Snapshot ID: ${snapshot.snapshot_id} would be loaded if database path was available`);
                    
                    // Uncomment this when database path is available:
                    // vscode.postMessage({
                    //     command: 'goToSnapshotState',
                    //     snapshotId: snapshot.snapshot_id,
                    //     dbPath: dbPath
                    // });
                }
            });
        }
    }
    
    // Consolidated function to update current step and UI
    function updateCurrentStepAndUI(newStep) {
        debugLog('Updating current step from', currentStep, 'to', newStep);
        currentStep = newStep;
        
        // Sync slider with current step
        if (timelineSlider) {
            timelineSlider.value = currentStep;
        }
        
        // Update UI
        updateCurrentFrame();
        
        // Request highlight update
        requestHighlight(snapshots[currentStep].line);
        
        // Make sure the table is highlighted for the current snapshot
        highlightCurrentSnapshotInTable();
    }
    
    // Highlight the current snapshot in the variables change table
    function highlightCurrentSnapshotInTable() {
        const rows = document.querySelectorAll('.var-changes-table tbody tr');
        if (!rows.length) return;
        
        // Find the row that corresponds to the current local step
        rows.forEach((row, index) => {
            if (index === localStep) {
                row.classList.add('current-snapshot');
            } else {
                row.classList.remove('current-snapshot');
            }
        });
    }
    
    // Single function to request line highlights
    function requestHighlight(line) {
        vscode.postMessage({
            command: 'highlightLine',
            line: line
        });
    }
    
    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        debugLog('Received message from extension:', message);

        switch (message.command) {
            case 'setSnapshots':
                debugLog('Setting snapshots:', message.snapshots.length);
                // Use snapshots directly from API without reordering
                snapshots = message.snapshots;
                
                currentStep = 0;
                
                // Initialize event listeners now that content is loaded
                initializeEventListeners();
                
                if (timelineSlider) {
                    timelineSlider.value = currentStep;
                    timelineSlider.max = snapshots.length - 1;
                }
                
                updateCurrentFrame();
                
                // Request initial highlight
                if (snapshots.length > 0) {
                    requestHighlight(snapshots[0].line);
                }
                break;

            case 'setDbPath':
                // Store the db path from the extension
                dbPath = message.dbPath;
                debugLog('Set database path:', dbPath);
                break;
                
            case 'debugSessionStatus':
                // Update the debugging status
                isDebugging = message.isDebugging;
                
                // Enable or disable the "Go to this state" button based on debugging status
                if (goToStateButton) {
                    goToStateButton.disabled = !isDebugging;
                    debugLog(`Debug session status changed to: ${isDebugging}, button enabled: ${!goToStateButton.disabled}`);
                }
                break;

            case 'updateStep':
                debugLog('Updating step:', message.step);
                updateCurrentStepAndUI(message.step);
                break;
                
            case 'updateStackTrace':
                debugLog('Updating stack trace data from debug session');
                // Update data during debugging
                if (message.snapshots && message.snapshots.length > 0) {
                    const previousLength = snapshots.length;
                    snapshots = message.snapshots;
                    
                    // Log frame details for debugging
                    debugLog(`Received ${snapshots.length} snapshots in update`);
                    if (snapshots.length > 0) {
                        debugLog(`First snapshot: Line ${snapshots[0].line}, ID ${snapshots[0].snapshot_id}`);
                        debugLog(`Last snapshot: Line ${snapshots[snapshots.length-1].line}, ID ${snapshots[snapshots.length-1].snapshot_id}`);
                    }
                    
                    // Update UI elements
                    if (previousLength !== snapshots.length) {
                        debugLog(`Snapshots count changed from ${previousLength} to ${snapshots.length}`);
                        
                        // Update global timeline slider
                        if (timelineSlider) {
                            timelineSlider.max = snapshots.length - 1;
                        }
                        
                        // Always move to the latest snapshot if we have new ones
                        if (snapshots.length > previousLength) {
                            currentStep = snapshots.length - 1;
                            if (timelineSlider) {
                                timelineSlider.value = currentStep;
                            }
                            
                            // Only show visual feedback when there are new frames
                            const container = document.querySelector('.stack-trace-container');
                            if (container) {
                                // Add a temporary class for visual feedback - less flashy
                                container.classList.add('data-updated');
                                
                                setTimeout(() => {
                                    container.classList.remove('data-updated');
                                }, 500);
                            }
                        }
                    }
                    
                    // Always update UI regardless of whether length changed
                    updateCurrentFrame();
                    
                    // Update local timeline and variables table too
                    updateLocalTimeline();
                    updateVariablesChangeTable();
                    
                    // Request highlight update for current line
                    if (snapshots.length > 0 && currentStep < snapshots.length) {
                        requestHighlight(snapshots[currentStep].line);
                    }
                    
                    // Only show the debug overlay when the number of frames changes significantly
                    if (Math.abs(previousLength - snapshots.length) > 2) {
                        const debugOverlay = document.getElementById('debug-update-overlay');
                        if (!debugOverlay) {
                            const overlay = document.createElement('div');
                            overlay.id = 'debug-update-overlay';
                            overlay.className = 'debug-overlay';
                            document.body.appendChild(overlay);
                        }
                        
                        const overlay = document.getElementById('debug-update-overlay');
                        if (overlay) {
                            const now = new Date();
                            overlay.textContent = `Updated: ${now.toLocaleTimeString()} (${snapshots.length} frames)`;
                            overlay.style.display = 'block';
                            setTimeout(() => {
                                overlay.style.opacity = '0';
                                setTimeout(() => {
                                    overlay.style.display = 'none';
                                    overlay.style.opacity = '1';
                                }, 500);
                            }, 3000);
                        }
                    }
                }
                break;

            case 'editorLineClick':
                debugLog('Editor line clicked:', message.line);
                
                // Find chronologically first snapshot for clicked line
                const matchingSnapshots = snapshots.filter(s => s.line === message.line);
                
                if (matchingSnapshots.length > 0) {
                    // Find the first snapshot for this line
                    const firstSnapshot = matchingSnapshots[0];
                    const snapshotIndex = snapshots.findIndex(s => s.snapshot_id === firstSnapshot.snapshot_id);
                    
                    if (snapshotIndex !== -1) {
                        debugLog('Found matching snapshot at index:', snapshotIndex);
                        updateCurrentStepAndUI(snapshotIndex);
                    }
                } else {
                    debugLog('No matching snapshot found for line:', message.line);
                }
                break;
        }
    });

    // Update the current frame display
    function updateCurrentFrame() {
        if (!snapshots || snapshots.length === 0) {return;}
        
        const snapshot = snapshots[currentStep];
        const frame = document.getElementById('currentFrame');
        if (!frame) {return;}
        
        // Update frame content
        frame.innerHTML = `
            <div class="frame-header">
                <span class="frame-line">Line ${snapshot.line}</span>
                <span class="frame-time">${new Date(snapshot.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="frame-locals">
                ${Object.entries(snapshot.locals).map(([name, value]) => `
                    <div class="local-variable">
                        <span class="var-name">${name}:</span>
                        <span class="var-value">${value.value}</span>
                    </div>
                `).join('')}
            </div>
        `;
        
        // Update step counter
        if (currentStepDisplay) {
            currentStepDisplay.textContent = currentStep + 1;
        }
        
        // Update button states
        if (prevButton) {prevButton.disabled = currentStep === 0;}
        if (nextButton) {nextButton.disabled = currentStep === snapshots.length - 1;}
        
        // Update local timeline for the current line
        updateLocalTimeline();
    }

    // Update local timeline based on current line
    function updateLocalTimeline() {
        if (!snapshots || snapshots.length === 0 || currentStep >= snapshots.length) {return;}
        
        const currentSnapshot = snapshots[currentStep];
        if (!currentSnapshot) {return;}
        
        // Get all snapshots for the current line
        localSnapshots = snapshots.filter(s => s.line === currentSnapshot.line);
        
        // Find current snapshot position in local timeline
        localStep = localSnapshots.findIndex(s => s.snapshot_id === currentSnapshot.snapshot_id);
        
        if (localTimelineSlider && localCurrentStepDisplay && localTotalStepsDisplay) {
            // Update slider max value
            localTimelineSlider.max = localSnapshots.length - 1;
            localTimelineSlider.value = localStep;
            
            // Update labels
            localCurrentStepDisplay.textContent = localStep + 1;
            localTotalStepsDisplay.textContent = localSnapshots.length;
            
            // Update button states
            if (localPrevButton) {
                localPrevButton.disabled = localStep <= 0;
            }
            if (localNextButton) {
                localNextButton.disabled = localStep >= localSnapshots.length - 1;
            }
        }
        
        // Update the variables change table
        updateVariablesChangeTable();
    }
    
    // Create a table showing how variables change across snapshots for the current line
    function updateVariablesChangeTable() {
        if (!localSnapshots || localSnapshots.length === 0) {return;}
        
        // Find or create the variables change table container
        let tableContainer = document.getElementById('variablesChangeTable');
        if (!tableContainer) {
            // Create the container if it doesn't exist
            const localTimeline = document.querySelector('.local-timeline');
            if (!localTimeline) {return;}
            
            tableContainer = document.createElement('div');
            tableContainer.id = 'variablesChangeTable';
            tableContainer.className = 'variables-change-table';
            tableContainer.innerHTML = '<h4>Variable Changes for Current Line</h4>';
            
            localTimeline.appendChild(tableContainer);
        }
        
        // Collect all variable names across all snapshots for the current line
        const allVarNames = new Set();
        localSnapshots.forEach(snapshot => {
            Object.keys(snapshot.locals).forEach(varName => {
                allVarNames.add(varName);
            });
        });
        
        const varNames = [...allVarNames].sort();
        
        // Create a table to show variable changes
        let tableHTML = `
            <table class="var-changes-table">
                <thead>
                    <tr>
                        <th>Snapshot</th>
                        ${varNames.map(name => `<th>${name}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>`;
        
        // Track the last seen value for each variable
        const lastValues = {};
        
        // Generate row for each snapshot
        localSnapshots.forEach((snapshot, index) => {
            tableHTML += `
                <tr class="${index === localStep ? 'current-snapshot' : ''}">
                    <td>${index + 1}</td>`;
            
            // For each variable, show value if it's new or changed, otherwise show '-'
            varNames.forEach(varName => {
                const varData = snapshot.locals[varName];
                if (!varData) {
                    // Variable not present in this snapshot
                    tableHTML += '<td>-</td>';
                } else {
                    const currentValue = varData.value;
                    
                    if (lastValues[varName] === undefined || lastValues[varName] !== currentValue) {
                        // New or changed value
                        tableHTML += `<td>${currentValue}</td>`;
                        lastValues[varName] = currentValue;
                    } else {
                        // Unchanged value
                        tableHTML += '<td>-</td>';
                    }
                }
            });
            
            tableHTML += '</tr>';
        });
        
        tableHTML += '</tbody></table>';
        
        // Update the table
        tableContainer.innerHTML = '<h4>Variable Changes for Current Line</h4>' + tableHTML;
    }
})(); 