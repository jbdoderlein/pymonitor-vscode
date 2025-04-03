(function() {
    const vscode = acquireVsCodeApi();

    // Get DOM elements
    const backButton = document.querySelector('.back-button');
    const timelineSlider = document.getElementById('timelineSlider');
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');
    const currentStepDisplay = document.getElementById('currentStep');
    const currentFrame = document.getElementById('currentFrame');
    
    // Local timeline elements
    const localTimelineSlider = document.getElementById('localTimelineSlider');
    const localPrevButton = document.getElementById('localPrevButton');
    const localNextButton = document.getElementById('localNextButton');
    const localCurrentStepDisplay = document.getElementById('localCurrentStep');
    const localTotalStepsDisplay = document.getElementById('localTotalSteps');
    
    // Store snapshots data and current steps
    let snapshots = [];
    let currentStep = 0;      // Current position in the global timeline
    let localSnapshots = [];  // Snapshots for the current line
    let localStep = 0;        // Current position in the local timeline
    
    // Helper to log debug messages
    function debugLog(...args) {
        // Uncomment this line for debugging
        console.log(...args);
    }
    
    // Handle back button click
    if (backButton) {
        backButton.addEventListener('click', () => {
            vscode.postMessage({
                command: 'backToFunctions'
            });
        });
    }
    
    // Handle global timeline slider change
    if (timelineSlider) {
        timelineSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            if (value !== currentStep) {
                updateCurrentStepAndUI(value);
            }
        });
    }
    
    // Handle global previous button click
    if (prevButton) {
        prevButton.addEventListener('click', () => {
            if (currentStep > 0) {
                // Simply move to the previous step chronologically
                updateCurrentStepAndUI(currentStep - 1);
            }
        });
    }
    
    // Handle global next button click
    if (nextButton) {
        nextButton.addEventListener('click', () => {
            if (currentStep < snapshots.length - 1) {
                // Simply move to the next step chronologically
                debugLog('Before next button click:', currentStep);
                updateCurrentStepAndUI(currentStep + 1);
                debugLog('After next button click:', currentStep);
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
                const globalIndex = snapshots.findIndex(s => s.id === snapshot.id);
                
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
                const globalIndex = snapshots.findIndex(s => s.id === snapshot.id);
                
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
                const globalIndex = snapshots.findIndex(s => s.id === snapshot.id);
                
                if (globalIndex !== -1 && globalIndex !== currentStep) {
                    updateCurrentStepAndUI(globalIndex);
                }
            }
        });
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

            case 'updateStep':
                debugLog('Updating step:', message.step);
                updateCurrentStepAndUI(message.step);
                break;

            case 'editorLineClick':
                debugLog('Editor line clicked:', message.line);
                
                // Find chronologically first snapshot for clicked line
                const matchingSnapshots = snapshots.filter(s => s.line === message.line);
                
                if (matchingSnapshots.length > 0) {
                    // Find the first snapshot for this line
                    const firstSnapshot = matchingSnapshots[0];
                    const snapshotIndex = snapshots.findIndex(s => s.id === firstSnapshot.id);
                    
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
        localStep = localSnapshots.findIndex(s => s.id === currentSnapshot.id);
        
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
    }
})(); 