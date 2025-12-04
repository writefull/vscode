/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { OutputChannelLogger } from '../utils/logger';
import { CompilationResult } from '../latexService';
import { getCompileWebviewScript } from '../webview/compileWebview';

/**
 * WebAssembly-based LaTeX compiler
 * Uses SwiftLaTeX via webview-based compilation
 * Compilation happens in webview context (browser), not extension host
 */
export class WasmLatexCompiler {
	private compileWebview: vscode.WebviewPanel | null = null;
	private context: vscode.ExtensionContext | null = null;
	private initialized = false;
	private pendingCompilations = new Map<string, {
		resolve: (result: CompilationResult) => void;
		reject: (error: Error) => void;
		timeoutHandle?: ReturnType<typeof setTimeout>;
	}>();

	constructor(
		private readonly logger: OutputChannelLogger,
		context?: vscode.ExtensionContext
	) {
		this.context = context || null;
	}

	async compile(uri: vscode.Uri, _recipe: string): Promise<CompilationResult> {
		try {
			// Check if SwiftLaTeX files are available
			if (this.context) {
				const wasmPath = vscode.Uri.joinPath(this.context.extensionUri, 'vendors', 'swiftlatex', 'swiftlatexpdftex.wasm');
				try {
					await vscode.workspace.fs.stat(wasmPath);
				} catch {
					return {
						success: false,
						error: 'SwiftLaTeX WASM files not found. Please download SwiftLaTeX files to vendors/swiftlatex/ directory. ' +
							'See SETUP_SWIFTLATEX.md for instructions. ' +
							'Required files: PdfTeXEngine.js, swiftlatexpdftex.js, swiftlatexpdftex.wasm'
					};
				}
			}

			// Check context first
			if (!this.context) {
				this.logger.error('Extension context is not available');
				return {
					success: false,
					error: 'Extension context is not available. The extension may not be properly activated. Please restart VS Code.'
				};
			}

			// Initialize webview if not already done
			if (!this.initialized) {
				this.logger.info('Webview not initialized, initializing now...');
				await this.initializeWebview();
			}

			if (!this.compileWebview) {
				this.logger.error('Webview panel is null after initialization');
				return {
					success: false,
					error: 'Failed to create webview panel. Check the "LaTeX" output channel for detailed error messages.'
				};
			}

			if (!this.context) {
				this.logger.error('Extension context lost after webview initialization');
				return {
					success: false,
					error: 'Extension context is not available. Please restart VS Code.'
				};
			}

			// Read the LaTeX source
			const document = await vscode.workspace.openTextDocument(uri);
			const latexSource = document.getText();

			// Get base name for main file
			const uriPath = uri.path;
			const lastSlash = uriPath.lastIndexOf('/');
			const fileName = lastSlash >= 0 ? uriPath.substring(lastSlash + 1) : uriPath;

			this.logger.info(`Compiling LaTeX with SwiftLaTeX: ${fileName}`);

			// Compile using webview
			return await this.compileInWebview(latexSource, fileName, uri);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.error(`WASM compilation error: ${message}`);
			return {
				success: false,
				error: message
			};
		}
	}

