(function() {
    // Get VS Code API
    const vscode = acquireVsCodeApi();
    
    // Initialize the script when the document is loaded
    document.addEventListener('DOMContentLoaded', initialize);
    
    // Also initialize when receiving a 'dataReloaded' message
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'dataReloaded') {
            console.log('Data reloaded, reinitializing event listeners');
            resetReloadButton();
            setTimeout(initializeEventListeners, 100); // Small delay to ensure DOM is updated
        }
    });

    function initialize() {
        console.log('Initializing function details view');
        initializeEventListeners();
        
        // Set up the reload button
        setupReloadButton();
        
        // Add spinner animation style
        addSpinnerStyle();
    }
    
    function addSpinnerStyle() {
        // Add CSS for spinner animation
        const style = document.createElement('style');
        style.textContent = `
            .spin {
                animation: spin 1.5s linear infinite;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }
    
    function initializeEventListeners() {
        // Add event listeners for stack trace exploration
        document.querySelectorAll('.explore-stack-trace').forEach(button => {
            button.addEventListener('click', event => {
                const functionId = button.getAttribute('data-function-id');
                console.log('Explore stack trace clicked for function:', functionId);
                vscode.postMessage({
                    command: 'exploreStackTrace',
                    functionId: functionId
                });
            });
        });
    }
    
    function setupReloadButton() {
        const reloadButton = document.getElementById('reload-button');
        if (reloadButton) {
            reloadButton.addEventListener('click', () => {
                console.log('Reload button clicked');
                
                // Show loading indicator on the button
                reloadButton.classList.add('loading');
                const icon = reloadButton.querySelector('.codicon');
                if (icon) {
                    icon.classList.remove('codicon-refresh');
                    icon.classList.add('codicon-loading', 'spin');
                }
                
                // Send message to extension to reload data
                vscode.postMessage({
                    command: 'reloadFunctionData'
                });
                
                // If no response after 2 seconds, reset the button
                setTimeout(() => {
                    if (reloadButton.classList.contains('loading')) {
                        resetReloadButton();
                    }
                }, 2000);
            });
        }
    }
    
    function resetReloadButton() {
        const reloadButton = document.getElementById('reload-button');
        if (reloadButton) {
            reloadButton.classList.remove('loading');
            const icon = reloadButton.querySelector('.codicon');
            if (icon) {
                icon.classList.remove('codicon-loading', 'spin');
                icon.classList.add('codicon-refresh');
            }
        }
    }
})(); 