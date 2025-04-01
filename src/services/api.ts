import { ApiResponse, FunctionData, ObjectGraphResponse, StackTraceResponse } from '../types';

export async function retryFetch(url: string, maxRetries: number = 3): Promise<Response> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response;
        } catch (error) {
            if (i === maxRetries - 1) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    throw new Error('Max retries reached');
}

export async function waitForServer(timeoutMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        try {
            const response = await fetch('http://localhost:5000/api/db-info');
            if (response.ok) {
                return true;
            }
        } catch (error) {
            // Server not ready yet, continue waiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    return false;
}

export async function getFunctionData(filePath: string): Promise<FunctionData[] | null> {
    try {
        const response = await retryFetch(`http://localhost:5000/api/function-calls?file=${encodeURIComponent(filePath)}`);
        const data = await response.json() as ApiResponse<FunctionData>;
        
        if (data.error) {
            throw new Error(data.error);
        }

        console.log(`Found ${data.function_calls?.length || 0} function calls in ${filePath}`);
        return data.function_calls || [];
    } catch (error) {
        console.error('Error fetching function data:', error);
        return null;
    }
}

export async function getFunctionTraces(callId: string): Promise<FunctionData | null> {
    try {
        const response = await retryFetch(`http://localhost:5000/api/function-call/${callId}`);
        const data = await response.json() as ApiResponse<FunctionData>;
        if (data.error) {
            throw new Error(data.error);
        }
        return data.function_calls?.[0] || null;
    } catch (error) {
        console.error('Error fetching function traces:', error);
        return null;
    }
}

export async function getObjectGraph(): Promise<ObjectGraphResponse | null> {
    try {
        const response = await retryFetch('http://localhost:5000/api/object-graph');
        const data = await response.json() as ObjectGraphResponse;
        if (data.error) {
            throw new Error(data.error);
        }
        return data;
    } catch (error) {
        console.error('Error fetching object graph:', error);
        return null;
    }
}

export async function getStackTrace(functionId: string): Promise<StackTraceResponse | null> {
    try {
        const response = await retryFetch(`http://localhost:5000/api/stack-trace/${functionId}`);
        const data = await response.json() as StackTraceResponse;
        return data;
    } catch (error) {
        console.error('Error fetching stack trace:', error);
        return null;
    }
} 