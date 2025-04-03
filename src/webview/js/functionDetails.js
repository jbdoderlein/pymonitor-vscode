(function() {
    const vscode = acquireVsCodeApi();
    
    // Add click handlers for stack trace buttons
    document.addEventListener('click', event => {
        const button = event.target.closest('.explore-stack-trace');
        if (button) {
            const functionId = button.dataset.functionId;
            console.log('Stack trace button clicked for function:', functionId);
            vscode.postMessage({
                command: 'exploreStackTrace',
                functionId: functionId
            });
        }

        // Handle reload button click
        if (event.target.closest('#reload-button')) {
            console.log('Reload button clicked');
            vscode.postMessage({
                command: 'reloadFunctionData'
            });
            
            // Show loading feedback on the button
            const reloadButton = document.getElementById('reload-button');
            if (reloadButton) {
                const icon = reloadButton.querySelector('.codicon');
                if (icon) {
                    icon.classList.remove('codicon-refresh');
                    icon.classList.add('codicon-loading');
                    icon.classList.add('spin');
                    
                    // Reset the icon after 2 seconds if no response
                    setTimeout(() => {
                        icon.classList.remove('codicon-loading');
                        icon.classList.remove('spin');
                        icon.classList.add('codicon-refresh');
                    }, 2000);
                }
            }
        }
    });

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'updateStep':
                updateStep(message.step);
                break;
            case 'dataReloaded':
                // Reset reload button state
                const reloadButton = document.getElementById('reload-button');
                if (reloadButton) {
                    const icon = reloadButton.querySelector('.codicon');
                    if (icon) {
                        icon.classList.remove('codicon-loading');
                        icon.classList.remove('spin');
                        icon.classList.add('codicon-refresh');
                    }
                }
                break;
        }
    });

    function updateStep(step) {
        const currentStepElement = document.getElementById('currentStep');
        if (currentStepElement) {
            currentStepElement.textContent = step + 1;
        }
    }

    // Add CSS for spinner animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .spin {
            animation: spin 1s linear infinite;
        }
    `;
    document.head.appendChild(style);
})(); 