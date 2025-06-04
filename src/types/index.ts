export interface ApiResponse<T> {
    function_calls?: T[];
    total_calls?: number;
    processed_calls?: number;
    error?: string;
}

export interface FunctionData {
    id: number | string;
    function: string;
    file: string;
    line: number;
    start_time: string;
    end_time: string;
    duration: number;
    has_stack_recording: boolean;
    locals: Record<string, {
        value: string;
        type: string;
    }>;
    globals: Record<string, {
        value: string;
        type: string;
    }>;
    return_value: {
        value: string;
        type: string;
    };
    stack_trace?: string[];
}

export interface ObjectGraphResponse {
    nodes: Array<{
        data: {
            id: string;
            originalId: string;
            label: string;
            nodeType: string;
            type: string;
            [key: string]: any;
        }
    }>;
    edges: Array<{
        data: {
            id: string;
            source: string;
            target: string;
            label: string;
            edgeType: string;
        }
    }>;
    error?: string;
}

export interface StackFrame {
    function: string;
    file: string;
    line: number;
}

export interface StackTraceResponse {
    function: {
        id: number | string;
        name: string;
        file: string;
        line: number;
        time: string;
        end_time: string;
        code_definition_id: string;
        call_metadata: any;
    };
    frames: Array<{
        id: string;
        line: number;
        snapshot_id: string;
        timestamp: string;
        locals_refs: Record<string, string>;
        globals_refs: Record<string, string>;
        locals: Record<string, {
            value: string;
            type: string;
        }>;
        globals: Record<string, {
            value: string;
            type: string;
        }>;
    }>;
}

export interface SnapshotDetails {
    id: string;
    function_call_id: string | number;
    function: string;
    file: string;
    line: number;
    timestamp: string;
    locals: Record<string, {
        value: string;
        type: string;
    }>;
    globals: Record<string, {
        value: string;
        type: string;
    }>;
    previous_snapshot_id: string | null;
    next_snapshot_id: string | null;
}

export interface SessionSummary {
    id: number;
    name: string;
    description: string;
    start_time: string;
    end_time: string;
    function_calls: Array<string | number>;
    function_count: Record<string, number>;
    metadata: any;
}

export interface SessionDetails extends SessionSummary {
    function_calls_map: Record<string, Array<string | number>>;
    common_variables: Record<string, {
        locals: string[];
        globals: string[];
    }>;
} 