/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Webview script for LaTeX compilation using SwiftLaTeX
 * This runs in the webview context (browser)
 */

// This will be loaded in the webview HTML
// The actual implementation will be in JavaScript that runs in the webview

export function getCompileWebviewScript(): string {
	return `
(function() {
	const vscode = acquireVsCodeApi();
	
	let engineService = null;
	let engineInitialized = false;

	// Initialize SwiftLaTeX engine
	async function initializeEngine() {
		if (engineInitialized) {
			return;
		}

		try {
			console.log('Initializing engine, checking for PdfTeXEngine...');
			// Wait for PdfTeXEngine to be available (loaded from script tag)
			// Give it a moment to load
			let attempts = 0;
			while (typeof PdfTeXEngine === 'undefined' && attempts < 50) {
				await new Promise(resolve => setTimeout(resolve, 100));
				attempts++;
			}
			
			if (typeof PdfTeXEngine === 'undefined') {
				throw new Error('PdfTeXEngine not found after waiting. Make sure PdfTeXEngine.js is loaded. Check browser console for script loading errors.');
			}

			console.log('PdfTeXEngine found, creating engine service...');
			const Engine = PdfTeXEngine;
			engineService = new LatexEngineService(Engine);
			console.log('Initializing engine service...');
			
			// Add timeout for engine initialization (30 seconds)
			const initPromise = engineService.initialize();
			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(() => reject(new Error('Engine initialization timeout (30s)')), 30000);
			});
			
			await Promise.race([initPromise, timeoutPromise]);
			engineInitialized = true;
			console.log('Engine initialized successfully');
			
			vscode.postMessage({
				type: 'engineReady'
			});
		} catch (error) {
			console.error('Failed to initialize engine:', error);
			engineInitialized = false;
			vscode.postMessage({
				type: 'engineError',
				error: error.message || String(error)
			});
		}
	}

	// Compile LaTeX source
	async function compileLatex(latexSource, mainFile, compilationId) {
		console.log('compileLatex called, mainFile:', mainFile, 'source length:', latexSource.length);
		
		if (!engineService || !engineService.isReady()) {
			console.log('Engine not ready, initializing...');
			try {
				await initializeEngine();
				// Wait a bit after initialization
				await new Promise(resolve => setTimeout(resolve, 500));
			} catch (error) {
				console.error('Engine initialization failed during compile:', error);
				vscode.postMessage({
					type: 'compilationError',
					compilationId: compilationId,
					error: 'Engine initialization failed: ' + (error.message || String(error))
				});
				return;
			}
		}

		if (!engineService || !engineService.isReady()) {
			console.error('Engine still not ready after initialization');
			vscode.postMessage({
				type: 'compilationError',
				compilationId: compilationId,
				error: 'Engine is not ready. Check browser console for initialization errors.'
			});
			return;
		}

		try {
			vscode.postMessage({
				type: 'compilationStarted',
				compilationId: compilationId
			});

			console.log('Starting SwiftLaTeX compilation...');
			
			// Add timeout for compilation (50 seconds, leaving 10s buffer before overall timeout)
			const compilePromise = engineService.compile(latexSource, mainFile || 'main.tex');
			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(() => reject(new Error('Compilation timeout (50s)')), 50000);
			});
			
			const result = await Promise.race([compilePromise, timeoutPromise]);
			// In LaTeX compilation, status 0 means success (even with warnings)
			// status !== 0 means failure
			// The result from engine.compileLaTeX() has: {status: number, pdf: Uint8Array, log: string}
			const status = result.status;
			const pdf = result.pdf;
			const log = result.log;
			const success = status === 0 && pdf;
			console.log('Compilation result:', success ? 'success' : 'failed', result);

			if (success && pdf) {
				// Convert Uint8Array to base64 for transmission
				console.log('Converting PDF to base64, size:', pdf.length);
				const pdfBase64 = btoa(String.fromCharCode(...pdf));
				console.log('PDF converted, base64 length:', pdfBase64.length);
				
				vscode.postMessage({
					type: 'compilationSuccess',
					compilationId: compilationId,
					pdf: pdfBase64,
					log: log
				});
			} else {
				// Extract LaTeX error messages from log
				// LaTeX errors typically start with "!" followed by the error message
				let errorMsg = result.error;
				if (!errorMsg && log) {
					// Extract error lines (lines starting with "!")
					const errorLines = log.split('\\n').filter(line => line.trim().startsWith('!'));
					if (errorLines.length > 0) {
						// Get the first error and a few lines after it for context
						const firstErrorIndex = log.indexOf(errorLines[0]);
						const errorContext = log.substring(firstErrorIndex, firstErrorIndex + 500);
						// Extract just the error message (remove line numbers and extra info)
						const cleanError = errorLines[0].replace(/^! /, '').trim();
						errorMsg = cleanError || 'LaTeX compilation error';
						// Add more context if available
						if (errorContext.length > cleanError.length) {
							const nextLines = errorContext.split('\\n').slice(1, 3).join(' ').trim();
							if (nextLines) {
								errorMsg = errorMsg + ': ' + nextLines.substring(0, 200);
							}
						}
					} else {
						// Look for "Error:" or "Fatal error" patterns
						const errorMatch = log.match(/(?:Error|Fatal error|Undefined control sequence)[^\\n]*/i);
						if (errorMatch) {
							errorMsg = errorMatch[0].trim();
						} else {
							errorMsg = 'Compilation failed with status ' + status;
						}
					}
				}
				if (!errorMsg) {
					errorMsg = 'Compilation failed with status ' + status;
				}
				vscode.postMessage({
					type: 'compilationError',
					compilationId: compilationId,
					error: errorMsg,
					log: log
				});
			}
		} catch (error) {
			console.error('Compilation exception:', error);
			vscode.postMessage({
				type: 'compilationError',
				compilationId: compilationId,
				error: error.message || String(error)
			});
		}
	}

	// Listen for messages from extension host
	window.addEventListener('message', event => {
		const message = event.data;
		console.log('Webview received message:', message.type);
		
		switch (message.type) {
			case 'compile':
				console.log('Starting compilation, compilationId:', message.compilationId);
				compileLatex(message.latexSource, message.mainFile, message.compilationId).then(() => {
					console.log('Compilation completed');
				}).catch(err => {
					console.error('Compilation error:', err);
					vscode.postMessage({
						type: 'compilationError',
						compilationId: message.compilationId,
						error: err.message || String(err)
					});
				});
				break;
			case 'initialize':
				initializeEngine();
				break;
		}
	});

	// Auto-initialize on load
	console.log('Webview script loaded, initializing engine...');
	initializeEngine().then(() => {
		console.log('Engine initialization completed');
		vscode.postMessage({
			type: 'webviewReady'
		});
	}).catch(err => {
		console.error('Engine initialization failed:', err);
	});
})();
`;
}