	private async compileInWebview(latexSource: string, mainFile: string, uri: vscode.Uri): Promise<CompilationResult> {
		return new Promise((resolve, reject) => {
			const compilationId = `${Date.now()}-${Math.random()}`;

			// Store promise handlers
			this.pendingCompilations.set(compilationId, { resolve, reject });

			// Set up message listener (one-time)
			const messageListener = this.compileWebview!.webview.onDidReceiveMessage(async (message) => {
				this.logger.info(`Received message from webview: ${message.type} (compilationId: ${message.compilationId})`);

				if (message.compilationId !== compilationId) {
					this.logger.warn(`Message compilationId mismatch: expected ${compilationId}, got ${message.compilationId}`);
					return; // Not for this compilation
				}

				switch (message.type) {
					case 'webviewReady':
						this.logger.info('Webview is ready');
						break;

					case 'compilationStarted':
						this.logger.info('Compilation started in webview');
						break;

					case 'compilationSuccess':
						try {
							// Decode base64 PDF
							const pdfBase64 = message.pdf;
							// Decode base64 - in Node.js extension host, we can use a simple base64 decoder
							// Convert base64 string to Uint8Array
							const binaryString = this.base64ToBinary(pdfBase64);
							const pdfBytes = new Uint8Array(binaryString.length);
							for (let i = 0; i < binaryString.length; i++) {
								pdfBytes[i] = binaryString.charCodeAt(i);
							}

							// Save PDF to file system
							const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
							if (!workspaceFolder) {
								throw new Error('No workspace folder found');
							}

							const lastDot = mainFile.lastIndexOf('.');
							const baseName = lastDot >= 0 ? mainFile.substring(0, lastDot) : mainFile;
							const pdfUri = vscode.Uri.joinPath(workspaceFolder.uri, baseName + '.pdf');

							await vscode.workspace.fs.writeFile(pdfUri, pdfBytes);

							this.logger.info(`PDF generated: ${pdfUri.toString()}`);

							const result: CompilationResult = {
								success: true,
								pdfPath: pdfUri.fsPath || pdfUri.toString()
							};

							const pending = this.pendingCompilations.get(compilationId);
							if (pending) {
								this.pendingCompilations.delete(compilationId);
								if (pending.timeoutHandle) {
									clearTimeout(pending.timeoutHandle);
								}
								pending.resolve(result);
							}
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							this.logger.error(`Failed to save PDF: ${message}`);
							const pending = this.pendingCompilations.get(compilationId);
							if (pending) {
								this.pendingCompilations.delete(compilationId);
								if (pending.timeoutHandle) {
									clearTimeout(pending.timeoutHandle);
								}
								pending.reject(new Error(message));
							}
						}
						messageListener.dispose();
						break;

					case 'compilationError': {
						this.logger.error(`Compilation error: ${message.error}`);
						if (message.log) {
							this.logger.error(`Compilation log: ${message.log}`);
						}
						const pending = this.pendingCompilations.get(compilationId);
						if (pending) {
							this.pendingCompilations.delete(compilationId);
							if (pending.timeoutHandle) {
								clearTimeout(pending.timeoutHandle);
							}
							pending.resolve({
								success: false,
								error: message.error || 'Compilation failed'
							});
						}
						messageListener.dispose();
						break;
					}

					case 'engineError': {
						this.logger.error(`Engine error: ${message.error}`);
						const pending2 = this.pendingCompilations.get(compilationId);
						if (pending2) {
							this.pendingCompilations.delete(compilationId);
							if (pending2.timeoutHandle) {
								clearTimeout(pending2.timeoutHandle);
							}
							pending2.resolve({
								success: false,
								error: `SwiftLaTeX engine error: ${message.error}`
							});
						}
						messageListener.dispose();
						break;
					}
				}
			});

			// Send compile message to webview
			this.logger.info(`Sending compile message to webview (compilationId: ${compilationId}, mainFile: ${mainFile})`);
			try {
				this.compileWebview!.webview.postMessage({
					type: 'compile',
					compilationId,
					latexSource,
					mainFile
				});
				this.logger.info('Compile message sent to webview');
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.logger.error(`Failed to send message to webview: ${message}`);
				messageListener.dispose();
				resolve({
					success: false,
					error: `Failed to communicate with webview: ${message}`
				});
				return;
			}

			// Timeout after 60 seconds
			const timeoutHandle = setTimeout(() => {
				if (this.pendingCompilations.has(compilationId)) {
					this.pendingCompilations.delete(compilationId);
					messageListener.dispose();
					resolve({
						success: false,
						error: 'Compilation timeout (60s)'
					});
				}
			}, 60000);

			// Store timeout handle in pending compilation
			const pending = this.pendingCompilations.get(compilationId);
			if (pending) {
				pending.timeoutHandle = timeoutHandle;
			}
		});
	}

