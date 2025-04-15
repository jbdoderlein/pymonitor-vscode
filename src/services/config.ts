import * as vscode from 'vscode';

export interface PyMonitorConfig {
    apiBaseUrl: string;
    serverPort: number;
    refreshInterval: number;
    maxRetries: number;
    timeout: number;
}

export class ConfigService {
    private static instance: ConfigService;
    private config: PyMonitorConfig;

    private constructor() {
        this.config = this.loadConfig();
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('pymonitor')) {
                this.config = this.loadConfig();
            }
        });
    }

    public static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }

    private loadConfig(): PyMonitorConfig {
        const config = vscode.workspace.getConfiguration('pymonitor');
        return {
            apiBaseUrl: config.get<string>('apiBaseUrl', 'http://localhost'),
            serverPort: config.get<number>('serverPort', 8000),
            refreshInterval: config.get<number>('refreshInterval', 5000),
            maxRetries: config.get<number>('maxRetries', 3),
            timeout: config.get<number>('timeout', 30000)
        };
    }

    public getConfig(): PyMonitorConfig {
        return this.config;
    }

    public getApiUrl(): string {
        return `${this.config.apiBaseUrl}:${this.config.serverPort}`;
    }
} 