(function() {
    const vscode = acquireVsCodeApi();
    
    // Debug logging function
    function debugLog(message, ...args) {
        console.log(`[Webview Debug] ${message}`, ...args);
    }
    
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
    
    // Store snapshots data and current step
    let snapshots = [];
    let currentStep = 0;  // Current position in the global timeline
    let localStep = 0;   // Current position in the local timeline
    let localSnapshots = [];
    let localCurrentStep = 0;
    
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
            currentStep = value;
            updateCurrentFrame();
            // Request highlight update from extension
            vscode.postMessage({
                command: 'highlightLine',
                line: snapshots[currentStep].line
            });
        });
    }
    
    // Handle global previous button click
    if (prevButton) {
        prevButton.addEventListener('click', () => {
            if (currentStep > 0) {
                currentStep--;
                timelineSlider.value = currentStep;
                updateCurrentFrame();
                // Request highlight update from extension
                vscode.postMessage({
                    command: 'highlightLine',
                    line: snapshots[currentStep].line
                });
            }
        });
    }
    
    // Handle global next button click
    if (nextButton) {
        nextButton.addEventListener('click', () => {
            if (currentStep < snapshots.length - 1) {
                currentStep++;
                timelineSlider.value = currentStep;
                updateCurrentFrame();
                // Request highlight update from extension
                vscode.postMessage({
                    command: 'highlightLine',
                    line: snapshots[currentStep].line
                });
            }
        });
    }

    // Handle local timeline slider change
    if (localTimelineSlider) {
        localTimelineSlider.addEventListener('input', (event) => {
            const value = parseInt(event.target.value);
            if (value !== localStep) {
                debugLog('Local slider changed:', value, 'localStep:', localStep);
                localStep = value;
                // Find the corresponding global snapshot
                const globalIndex = snapshots.findIndex(s => s === localSnapshots[value]);
                debugLog('Found global index:', globalIndex);
                if (globalIndex !== -1 && globalIndex !== currentStep) {
                    currentStep = globalIndex;
                    timelineSlider.value = currentStep;
                    updateCurrentFrame();
                    
                    vscode.postMessage({
                        command: 'sliderChange',
                        value: currentStep
                    });
                }
            }
        });
    }
    
    // Handle local previous button click
    if (localPrevButton) {
        localPrevButton.addEventListener('click', () => {
            if (localStep > 0) {
                debugLog('Local previous clicked, localStep:', localStep);
                localStep--;
                localTimelineSlider.value = localStep;
                
                // Find the corresponding global snapshot
                const globalIndex = snapshots.findIndex(s => s === localSnapshots[localStep]);
                debugLog('Found global index:', globalIndex);
                if (globalIndex !== -1 && globalIndex !== currentStep) {
                    currentStep = globalIndex;
                    timelineSlider.value = currentStep;
                    updateCurrentFrame();
                    
                    vscode.postMessage({
                        command: 'sliderChange',
                        value: currentStep
                    });
                }
            }
        });
    }
    
    // Handle local next button click
    if (localNextButton) {
        localNextButton.addEventListener('click', () => {
            const maxValue = parseInt(localTimelineSlider.max);
            if (localStep < maxValue) {
                debugLog('Local next clicked, localStep:', localStep);
                localStep++;
                localTimelineSlider.value = localStep;
                
                // Find the corresponding global snapshot
                const globalIndex = snapshots.findIndex(s => s === localSnapshots[localStep]);
                debugLog('Found global index:', globalIndex);
                if (globalIndex !== -1 && globalIndex !== currentStep) {
                    currentStep = globalIndex;
                    timelineSlider.value = currentStep;
                    updateCurrentFrame();
                    
                    vscode.postMessage({
                        command: 'sliderChange',
                        value: currentStep
                    });
                }
            }
        });
    }
    
    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        debugLog('Received message from extension:', message);

        switch (message.command) {
            case 'setSnapshots':
                debugLog('Setting snapshots:', message.snapshots.length);
                snapshots = message.snapshots;
                currentStep = 0;
                timelineSlider.value = currentStep;
                updateCurrentFrame();
                updateLocalTimeline(0);
                // Request initial highlight
                vscode.postMessage({
                    command: 'highlightLine',
                    line: snapshots[0].line
                });
                break;

            case 'updateStep':
                debugLog('Updating step:', message.step);
                currentStep = message.step;
                timelineSlider.value = currentStep;
                updateCurrentFrame();
                // Request highlight update
                vscode.postMessage({
                    command: 'highlightLine',
                    line: snapshots[currentStep].line
                });
                break;

            case 'editorLineClick':
                debugLog('Editor line clicked:', message.line);
                // Find matching snapshot for clicked line
                const snapshotIndex = snapshots.findIndex(s => s.line === message.line);
                if (snapshotIndex !== -1) {
                    debugLog('Found matching snapshot at index:', snapshotIndex);
                    currentStep = snapshotIndex;
                    timelineSlider.value = currentStep;
                    updateCurrentFrame();
                    // Request highlight update
                    vscode.postMessage({
                        command: 'highlightLine',
                        line: snapshots[currentStep].line
                    });
                } else {
                    debugLog('No matching snapshot found for line:', message.line);
                }
                break;
        }
    });

    // Update the current frame display
    function updateCurrentFrame() {
        if (!snapshots || snapshots.length === 0) return;
        
        const snapshot = snapshots[currentStep];
        const frame = document.getElementById('currentFrame');
        if (!frame) return;
        
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
        const currentStepElement = document.getElementById('currentStep');
        if (currentStepElement) {
            currentStepElement.textContent = currentStep + 1;
        }
        
        // Update button states
        const prevButton = document.getElementById('prevButton');
        const nextButton = document.getElementById('nextButton');
        if (prevButton) prevButton.disabled = currentStep === 0;
        if (nextButton) nextButton.disabled = currentStep === snapshots.length - 1;
        
        // Update local timeline for the current line
        debugLog('before updateLocalTimeline', currentStep, localStep);
        updateLocalTimeline(currentStep);
        debugLog('after updateLocalTimeline', currentStep, localStep);
        
        // Notify extension about line update
        debugLog('Sending line update to extension:', snapshot.line);
        vscode.postMessage({
            command: 'updateLine',
            line: snapshot.line
        });
    }

    function updateStep(step) {
        const currentStepElement = document.getElementById('currentStep');
        if (currentStepElement) {
            currentStepElement.textContent = step + 1;
        }

        // Update the current frame with snapshot data
        const currentFrame = document.getElementById('currentFrame');
        if (currentFrame && snapshots[step]) {
            const snapshot = snapshots[step];
            currentFrame.innerHTML = `
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

            // Update local timeline for the current line
            updateLocalTimeline(step);
        }
    }

    function updateLocalTimeline(step) {
        const currentSnapshot = snapshots[step];
        if (!currentSnapshot) return;

        const localTimelineSlider = document.getElementById('localTimelineSlider');
        const localCurrentStep = document.getElementById('localCurrentStep');
        const localTotalSteps = document.getElementById('localTotalSteps');
        const localPrevButton = document.getElementById('localPrevButton');
        const localNextButton = document.getElementById('localNextButton');

        if (localTimelineSlider && localCurrentStep && localTotalSteps) {
            const lineSnapshots = snapshots.filter(s => s.line === currentSnapshot.line);
            const currentIndex = lineSnapshots.findIndex(s => s.id === currentSnapshot.id);

            localTimelineSlider.max = lineSnapshots.length - 1;
            localTimelineSlider.value = currentIndex;
            localCurrentStep.textContent = currentIndex + 1;
            localTotalSteps.textContent = lineSnapshots.length;

            if (localPrevButton) {
                localPrevButton.disabled = currentIndex <= 0;
            }
            if (localNextButton) {
                localNextButton.disabled = currentIndex >= lineSnapshots.length - 1;
            }
        }
    }
})(); 