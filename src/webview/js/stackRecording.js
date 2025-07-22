(function() {
    const vscode = acquireVsCodeApi();

    // Get DOM elements (will be set after content loads)
    let backButton = null;
    let reloadButton = null;
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
    
    // Comparison elements
    let compareTraceSelect = null;
    let compareButton = null;
    let closeComparisonButton = null;
    let comparisonView = null;
    let currentTraceInfo = null;
    let compareTraceInfo = null;
    
    // Store snapshots data and current steps
    let snapshots = [];
    let currentStep = 0;      // Current position in the global timeline
    let localSnapshots = [];  // Snapshots for the current line
    let localStep = 0;        // Current position in the local timeline
    let dbPath = '';          // Path to the database - will be set when data is loaded
    let isDebugging = false;  // Flag to track if there's an active debug session
    
    // Comparison data
    let availableTraces = [];
    let currentFunctionId = null;
    let selectedCompareTrace = null;
    let comparisonData = null;
    let graphSvg = null;
    let simulation = null;
    let currentTransform = d3.zoomIdentity;
    
    // Color scheme for different node/edge states in graph
    const stateColors = {
        'common': '#6c757d',      // Gray for common nodes/edges
        'modified': '#fd7e14',    // Orange for modified nodes
        'only1': '#dc3545',       // Red for only in trace 1  
        'only2': '#28a745'        // Green for only in trace 2
    };
    
    // Helper to log debug messages
    function debugLog(...args) {
        // Uncomment this line for debugging
        console.log(...args);
    }
    
    // Initialize comparison elements when DOM loads (separate from snapshot initialization)
    function initializeComparisonElements() {
        debugLog('Initializing comparison elements...');
        
        // Get comparison elements
        compareTraceSelect = document.getElementById('compare-trace-select');
        compareButton = document.getElementById('compare-button');
        closeComparisonButton = document.getElementById('close-comparison-button');
        comparisonView = document.getElementById('comparison-view');
        currentTraceInfo = document.getElementById('current-trace-info');
        compareTraceInfo = document.getElementById('compare-trace-info');
        
        // Debug: Log which elements were found
        debugLog('Compare elements found:');
        debugLog('- compareTraceSelect:', !!compareTraceSelect);
        debugLog('- compareButton:', !!compareButton);
        debugLog('- closeComparisonButton:', !!closeComparisonButton);
        debugLog('- comparisonView:', !!comparisonView);
        debugLog('- currentTraceInfo:', !!currentTraceInfo);
        debugLog('- compareTraceInfo:', !!compareTraceInfo);
        
        // Set up comparison event listeners
        setupComparisonEventListeners();
        
        // Load available traces
        loadAvailableTraces();
    }
    
    // Set up comparison-specific event listeners
    function setupComparisonEventListeners() {
        debugLog('Setting up comparison event listeners...');
        
        // Handle trace selection change
        if (compareTraceSelect) {
            debugLog('Setting up trace selection change listener');
            compareTraceSelect.addEventListener('change', () => {
                const selectedTraceId = compareTraceSelect.value;
                debugLog('Trace selection changed to:', selectedTraceId);
                const isValidSelection = selectedTraceId && selectedTraceId !== currentFunctionId;
                debugLog('Is valid selection:', isValidSelection, 'currentFunctionId:', currentFunctionId);
                
                if (compareButton) {
                    compareButton.disabled = !isValidSelection;
                    debugLog('Compare button disabled state:', compareButton.disabled);
                }
                
                selectedCompareTrace = isValidSelection ? 
                    availableTraces.find(t => t.id.toString() === selectedTraceId) : null;
                debugLog('Selected compare trace:', selectedCompareTrace);
            });
        } else {
            debugLog('compareTraceSelect not found - cannot set up trace selection listener');
        }
        
        // Handle compare button click
        if (compareButton) {
            debugLog('Setting up compare button click listener');
            compareButton.addEventListener('click', () => {
                debugLog('Compare button clicked!');
                debugLog('selectedCompareTrace:', selectedCompareTrace);
                debugLog('currentFunctionId:', currentFunctionId);
                if (selectedCompareTrace && currentFunctionId) {
                    debugLog('Starting trace comparison...');
                    startTraceComparison();
                } else {
                    debugLog('Cannot start comparison - missing data');
                }
            });
        } else {
            debugLog('compareButton not found - cannot set up click listener');
        }
        
        // Handle close comparison button click
        if (closeComparisonButton) {
            closeComparisonButton.addEventListener('click', () => {
                closeTraceComparison();
            });
        }
        
        // Handle graph reset button
        const resetGraphBtn = document.getElementById('reset-graph-btn');
        if (resetGraphBtn) {
            resetGraphBtn.addEventListener('click', () => {
                resetGraphView();
            });
        }
    }
    
    // Initialize when DOM is loaded
    document.addEventListener('DOMContentLoaded', () => {
        debugLog('DOM Content Loaded - initializing comparison elements');
        initializeComparisonElements();
    });
    
    // Also initialize immediately in case DOMContentLoaded already fired
    if (document.readyState === 'loading') {
        debugLog('Document still loading, waiting for DOMContentLoaded');
    } else {
        debugLog('Document already loaded, initializing comparison elements immediately');
        initializeComparisonElements();
    }
    
    // Initialize DOM elements and event listeners after content is loaded
    function initializeEventListeners() {
        debugLog('Initializing event listeners');
        
        // Get DOM elements
        backButton = document.getElementById('backButton');
        reloadButton = document.getElementById('reload-button');
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
        
        // Debug: Log which basic elements were found
        debugLog('Basic elements found:');
        debugLog('- backButton:', !!backButton);
        debugLog('- reloadButton:', !!reloadButton);
        debugLog('- timelineSlider:', !!timelineSlider);
        debugLog('- goToStateButton:', !!goToStateButton);
        
        setupEventListeners();
        
        // Note: Comparison elements are initialized separately in initializeComparisonElements()
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

        // Handle reload button click
        if (reloadButton) {
            debugLog('Setting up reload button event listener');
            reloadButton.addEventListener('click', () => {
                debugLog('Reload button clicked, sending reloadStackRecording message');
                // Disable button temporarily to prevent spam
                reloadButton.disabled = true;
                
                vscode.postMessage({
                    command: 'reloadStackRecording'
                });
                
                // Re-enable after a short delay
                setTimeout(() => {
                    if (reloadButton) {
                        reloadButton.disabled = false;
                    }
                }, 1000);
            });
        } else {
            debugLog('Reload button not found');
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
                if (snapshots.length > 0 && currentStep < snapshots.length && dbPath && isDebugging) {
                    const snapshot = snapshots[currentStep];
                    debugLog(`Loading snapshot state for snapshot ID: ${snapshot.snapshot_id}`);
                    
                    // Send message to extension to load the snapshot state
                    vscode.postMessage({
                        command: 'goToSnapshotState',
                        snapshotId: snapshot.snapshot_id,
                        dbPath: dbPath,
                        line: snapshot.line // Also send the line number for potential navigation
                    });
                } else {
                    if (!dbPath) {
                        debugLog('Database path not available');
                    }
                    if (!isDebugging) {
                        debugLog('No active debug session');
                    }
                    if (snapshots.length === 0) {
                        debugLog('No snapshots available');
                    }
                }
            });
        }
    }
    
    // Load available traces for comparison
    function loadAvailableTraces() {
        debugLog('Loading available traces for comparison');
        debugLog('Sending getTracesList message to extension');
        vscode.postMessage({
            command: 'getTracesList'
        });
        debugLog('getTracesList message sent');
    }
    
    // Populate the trace selection dropdown
    function populateTraceDropdown(traces) {
        debugLog('populateTraceDropdown called with traces:', traces);
        if (!compareTraceSelect || !traces) {
            debugLog('Cannot populate dropdown - compareTraceSelect:', !!compareTraceSelect, 'traces:', !!traces);
            return;
        }
        
        // Clear existing options except the first one
        compareTraceSelect.innerHTML = '<option value="">Select trace to compare...</option>';
        
        traces.forEach(trace => {
            // Skip the current trace
            if (trace.id.toString() === currentFunctionId?.toString()) {
                debugLog('Skipping current trace:', trace.id);
                return;
            }
            
            const option = document.createElement('option');
            option.value = trace.id.toString();
            
            const timestamp = trace.start_time ? new Date(trace.start_time).toLocaleString() : 'N/A';
            const fileName = trace.file.split('/').pop();
            
            option.textContent = `${trace.function} (${fileName}:${trace.line}) - ${timestamp}`;
            option.title = `File: ${trace.file}, Duration: ${trace.duration?.toFixed(2) || 'N/A'}s`;
            
            compareTraceSelect.appendChild(option);
        });
        
        debugLog(`Populated dropdown with ${traces.length} traces (excluding current)`);
    }
    
    // Start trace comparison
    async function startTraceComparison() {
        debugLog('startTraceComparison called');
        if (!selectedCompareTrace || !currentFunctionId) {
            debugLog('Cannot start comparison: missing trace data');
            debugLog('- selectedCompareTrace:', selectedCompareTrace);
            debugLog('- currentFunctionId:', currentFunctionId);
            return;
        }
        
        debugLog('Starting trace comparison', currentFunctionId, 'vs', selectedCompareTrace.id);
        
        // Show loading state
        showComparisonLoading(true);
        
        // Show comparison view
        if (comparisonView) {
            comparisonView.style.display = 'block';
            debugLog('Comparison view shown');
        }
        if (compareButton) {
            compareButton.style.display = 'none';
            debugLog('Compare button hidden');
        }
        if (closeComparisonButton) {
            closeComparisonButton.style.display = 'inline-flex';
            debugLog('Close comparison button shown');
        }
        
        // Update trace info display
        updateTraceInfoDisplay();
        
        try {
            debugLog('Sending compareTraces message to extension');
            // Request comparison from extension
            vscode.postMessage({
                command: 'compareTraces',
                trace1Id: currentFunctionId,
                trace2Id: selectedCompareTrace.id
            });
            debugLog('compareTraces message sent with trace1Id:', currentFunctionId, 'trace2Id:', selectedCompareTrace.id);
        } catch (error) {
            debugLog('Error starting trace comparison:', error);
            showComparisonError('Failed to start trace comparison');
        }
    }
    
    // Close trace comparison
    function closeTraceComparison() {
        debugLog('Closing trace comparison');
        
        // Hide comparison view
        if (comparisonView) {
            comparisonView.style.display = 'none';
        }
        if (compareButton) {
            compareButton.style.display = 'inline-flex';
        }
        if (closeComparisonButton) {
            closeComparisonButton.style.display = 'none';
        }
        
        // Reset comparison data
        comparisonData = null;
        selectedCompareTrace = null;
        
        // Reset dropdown selection
        if (compareTraceSelect) {
            compareTraceSelect.value = '';
        }
        if (compareButton) {
            compareButton.disabled = true;
        }
        
        // Clear graph
        if (graphSvg) {
            graphSvg.selectAll('*').remove();
        }
    }
    
    // Update trace info display in comparison header
    function updateTraceInfoDisplay() {
        if (currentTraceInfo && snapshots.length > 0) {
            const currentTrace = snapshots[0]; // Get info from first snapshot
            const fileName = currentTrace.function?.file?.split('/').pop() || 'unknown';
            currentTraceInfo.textContent = `${currentTrace.function?.name || 'Unknown'} (${fileName})`;
        }
        
        if (compareTraceInfo && selectedCompareTrace) {
            const fileName = selectedCompareTrace.file.split('/').pop();
            compareTraceInfo.textContent = `${selectedCompareTrace.function} (${fileName})`;
        }
    }
    
    // Show/hide loading state for comparison
    function showComparisonLoading(show) {
        const loadingMessage = document.getElementById('loading-graph-message');
        const graphSvgElement = document.getElementById('graph-svg');
        
        if (loadingMessage && graphSvgElement) {
            if (show) {
                loadingMessage.style.display = 'block';
                graphSvgElement.style.display = 'none';
            } else {
                loadingMessage.style.display = 'none';
                graphSvgElement.style.display = 'block';
            }
        }
    }
    
    // Show comparison error
    function showComparisonError(message) {
        const loadingMessage = document.getElementById('loading-graph-message');
        if (loadingMessage) {
            loadingMessage.innerHTML = `
                <div class="loading-spinner" style="color: var(--vscode-errorForeground);">
                    <span class="codicon codicon-error"></span>
                </div>
                <p style="color: var(--vscode-errorForeground);">${message}</p>
            `;
        }
    }
    
    // Render the comparison graph using D3.js
    function renderComparisonGraph(graphData) {
        debugLog('Rendering comparison graph', graphData);
        
        const container = document.getElementById('graph-container');
        const svg = d3.select('#graph-svg');
        
        // Show SVG and hide loading
        showComparisonLoading(false);
        
        // Clear previous content
        svg.selectAll('*').remove();
        
        // Set up SVG dimensions
        const containerRect = container.getBoundingClientRect();
        const width = containerRect.width;
        const height = containerRect.height;
        
        svg.attr('width', width).attr('height', height);
        
        // Add arrow marker definitions for different states
        const defs = svg.append('defs');
        Object.entries(stateColors).forEach(([state, color]) => {
            defs.append('marker')
                .attr('id', `arrow-${state}`)
                .attr('viewBox', '0 -5 10 10')
                .attr('refX', 25)
                .attr('refY', 0)
                .attr('markerWidth', 6)
                .attr('markerHeight', 6)
                .attr('orient', 'auto')
                .append('path')
                .attr('d', 'M0,-5L10,0L0,5')
                .attr('fill', color);
        });
        
        // Create zoom behavior
        const zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', function(event) {
                currentTransform = event.transform;
                graphGroup.attr('transform', currentTransform);
            });
        
        svg.call(zoom);
        
        // Create main group for graph content
        const graphGroup = svg.append('g').attr('class', 'graph-content');
        
        // Prepare node and link data from the graph data
        const nodes = Object.entries(graphData.nodes).map(([id, node]) => ({
            id: id.toString(),
            ...node,
            x: Math.random() * width,
            y: Math.random() * height
        }));
        
        const links = graphData.edges.map(([from, to, edgeData]) => ({
            source: from.toString(),
            target: to.toString(),
            ...edgeData
        }));
        
        debugLog('Graph nodes:', nodes.length, 'links:', links.length);
        
        // Create force simulation
        simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id(d => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(30));
        
        // Create links
        const link = graphGroup.append('g')
            .selectAll('path')
            .data(links)
            .enter().append('path')
            .attr('fill', 'none')
            .attr('stroke', d => stateColors[d.state] || '#666')
            .attr('stroke-width', 2)
            .attr('stroke-opacity', 0.8)
            .attr('marker-end', d => `url(#arrow-${d.state})`);
        
        // Create nodes
        const node = graphGroup.append('g')
            .selectAll('circle')
            .data(nodes)
            .enter().append('circle')
            .attr('r', 20)
            .attr('fill', d => stateColors[d.state] || '#999')
            .attr('stroke', '#fff')
            .attr('stroke-width', 2)
            .style('cursor', 'pointer')
            .on('mouseover', (event, d) => showNodeTooltip(event, d))
            .on('mouseout', hideTooltip)
            .on('click', (event, d) => highlightNodeInCode(event, d))
            .call(d3.drag()
                .on('start', dragStarted)
                .on('drag', dragged)
                .on('end', dragEnded));
        
        // Add node labels
        const nodeLabels = graphGroup.append('g')
            .selectAll('text')
            .data(nodes)
            .enter().append('text')
            .text(d => getNodeLabel(d))
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('fill', '#fff')
            .attr('font-size', '12px')
            .attr('font-weight', 'bold')
            .attr('pointer-events', 'none');
        
        // Update positions on simulation tick
        simulation.on('tick', function() {
            link.attr('d', d => {
                return `M${d.source.x},${d.source.y}L${d.target.x},${d.target.y}`;
            });
            
            node
                .attr('cx', d => d.x)
                .attr('cy', d => d.y);
            
            nodeLabels
                .attr('x', d => d.x)
                .attr('y', d => d.y);
        });
        
        // Update graph stats
        updateGraphStats(graphData);
        
        // Store SVG reference
        graphSvg = svg;
    }
    
    // Get node label for display - convert relative line numbers to actual file line numbers
    function getNodeLabel(node) {
        let line1 = node.line1;
        let line2 = node.line2;
        
        // Add offset to get actual file line numbers
        if (comparisonData && comparisonData.traceData) {
            if (line1 && comparisonData.traceData.current) {
                const offset1 = getFirstLineNumber(comparisonData.traceData.current.function?.code);
                line1 = line1 + offset1 - 1;
            }
            if (line2 && comparisonData.traceData.compare) {
                const offset2 = getFirstLineNumber(comparisonData.traceData.compare.function?.code);
                line2 = line2 + offset2 - 1;
            }
        }
        
        return line1 || line2 || node.id;
    }
    
    // Get first line number from code data
    function getFirstLineNumber(codeData) {
        if (typeof codeData === 'object' && codeData.first_line_no) {
            return parseInt(codeData.first_line_no) || 1;
        }
        return 1;
    }
    
    // Show tooltip for graph nodes
    function showNodeTooltip(event, d) {
        const tooltip = document.getElementById('tooltip');
        if (!tooltip) return;
        
        let content = `<strong>Node ${d.id}</strong><br/>`;
        content += `<strong>State:</strong> ${d.state}<br/>`;
        
        // Show both relative and actual line numbers
        if (d.line1) {
            const actualLine1 = d.line1;
            let fileLineV1 = actualLine1;
            if (comparisonData && comparisonData.traceData && comparisonData.traceData.current) {
                const offset1 = getFirstLineNumber(comparisonData.traceData.current.function?.code);
                fileLineV1 = actualLine1 + offset1 - 1;
            }
            content += `<strong>Line V1:</strong> ${fileLineV1} (rel: ${actualLine1})<br/>`;
        }
        if (d.line2) {
            const actualLine2 = d.line2;
            let fileLineV2 = actualLine2;
            if (comparisonData && comparisonData.traceData && comparisonData.traceData.compare) {
                const offset2 = getFirstLineNumber(comparisonData.traceData.compare.function?.code);
                fileLineV2 = actualLine2 + offset2 - 1;
            }
            content += `<strong>Line V2:</strong> ${fileLineV2} (rel: ${actualLine2})<br/>`;
        }
        
        tooltip.innerHTML = content;
        tooltip.style.left = (event.pageX + 10) + 'px';
        tooltip.style.top = (event.pageY + 10) + 'px';
        tooltip.style.opacity = 1;
    }
    
    // Hide tooltip
    function hideTooltip() {
        const tooltip = document.getElementById('tooltip');
        if (tooltip) {
            tooltip.style.opacity = 0;
        }
    }
    
    // Highlight node in code panels - convert relative line numbers to actual file line numbers
    function highlightNodeInCode(event, d) {
        debugLog('Node clicked:', d);
        
        // Clear existing highlights
        document.querySelectorAll('.highlighted-line').forEach(el => {
            el.classList.remove('highlighted-line');
        });
        
        // Highlight in current trace code
        if (d.line1) {
            // d.line1 is relative to the code snippet, convert to actual file line
            let actualFileLine1 = d.line1;
            if (comparisonData && comparisonData.traceData && comparisonData.traceData.current) {
                const offset1 = getFirstLineNumber(comparisonData.traceData.current.function?.code);
                actualFileLine1 = d.line1 + offset1 - 1;
            }
            
            debugLog('Looking for current trace line:', actualFileLine1, '(relative:', d.line1, ')');
            const currentLineElement = document.querySelector(`#code-container-current [data-line="${actualFileLine1}"]`);
            if (currentLineElement) {
                currentLineElement.classList.add('highlighted-line');
                currentLineElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                debugLog('Highlighted current trace line:', actualFileLine1);
            } else {
                debugLog('Current trace line element not found for line:', actualFileLine1);
            }
        }
        
        // Highlight in compare trace code
        if (d.line2) {
            // d.line2 is relative to the code snippet, convert to actual file line
            let actualFileLine2 = d.line2;
            if (comparisonData && comparisonData.traceData && comparisonData.traceData.compare) {
                const offset2 = getFirstLineNumber(comparisonData.traceData.compare.function?.code);
                actualFileLine2 = d.line2 + offset2 - 1;
            }
            
            debugLog('Looking for compare trace line:', actualFileLine2, '(relative:', d.line2, ')');
            const compareLineElement = document.querySelector(`#code-container-compare [data-line="${actualFileLine2}"]`);
            if (compareLineElement) {
                compareLineElement.classList.add('highlighted-line');
                compareLineElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                debugLog('Highlighted compare trace line:', actualFileLine2);
            } else {
                debugLog('Compare trace line element not found for line:', actualFileLine2);
            }
        }
    }
    
    // Update graph statistics display
    function updateGraphStats(graphData) {
        const statsContent = document.getElementById('stats-content');
        if (!statsContent) return;
        
        const nodeCount = Object.keys(graphData.nodes).length;
        const edgeCount = graphData.edges.length;
        
        // Count by state
        const nodeCounts = { common: 0, modified: 0, only1: 0, only2: 0 };
        Object.values(graphData.nodes).forEach(node => {
            if (nodeCounts[node.state] !== undefined) {
                nodeCounts[node.state]++;
            }
        });
        
        statsContent.innerHTML = `
            <div><strong>Nodes:</strong> ${nodeCount}</div>
            <div><strong>Edges:</strong> ${edgeCount}</div>
            <div style="margin-top: 5px;">
                <div style="color: ${stateColors.common};">■ Common: ${nodeCounts.common}</div>
                <div style="color: ${stateColors.modified};">■ Modified: ${nodeCounts.modified}</div>
                <div style="color: ${stateColors.only1};">■ Only V1: ${nodeCounts.only1}</div>
                <div style="color: ${stateColors.only2};">■ Only V2: ${nodeCounts.only2}</div>
            </div>
        `;
    }
    
    // Display code content in comparison panels
    function displayCodeInComparison(currentTraceData, compareTraceData) {
        displayCodeContent(currentTraceData, document.getElementById('code-container-current'), 'current');
        displayCodeContent(compareTraceData, document.getElementById('code-container-compare'), 'compare');
    }
    
    // Display code content in a container
    function displayCodeContent(traceData, container, version) {
        if (!container || !traceData) return;
        
        let codeContent = '';
        let firstLineNo = 1;
        
        // Extract code content from trace data
        if (traceData.function && traceData.function.code) {
            const codeData = traceData.function.code;
            if (typeof codeData === 'object') {
                codeContent = codeData.content || codeData.code_content || '';
                firstLineNo = parseInt(codeData.first_line_no) || 1;
            } else {
                codeContent = codeData;
            }
        }
        
        if (!codeContent) {
            container.textContent = 'No code content available';
            return;
        }
        
        // Split content into lines and add line numbers
        const lines = codeContent.split('\n');
        const codeWithLineNumbers = lines.map((line, index) => {
            const lineNumber = index + firstLineNo;
            return `<div class="code-line" data-line="${lineNumber}" data-version="${version}">
                        <span class="line-number">${lineNumber.toString().padStart(4, ' ')}</span>
                        <span class="line-content">${escapeHtml(line)}</span>
                    </div>`;
        }).join('\n');
        
        container.innerHTML = codeWithLineNumbers;
        
        // Add click event to each line
        container.querySelectorAll('.code-line').forEach(line => {
            line.addEventListener('click', function() {
                const lineNumber = parseInt(this.dataset.line);
                highlightCorrespondingGraphNode(lineNumber);
            });
        });
    }
    
    // Highlight corresponding graph node when code line is clicked
    function highlightCorrespondingGraphNode(lineNumber) {
        if (!graphSvg) return;
        
        const nodes = graphSvg.select('.graph-content').selectAll('circle');
        
        // Reset all nodes
        nodes
            .attr('stroke', '#fff')
            .attr('stroke-width', 2)
            .classed('highlighted', false);
        
        // Highlight nodes that match the line number
        nodes
            .filter(d => d.line1 === lineNumber || d.line2 === lineNumber)
            .attr('stroke', 'var(--vscode-editorCursor-foreground)')
            .attr('stroke-width', 4)
            .classed('highlighted', true);
    }
    
    // Escape HTML characters
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Reset graph view
    function resetGraphView() {
        if (graphSvg && currentTransform) {
            const container = document.getElementById('graph-container');
            const containerRect = container.getBoundingClientRect();
            const centerTransform = d3.zoomIdentity
                .translate(containerRect.width / 2, containerRect.height / 2)
                .scale(1);
            
            graphSvg.transition()
                .duration(500)
                .call(d3.zoom().transform, centerTransform);
        }
    }
    
    // Drag behavior functions for graph nodes
    function dragStarted(event, d) {
        if (!event.active && simulation) {
            simulation.alphaTarget(0.3).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
    }
    
    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }
    
    function dragEnded(event, d) {
        if (!event.active && simulation) {
            simulation.alphaTarget(0);
        }
        d.fx = null;
        d.fy = null;
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
                debugLog('Full snapshots data structure:', message.snapshots);
                if (message.snapshots.length > 0) {
                    debugLog('First snapshot structure:', message.snapshots[0]);
                    debugLog('First snapshot function property:', message.snapshots[0].function);
                    debugLog('First snapshot function_call_id:', message.snapshots[0].function_call_id);
                }
                
                // Use snapshots directly from API without reordering
                snapshots = message.snapshots;
                currentStep = 0;
                
                // Store current function ID for comparison
                if (snapshots.length > 0) {
                    // Try different ways to get the function ID
                    let functionId = null;
                    
                    if (snapshots[0].function && snapshots[0].function.id) {
                        functionId = snapshots[0].function.id;
                        debugLog('Got function ID from snapshots[0].function.id:', functionId);
                    } else if (snapshots[0].function_call_id) {
                        functionId = snapshots[0].function_call_id;
                        debugLog('Got function ID from snapshots[0].function_call_id:', functionId);
                    } else if (message.functionId) {
                        functionId = message.functionId;
                        debugLog('Got function ID from message.functionId:', functionId);
                    }
                    
                    currentFunctionId = functionId;
                    debugLog('Current function ID set to:', currentFunctionId);
                } else {
                    debugLog('No snapshots available to extract function ID');
                }
                
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
                    
                    // Always update the timeline slider max and current step display
                    if (timelineSlider) {
                        timelineSlider.max = snapshots.length - 1;
                        debugLog(`Updated timeline slider max to: ${snapshots.length - 1}`);
                    }
                    
                    // Update the step counter display in the timeline info
                    const timelineInfo = document.querySelector('.timeline-info');
                    if (timelineInfo) {
                        const totalSteps = snapshots.length;
                        // Update the "Step X of Y" text
                        timelineInfo.innerHTML = `Step <span id="currentStep">${currentStep + 1}</span> of ${totalSteps}`;
                        debugLog(`Updated timeline info to show: Step ${currentStep + 1} of ${totalSteps}`);
                    }
                    
                    // If we have new snapshots, move to the latest one
                    if (snapshots.length > previousLength && snapshots.length > 0) {
                        currentStep = snapshots.length - 1;
                        if (timelineSlider) {
                            timelineSlider.value = currentStep;
                        }
                        debugLog(`Moved to latest snapshot: step ${currentStep + 1}`);
                        
                        // Show visual feedback for new data
                        const container = document.querySelector('.stack-trace-container');
                        if (container) {
                            container.classList.add('data-updated');
                            setTimeout(() => {
                                container.classList.remove('data-updated');
                            }, 500);
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
                    
                    // Show debug overlay with update info
                    if (Math.abs(previousLength - snapshots.length) > 0) {
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
                
            case 'tracesListLoaded':
                debugLog('Traces list loaded:', message.traces);
                debugLog('Number of traces received:', message.traces?.length || 0);
                availableTraces = message.traces || [];
                populateTraceDropdown(availableTraces);
                break;
                
            case 'comparisonResult':
                debugLog('Comparison result received');
                debugLog('Success:', message.success);
                debugLog('Data available:', !!message.data);
                debugLog('Current trace data available:', !!message.currentTraceData);
                debugLog('Compare trace data available:', !!message.compareTraceData);
                if (message.success && message.data) {
                    comparisonData = message.data;
                    
                    // Store trace data for offset calculations
                    comparisonData.traceData = {
                        current: message.currentTraceData,
                        compare: message.compareTraceData
                    };
                    
                    debugLog('Stored trace data for offset calculations');
                    debugLog('Current trace code:', message.currentTraceData?.function?.code);
                    debugLog('Compare trace code:', message.compareTraceData?.function?.code);
                    
                    // Display both code versions
                    displayCodeInComparison(message.currentTraceData, message.compareTraceData);
                    
                    // Render the comparison graph
                    renderComparisonGraph(message.data);
                } else {
                    debugLog('Comparison failed:', message.error);
                    showComparisonError(message.error || 'Failed to generate comparison');
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
                ${snapshot.locals && Object.keys(snapshot.locals).length > 0 ? 
                    Object.entries(snapshot.locals).map(([name, value]) => `
                        <div class="local-variable">
                            <span class="var-name">${name}:</span>
                            <span class="var-value">${value.value}</span>
                        </div>
                    `).join('') : 
                    '<div class="empty-message">No local variables</div>'
                }
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
            if (snapshot.locals) {
                Object.keys(snapshot.locals).forEach(varName => {
                    allVarNames.add(varName);
                });
            }
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
                const varData = snapshot.locals ? snapshot.locals[varName] : null;
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