	private async initializeWebview(): Promise<void> {
		if (!this.context) {
			this.logger.error('Extension context required for webview-based compilation');
			this.logger.error('Context is null. This may happen if extension was not properly activated.');
			this.initialized = true;
			return;
		}

		try {
			this.logger.info('Initializing SwiftLaTeX webview compiler...');
			this.logger.info(`Extension URI: ${this.context.extensionUri.toString()}`);

			// Create a hidden webview panel for compilation
			this.compileWebview = vscode.window.createWebviewPanel(
				'latexCompile',
				'LaTeX Compiler',
				{ viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
				{
					enableScripts: true,
					localResourceRoots: [
						vscode.Uri.joinPath(this.context.extensionUri, 'vendors'),
						vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview'),
						this.context.extensionUri
					],
					retainContextWhenHidden: true
				}
			);

			// Don't auto-dispose on visibility change - we need it to stay alive
			// The webview will be disposed when the compiler is disposed

			// Set webview HTML
			this.compileWebview.webview.html = await this.getWebviewHtml();
			this.logger.info('Webview HTML set');

			// Wait a bit for webview to initialize
			await new Promise(resolve => setTimeout(resolve, 1000));

			// Set up a general message listener to log all messages
			this.compileWebview.webview.onDidReceiveMessage((message) => {
				if (message.type !== 'compilationStarted' && message.type !== 'compilationSuccess' && message.type !== 'compilationError' && message.type !== 'engineReady' && message.type !== 'engineError' && message.type !== 'webviewReady') {
					this.logger.info(`Webview message: ${JSON.stringify(message)}`);
				}
			});

			this.initialized = true;
			this.logger.info('SwiftLaTeX webview compiler initialized successfully');
		} catch (error) {
			this.initialized = false;
			if (this.compileWebview) {
				this.compileWebview.dispose();
			}
			this.compileWebview = null;
			const message = error instanceof Error ? error.message : String(error);
			this.logger.error(`Failed to initialize webview compiler: ${message}`);
			if (error instanceof Error && error.stack) {
				this.logger.error(`Stack trace: ${error.stack}`);
			}
		}
	}

	private async getWebviewHtml(): Promise<string> {
		if (!this.context) {
			throw new Error('Extension context required');
		}

		const webview = this.compileWebview!.webview;
		const nonce = this.getNonce();

		// Get URIs for SwiftLaTeX files
		const pdfTexEngineUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'vendors', 'swiftlatex', 'PdfTeXEngine.js')
		);

		// Get URIs for worker and WASM files
		const workerScriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'vendors', 'swiftlatex', 'swiftlatexpdftex.js')
		);
		const wasmUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'vendors', 'swiftlatex', 'swiftlatexpdftex.wasm')
		);

		// Worker script will be fetched in the webview and converted to a blob URL
		// This avoids CORS issues by ensuring same-origin

		const compileScript = getCompileWebviewScript();

		const cspSource = webview.cspSource;

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${cspSource}; script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${cspSource}; style-src ${cspSource} 'unsafe-inline'; connect-src ${cspSource} https:; worker-src blob: ${cspSource}; child-src blob:;">
	<title>LaTeX Compiler</title>
	<style>
		body {
			display: none; /* Hidden webview for compilation only */
		}
	</style>
