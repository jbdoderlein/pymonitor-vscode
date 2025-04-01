(function() {
    const vscode = acquireVsCodeApi();
    
    // Get DOM elements
    const backButton = document.querySelector('.back-button');
    const timelineSlider = document.getElementById('timelineSlider');
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');
    const currentStepDisplay = document.getElementById('currentStep');
    const currentFrame = document.getElementById('currentFrame');
    
    // Store snapshots data and current step
    let snapshots = [];
    let currentStep = 0;
    
    // Handle back button click
    if (backButton) {
        backButton.addEventListener('click', () => {
            vscode.postMessage({
                command: 'backToFunctions'
            });
        });
    }
    
    // Handle timeline slider change
    if (timelineSlider) {
        timelineSlider.addEventListener('input', (event) => {
            const value = parseInt(event.target.value);
            if (value !== currentStep) {
                currentStep = value;
                updateCurrentStep(value);
                
                vscode.postMessage({
                    command: 'sliderChange',
                    value: value
                });
            }
        });
    }
    
    // Handle previous button click
    if (prevButton) {
        prevButton.addEventListener('click', () => {
            if (currentStep > 0) {
                const newValue = currentStep - 1;
                currentStep = newValue;
                timelineSlider.value = newValue;
                updateCurrentStep(newValue);
                
                vscode.postMessage({
                    command: 'prevStep'
                });
            }
        });
    }
    
    // Handle next button click
    if (nextButton) {
        nextButton.addEventListener('click', () => {
            const maxValue = parseInt(timelineSlider.max);
            if (currentStep < maxValue) {
                const newValue = currentStep + 1;
                currentStep = newValue;
                timelineSlider.value = newValue;
                updateCurrentStep(newValue);
                
                vscode.postMessage({
                    command: 'nextStep'
                });
            }
        });
    }
    
    // Update the current step display and frame content
    function updateCurrentStep(value) {
        if (currentStepDisplay) {
            currentStepDisplay.textContent = value + 1;
        }
        
        if (currentFrame && snapshots[value]) {
            const snapshot = snapshots[value];
            
            // Update frame header
            const frameHeader = currentFrame.querySelector('.frame-header');
            if (frameHeader) {
                frameHeader.innerHTML = `
                    <span class="frame-line">Line ${snapshot.line}</span>
                    <span class="frame-time">${new Date(snapshot.timestamp).toLocaleTimeString()}</span>
                `;
            }
            
            // Update frame locals
            const frameLocals = currentFrame.querySelector('.frame-locals');
            if (frameLocals) {
                frameLocals.innerHTML = Object.entries(snapshot.locals)
                    .map(([name, value]) => `
                        <div class="local-variable">
                            <span class="var-name">${name}:</span>
                            <span class="var-value">${value.value}</span>
                        </div>
                    `).join('');
            }
            
            // Send line number to extension for highlighting
            vscode.postMessage({
                command: 'updateLine',
                line: snapshot.line
            });
        }
    }
    
    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        
        if (message.command === 'updateStep') {
            if (message.step !== currentStep) {
                currentStep = message.step;
                timelineSlider.value = currentStep;
                updateCurrentStep(currentStep);
            }
        } else if (message.command === 'setSnapshots') {
            snapshots = message.snapshots;
            currentStep = 0;
            updateCurrentStep(0);
        }
    });
})(); 