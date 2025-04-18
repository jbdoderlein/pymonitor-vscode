export interface ApiResponse<T> {
    function_calls?: T[];
    total_calls?: number;
    processed_calls?: number;
    error?: string;
}

export interface FunctionData {
    id: number;
    function: string;
    file: string;
    line: number;
    start_time: string;
    end_time: string;
    locals: Record<string, any>;
    globals: Record<string, any>;
    return_value: any;
    stack_trace: string[];
    code_info: {
        content: string;
        module_path: string;
        type: string;
        creation_time: string;
    };
}

export interface ObjectGraphResponse {
    nodes: Array<{
        id: string;
        type: string;
        metadata: Record<string, any>;
    }>;
    edges: Array<{
        source: string;
        target: string;
        type: string;
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
        id: string;
        name: string;
        file: string;
        line: number;
        time: string;
        end_time: string;
        code_definition_id: string;
        code_version_id: number;
        code: {
            content: string;
            module_path: string;
            type: string;
            name: string;
        };
        call_metadata: any;
    };
    frames: Array<{
        function: string;
        file: string;
        line: number;
        locals: Record<string, {
            value: string;
            type: string;
            code: any;
        }>;
        globals: Record<string, any>;
        snapshot_id: string;
        timestamp: string;
        previous_snapshot_id: string | null;
        next_snapshot_id: string | null;
        locals_refs: Record<string, string>;
        globals_refs: Record<string, string>;
        code: {
            content: string;
            module_path: string;
            type: string;
            name: string;
        };
        code_version_id: number;
    }>;
} 