</head>
<body>
	<!-- Setup worker path and load PdfTeXEngine -->
	<script nonce="${nonce}">
		// PdfTeXEngine.js has a hardcoded ENGINE_PATH = '/swiftlatex/swiftlatexpdftex.js'
		// We need to create a blob URL for the worker script to avoid CORS issues
		// Also need to patch the WASM path inside the worker script
		// Fetch worker script and create blob URL BEFORE loading PdfTeXEngine
		(async function() {
			try {
				console.log('Fetching worker script from:', '${workerScriptUri}');
				const response = await fetch('${workerScriptUri}');
				if (!response.ok) {
					throw new Error('Failed to fetch worker script: ' + response.status);
				}
				let workerScriptContent = await response.text();
				
				// Patch the worker script to use the correct WASM URL
				// The worker script uses relative paths like 'swiftlatexpdftex.wasm'
				// which fail when the Worker runs from a blob URL
				const wasmUriStr = ${JSON.stringify(wasmUri.toString())};
				
				// Pattern 1: Simple quoted strings (most common)
				// Match: 'swiftlatexpdftex.wasm' or "swiftlatexpdftex.wasm" or './swiftlatexpdftex.wasm'
				workerScriptContent = workerScriptContent.replace(
					/(['"])(\\.\\/)?swiftlatexpdftex\\.wasm(['"])/g,
					function(match, quote1, dotSlash, quote2) {
						console.log('Patching WASM path in worker:', match, '->', quote1 + wasmUriStr + quote2);
						return quote1 + wasmUriStr + quote2;
					}
				);
				
				// Pattern 2: Template literals
				workerScriptContent = workerScriptContent.replace(
					/(\`)(\\.\\/)?swiftlatexpdftex\\.wasm(\`)/g,
					function(match, quote1, dotSlash, quote2) {
						console.log('Patching WASM path in template literal:', match, '->', quote1 + wasmUriStr + quote2);
						return quote1 + wasmUriStr + quote2;
					}
				);
				
				const blob = new Blob([workerScriptContent], { type: 'application/javascript' });
				const workerBlobUrl = URL.createObjectURL(blob);
				console.log('Created blob URL for worker:', workerBlobUrl);
				window.SWIFTLATEX_WORKER_PATH = workerBlobUrl;
			} catch (error) {
				console.error('Failed to create blob URL for worker:', error);
				// Fallback to URI (may have CORS issues)
				window.SWIFTLATEX_WORKER_PATH = '${workerScriptUri}';
				console.warn('Using URI for worker (may have CORS issues):', window.SWIFTLATEX_WORKER_PATH);
			}
			window.SWIFTLATEX_WASM_PATH = '${wasmUri}';
			console.log('SwiftLaTeX paths set:', {
				worker: window.SWIFTLATEX_WORKER_PATH,
				wasm: window.SWIFTLATEX_WASM_PATH
			});
			
			// Now load PdfTeXEngine after worker path is ready
			const script = document.createElement('script');
			script.nonce = '${nonce}';
			script.src = '${pdfTexEngineUri}';
			script.onload = function() {
				console.log('PdfTeXEngine.js loaded');
				// Signal that engine is ready to be used
				window.SWIFTLATEX_ENGINE_LOADED = true;
				if (window.SWIFTLATEX_ENGINE_LOADED_CALLBACK) {
					window.SWIFTLATEX_ENGINE_LOADED_CALLBACK();
				}
			};
			script.onerror = function(error) {
				console.error('Failed to load PdfTeXEngine.js:', error);
			};
			document.head.appendChild(script);
		})();
	</script>
	
	<!-- Wait for PdfTeXEngine to load before patching -->
	<script nonce="${nonce}">
		// Wait for PdfTeXEngine to load, then patch Worker creation
		function waitForEngineAndPatch() {
			if (window.SWIFTLATEX_ENGINE_LOADED) {
				// Engine is already loaded, patch immediately
				patchWorkerCreation();
			} else {
				// Wait for engine to load
				window.SWIFTLATEX_ENGINE_LOADED_CALLBACK = patchWorkerCreation;
			}
		}
		
		function patchWorkerCreation() {
			console.log('Patching Worker creation for SwiftLaTeX');
			// The actual path is used in: new Worker(ENGINE_PATH)
			// We'll patch the Worker creation to use our blob URL
		}
		
		waitForEngineAndPatch();
	</script>
	
	<!-- Load LatexEngineService (inline for now, can be externalized) -->
	<script nonce="${nonce}">
		// LatexEngineService implementation (simplified for webview)
		class LatexEngineService {
			constructor(Engine) {
				this.Engine = Engine;
				this.engine = null;
				this.engineReady = false;
			}

		async initialize() {
			if (this.engineReady) return;
			console.log('Creating new engine instance...');
			
			// Wait for PdfTeXEngine to be loaded
			if (!window.SWIFTLATEX_ENGINE_LOADED) {
				console.log('Waiting for PdfTeXEngine to load...');
				await new Promise((resolve) => {
					if (window.SWIFTLATEX_ENGINE_LOADED) {
						resolve(undefined);
					} else {
						window.SWIFTLATEX_ENGINE_LOADED_CALLBACK = () => resolve(undefined);
					}
				});
			}
			
			// Ensure worker path is ready (blob URL should be created by now)
			if (!window.SWIFTLATEX_WORKER_PATH) {
				throw new Error('Worker path not set. Blob URL creation may have failed.');
			}
			
			// Create a patched Engine class that uses the correct worker path
			const PatchedEngine = class extends this.Engine {
				loadEngine() {
					const originalLoadEngine = super.loadEngine.bind(this);
					// Patch the Worker creation
					const originalWorker = window.Worker;
					window.Worker = function(path) {
						// Check if this is the SwiftLaTeX worker path (could be the hardcoded path or a relative path)
						if ((path === '/swiftlatex/swiftlatexpdftex.js' ||
							path.includes('swiftlatexpdftex.js')) &&
							window.SWIFTLATEX_WORKER_PATH) {
							console.log('Patching Worker path:', path, '->', window.SWIFTLATEX_WORKER_PATH);
							return new originalWorker(window.SWIFTLATEX_WORKER_PATH);
						}
						return new originalWorker(path);
					};
					
					return originalLoadEngine().finally(() => {
						// Restore original Worker
						window.Worker = originalWorker;
					});
				}
			};
			
			this.engine = new PatchedEngine();
			console.log('Loading engine (this may take a moment, loading WASM files)...');
			try {
				await this.engine.loadEngine();
				console.log('Engine loaded, setting TeXlive endpoint...');
				this.engine.setTexliveEndpoint('https://texlive.emaily.re');
				this.engineReady = this.engine.isReady();
				console.log('Engine ready:', this.engineReady);
			} catch (error) {
				console.error('Error during engine.loadEngine():', error);
				this.engineReady = false;
				throw error;
			}
		}

			async compile(latexSource, mainFile = 'main.tex') {
				if (!this.engineReady) {
					console.log('Engine not ready, initializing...');
					await this.initialize();
				}
				if (!this.engine || !this.engine.isReady()) {
					throw new Error('Engine not ready after initialization');
				}
				console.log('Writing LaTeX source to virtual file system...');
				this.engine.writeMemFSFile(mainFile, latexSource);
				this.engine.setEngineMainFile(mainFile);
				console.log('Starting LaTeX compilation...');
				const result = await this.engine.compileLaTeX();
				console.log('Compilation completed, status:', result.status);
				// Return raw result - compileWebview.ts will handle status interpretation
				return result;
			}

			isReady() {
				return this.engineReady && this.engine && this.engine.isReady();
			}
		}
		window.LatexEngineService = LatexEngineService;
	</script>
	
	<!-- Compilation script -->
	<script nonce="${nonce}">
		${compileScript}
	</script>
</body>
</html>`;
	}

	private base64ToBinary(base64: string): string {
		// Simple base64 decoder for Node.js environment
		// In browser, we'd use atob, but in Node.js extension host we decode manually
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
		let output = '';

		base64 = base64.replace(/[^A-Za-z0-9\+\/]/g, '');

		for (let i = 0; i < base64.length; i += 4) {
			const enc1 = chars.indexOf(base64.charAt(i));
			const enc2 = chars.indexOf(base64.charAt(i + 1));
			const enc3 = chars.indexOf(base64.charAt(i + 2));
			const enc4 = chars.indexOf(base64.charAt(i + 3));

			const chr1 = (enc1 << 2) | (enc2 >> 4);
			const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
			const chr3 = ((enc3 & 3) << 6) | enc4;

			output += String.fromCharCode(chr1);

			if (enc3 !== 64) {
				output += String.fromCharCode(chr2);
			}
			if (enc4 !== 64) {
				output += String.fromCharCode(chr3);
			}
		}

		return output;
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
		if (this.compileWebview) {
			this.compileWebview.dispose();
			this.compileWebview = null;
		}
		this.pendingCompilations.clear();
		this.initialized = false;
	}
}

