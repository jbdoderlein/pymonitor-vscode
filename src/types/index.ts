export interface ApiResponse<T> {
    function_calls?: T[];
    total_calls?: number;
    processed_calls?: number;
    error?: string;
}

export interface FunctionData {
    id: string;
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
    function_name: string;
    file: string;
    line: number;
    code: {
        content: string;
        first_line_no: number;
        module_path: string;
        type: string;
    };
    end_time: string;
    function_id: number;
    snapshots: Array<{
        globals: Record<string, any>;
        id: number;
        line: number;
        locals: Record<string, {
            code: any;
            type: string;
            value: string;
        }>;
        timestamp: string;
    }>;
    start_time: string;
} 