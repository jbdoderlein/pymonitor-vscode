import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Get webview content with properly resolved CSS and JS paths
 */
export function getWebviewContent(webview: vscode.Webview, templatePath: string, context: vscode.ExtensionContext): string {
    try {
        // The webview files are copied to the dist directory during build
        const webviewPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
        const htmlPath = vscode.Uri.joinPath(webviewPath, templatePath);
        
        console.log(`Loading HTML template from: ${htmlPath.fsPath}`);
        const htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');
        
        // Replace CSS and JS file paths with webview URIs
        const cssPattern = /href="css\/([^"]+)"/g;
        const jsPattern = /src="js\/([^"]+)"/g;
        
        let resolvedHtml = htmlContent.replace(cssPattern, (match, file) => {
            const cssPath = vscode.Uri.joinPath(webviewPath, 'css', file);
            return `href="${webview.asWebviewUri(cssPath)}"`;
        });
        
        resolvedHtml = resolvedHtml.replace(jsPattern, (match, file) => {
            const jsPath = vscode.Uri.joinPath(webviewPath, 'js', file);
            return `src="${webview.asWebviewUri(jsPath)}"`;
        });
        
        return resolvedHtml;
    } catch (error) {
        console.error(`Error loading template: ${error}`);
        return `<html><body><h1>Error loading template</h1><p>${error}</p></body></html>`;
    }
} 