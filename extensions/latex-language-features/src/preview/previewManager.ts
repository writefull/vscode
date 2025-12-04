/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { OutputChannelLogger } from '../utils/logger';

/**
 * Manages LaTeX PDF preview in webview panels
 */
export class PreviewManager implements vscode.Disposable {
	private previewPanels = new Map<string, vscode.WebviewPanel>();

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly logger: OutputChannelLogger
	) { }

	async showPreview(texUri: vscode.Uri, pdfPath: string): Promise<void> {
		const key = texUri.toString();
		let panel = this.previewPanels.get(key);

		// Get base name from URI
		const uriPath = texUri.path;
		const lastSlash = uriPath.lastIndexOf('/');
		const fileName = lastSlash >= 0 ? uriPath.substring(lastSlash + 1) : uriPath;

		if (panel) {
			panel.reveal();
		} else {
			// Get PDF URI
			const pdfUri = typeof pdfPath === 'string' && pdfPath.startsWith('file://')
				? vscode.Uri.parse(pdfPath)
				: typeof pdfPath === 'string'
					? vscode.Uri.file(pdfPath)
					: pdfPath as vscode.Uri;

			// Get directory URI for local resource roots
			const pdfDirUri = vscode.Uri.joinPath(pdfUri, '..');

			panel = vscode.window.createWebviewPanel(
				'latexPreview',
				`LaTeX Preview: ${fileName}`,
				vscode.ViewColumn.Beside,
				{
					enableScripts: true,
					localResourceRoots: [
						vscode.Uri.joinPath(this.context.extensionUri, 'media'),
						vscode.Uri.joinPath(this.context.extensionUri, 'vendors'),
						pdfDirUri
					]
				}
			);

			panel.onDidDispose(() => {
				this.previewPanels.delete(key);
			});

			this.previewPanels.set(key, panel);
		}

		// Load PDF using PDF.js or similar
		await this.loadPdfInWebview(panel, pdfPath);
	}

	private async loadPdfInWebview(panel: vscode.WebviewPanel, pdfPath: string): Promise<void> {
		// Convert local file path to webview URI
		const pdfUri = typeof pdfPath === 'string' && pdfPath.startsWith('file://')
			? panel.webview.asWebviewUri(vscode.Uri.parse(pdfPath))
			: typeof pdfPath === 'string'
				? panel.webview.asWebviewUri(vscode.Uri.file(pdfPath))
				: panel.webview.asWebviewUri(pdfPath as vscode.Uri);

		// Create HTML content with PDF viewer
		const html = this.getPdfViewerHtml(panel, pdfUri);
		panel.webview.html = html;

		this.logger.info(`Preview loaded: ${pdfPath}`);
	}

	private getPdfViewerHtml(panel: vscode.WebviewPanel, pdfUri: vscode.Uri): string {
		const nonce = this.getNonce();
		const cspSource = panel.webview.cspSource;

		// Get PDF.js URIs if available
		const pdfjsUri = vscode.Uri.joinPath(this.context.extensionUri, 'vendors', 'pdfjs', 'pdf.min.mjs');
		const pdfjsWorkerUri = vscode.Uri.joinPath(this.context.extensionUri, 'vendors', 'pdfjs', 'pdf.worker.min.mjs');
		const pdfjsViewerCssUri = vscode.Uri.joinPath(this.context.extensionUri, 'vendors', 'pdfjs', 'pdf_viewer.css');

		const pdfjsUriWebview = panel.webview.asWebviewUri(pdfjsUri);
		const pdfjsWorkerUriWebview = panel.webview.asWebviewUri(pdfjsWorkerUri);
		const pdfjsViewerCssUriWebview = panel.webview.asWebviewUri(pdfjsViewerCssUri);

		// Use PDF.js for proper rendering with correct CSP
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${cspSource}; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; style-src ${cspSource} 'unsafe-inline'; connect-src ${cspSource} https:; worker-src blob:; child-src blob:;">
	<link rel="stylesheet" href="${pdfjsViewerCssUriWebview}">
	<style nonce="${nonce}">
		body {
			margin: 0;
			padding: 0;
			overflow: hidden;
			background: var(--vscode-editor-background);
		}
		#pdf-container {
			width: 100%;
			height: 100vh;
			overflow: auto;
			padding: 20px;
			box-sizing: border-box;
		}
		.pdf-page-container {
			position: relative;
			margin: 0 auto 20px auto;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		}
		.pdf-page-container canvas {
			display: block;
		}
		#loading {
			text-align: center;
			padding: 2rem;
			color: var(--vscode-foreground);
		}
		#error {
			text-align: center;
			padding: 2rem;
			color: var(--vscode-errorForeground);
			display: none;
		}
	</style>
</head>
<body>
	<div id="loading">Loading PDF...</div>
	<div id="error"></div>
	<div id="pdf-container" style="display: none;"></div>
	
	<script type="module" nonce="${nonce}">
		import * as pdfjsLib from "${pdfjsUriWebview}";
		pdfjsLib.GlobalWorkerOptions.workerSrc = "${pdfjsWorkerUriWebview}";
		
		const pdfUrl = "${pdfUri}";
		const container = document.getElementById('pdf-container');
		const loading = document.getElementById('loading');
		const error = document.getElementById('error');
		
		async function loadPdf() {
			try {
				const loadingTask = pdfjsLib.getDocument(pdfUrl);
				const pdf = await loadingTask.promise;
				
				loading.style.display = 'none';
				container.style.display = 'block';
				
				// Render all pages
				for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
					const page = await pdf.getPage(pageNum);
					const viewport = page.getViewport({ scale: 1.5 });
					
					const pageDiv = document.createElement('div');
					pageDiv.className = 'pdf-page-container';
					pageDiv.style.width = viewport.width + 'px';
					pageDiv.style.height = viewport.height + 'px';
					
					const canvas = document.createElement('canvas');
					const context = canvas.getContext('2d');
					canvas.height = viewport.height;
					canvas.width = viewport.width;
					
					pageDiv.appendChild(canvas);
					container.appendChild(pageDiv);
					
					await page.render({
						canvasContext: context,
						viewport: viewport
					}).promise;
				}
			} catch (err) {
				loading.style.display = 'none';
				error.style.display = 'block';
				error.textContent = 'Failed to load PDF: ' + err.message;
				console.error('PDF loading error:', err);
			}
		}
		
		loadPdf();
	</script>
</body>
</html>`;
	}

	private getNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}

	dispose(): void {
		this.previewPanels.forEach(panel => panel.dispose());
		this.previewPanels.clear();
	}
}

