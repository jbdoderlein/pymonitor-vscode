import * as vscode from 'vscode';
import { ApiResponse, FunctionData, ObjectGraphResponse, StackTraceResponse } from '../types';
import { state, debugLog } from './state';
import { ConfigService } from './config';

const config = ConfigService.getInstance();

const API_BASE_URL = 'http://localhost:5000';

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

export async function waitForServer(): Promise<boolean> {
    const startTime = Date.now();
    const timeout = config.getConfig().timeout;
    while (Date.now() - startTime < timeout) {
        try {
            const response = await fetch(`${config.getApiUrl()}/api/db-info`);
            if (response.ok) {
                return true;
            }
        } catch (error) {
            // Server not ready yet, continue waiting
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
}

export async function getFunctionData(filePath: string): Promise<FunctionData[] | null> {
    try {
        const response = await fetch(`${config.getApiUrl()}/api/function-calls?file=${encodeURIComponent(filePath)}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json() as { function_calls: FunctionData[] };
        return data.function_calls || [];
    } catch (error) {
        console.error('Error fetching function data:', error);
        return null;
    }
}

export async function getFunctionTraces(callId: string): Promise<FunctionData | null> {
    try {
        const response = await retryFetch(`${config.getApiUrl()}/api/function-call/${callId}`);
        const data = await response.json() as FunctionData;
        return data;
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
        const response = await fetch(`${config.getApiUrl()}/api/stack-trace/${functionId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json() as StackTraceResponse;
        return data;
    } catch (error) {
        console.error('Error fetching stack trace:', error);
        return null;
    }
} 