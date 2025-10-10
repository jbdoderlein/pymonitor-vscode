import { GraphItem, GraphData } from '../providers/graphWebviewProvider';
import { getGraph } from './api';
import { state, debugLog } from './state';
export interface ApiNode {
    line: number;
    vars: Array<Record<string, string>>;
}

export interface ApiEdge {
    0: string; // from node id
    1: string; // to node id
    2: {
        diff: Array<Record<string, [any, any]>>;
    };
}

export interface ApiGraphData {
    nodes: Record<string, ApiNode>; 
    edges: ApiEdge[];
}


export async function updateGraphData(functionId: string) {
    if (!state.graphWebviewProvider) {
        debugLog('Graph webview provider is not initialized');
        return;
    }
    const apiData = await getGraph(functionId);
    if (!apiData) {
        debugLog('Failed to retrieve graph data');
        return;
    }

    const graphData = transformApiDataToGraph(apiData);
    state.graphWebviewProvider.setGraphData(graphData);
}


function transformApiDataToGraph(apiData: ApiGraphData): GraphData {
    const items: GraphItem[] = [];
    
    // Create a map to track node order based on edges
    const nodeOrder = calculateNodeOrder(apiData);
    
    // Sort nodes by their order in the execution flow
    const sortedNodeIds = Object.keys(apiData.nodes).sort((a, b) => {
        return nodeOrder[a] - nodeOrder[b];
    });

    // Transform each node to a GraphItem
    sortedNodeIds.forEach((nodeId, index) => {
        const node = apiData.nodes[nodeId];
        const item: GraphItem = {
            id: nodeId,
            text: `line ${node.line}`,
            description: formatVariables(node.vars),
            line: node.line,
            type: 'normal',
            branch: 0,
            connections: {
                up: index > 0,
                down: index < sortedNodeIds.length - 1
            }
        };
        items.push(item);
    });

    return { items };
}

function calculateNodeOrder(apiData: ApiGraphData): Record<string, number> {
    const order: Record<string, number> = {};
    const visited = new Set<string>();
    let currentOrder = 0;

    // Find root nodes (nodes with no incoming edges)
    const hasIncoming = new Set<string>();
    apiData.edges.forEach(edge => {
        hasIncoming.add(edge[1]); // to node
    });

    const rootNodes = Object.keys(apiData.nodes).filter(nodeId => !hasIncoming.has(nodeId));

    // If no clear root, start with the first node
    if (rootNodes.length === 0) {
        rootNodes.push(Object.keys(apiData.nodes)[0]);
    }

    // DFS to assign order
    const dfs = (nodeId: string) => {
        if (visited.has(nodeId)) {return;}
        visited.add(nodeId);
        order[nodeId] = currentOrder++;

        // Find outgoing edges
        const outgoingEdges = apiData.edges.filter(edge => edge[0] === nodeId);
        outgoingEdges.forEach(edge => {
            dfs(edge[1]);
        });
    };

    rootNodes.forEach(rootNode => dfs(rootNode));

    // Handle any remaining unvisited nodes
    Object.keys(apiData.nodes).forEach(nodeId => {
        if (!visited.has(nodeId)) {
            order[nodeId] = currentOrder++;
        }
    });

    return order;
}

/**
 * Format variables array into a readable string
 */
function formatVariables(vars: Array<Record<string, string>>): string {
    if (!vars || vars.length === 0) {return '';}
    
    const allVars: Record<string, string> = {};
    vars.forEach(varObj => {
        Object.assign(allVars, varObj);
    });

    const varStrings = Object.entries(allVars).map(([key, value]) => `${key}=${value}`);
    return varStrings.join(', ');
}

/**
 * Set the current/active line in the graph data
 */
function setCurrentLine(graphData: GraphData, lineNumber: number): GraphData {
    const updatedItems = graphData.items.map(item => ({
        ...item,
        type: item.line === lineNumber ? 'current' as const : 'normal' as const
    }));

    return { items: updatedItems };
}

/**
 * Add error/warning indicators to specific lines
 */
function setLineStatus(graphData: GraphData, lineNumber: number, status: 'error' | 'warning' | 'normal'): GraphData {
    const updatedItems = graphData.items.map(item => ({
        ...item,
        type: item.line === lineNumber ? status : item.type
    }));

    return { items: updatedItems };
}
