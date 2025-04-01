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
    });
})(); 