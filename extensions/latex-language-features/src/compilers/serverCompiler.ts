/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { OutputChannelLogger } from '../utils/logger';
import { CompilationResult } from '../latexService';

/**
 * Server-side LaTeX compiler
 * Uses system LaTeX installation (pdflatex, xelatex, lualatex, latexmk)
 */
export class ServerLatexCompiler {
	constructor(private readonly logger: OutputChannelLogger) { }

	async compile(uri: vscode.Uri, recipe: string): Promise<CompilationResult> {
		try {
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
			if (!workspaceFolder) {
				throw new Error('No workspace folder found');
			}

			this.logger.info(`Compiling with server-side compiler: ${recipe}`);

			// Check if we're in web context
			const isWeb = vscode.env.uiKind === vscode.UIKind.Web;

			// Try to use LaTeX Workshop extension if available
			const latexWorkshopExtension = vscode.extensions.getExtension('james-yu.latex-workshop');

			if (latexWorkshopExtension) {
				this.logger.info(`LaTeX Workshop extension found (version: ${latexWorkshopExtension.packageJSON.version})`);

				// Try to activate if not already active
				if (!latexWorkshopExtension.isActive) {
					this.logger.info('Activating LaTeX Workshop extension...');
					try {
						await latexWorkshopExtension.activate();
						this.logger.info('LaTeX Workshop extension activated');
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						this.logger.warn(`Failed to activate LaTeX Workshop: ${message}`);
					}
				}

				if (latexWorkshopExtension.isActive) {
					this.logger.info('Using LaTeX Workshop extension for compilation');
					return await this.compileWithLatexWorkshop(uri, recipe);
				} else {
					this.logger.warn('LaTeX Workshop extension is not active');
				}
			} else {
				if (isWeb) {
					this.logger.warn('LaTeX Workshop extension not found. Note: LaTeX Workshop is not a web extension and cannot run in browser context.');
				} else {
					this.logger.warn('LaTeX Workshop extension not found');
				}
			}

			// In web context, we can't use system commands or LaTeX Workshop (it's not a web extension)
			if (isWeb) {
				const errorMsg = 'LaTeX compilation not available in web context. ' +
					'LaTeX Workshop extension is not a web extension and cannot run in browser. ' +
					'Please use WASM compiler (set latex.compilation.mode to "wasm") or use Electron/desktop version.';
				this.logger.error(errorMsg);
				return {
					success: false,
					error: errorMsg
				};
			}

			// Fallback: Use system commands (Electron only)
			return await this.compileWithSystemCommand(uri, recipe);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.error(`Server compilation error: ${message}`);
			return {
				success: false,
				error: message
			};
		}
	}

	private async compileWithLatexWorkshop(uri: vscode.Uri, _recipe: string): Promise<CompilationResult> {
		try {
			// Check if the command exists
			const commands = await vscode.commands.getCommands();
			const hasBuildCommand = commands.includes('latex-workshop.build');

			if (!hasBuildCommand) {
				this.logger.warn('latex-workshop.build command not found');
				return {
					success: false,
					error: 'LaTeX Workshop build command not available. The extension may not be fully activated.'
				};
			}

			this.logger.info('Executing LaTeX Workshop build command...');
			// Execute LaTeX Workshop build command
			await vscode.commands.executeCommand('latex-workshop.build');
			this.logger.info('LaTeX Workshop build command executed');

			// Wait a bit for compilation to complete
			await new Promise<void>(resolve => {
				// Use a delay - in browser, we can use a simple promise delay
				const delay = (ms: number) => {
					if (typeof globalThis !== 'undefined') {
						const globalObj = globalThis as unknown as { setTimeout?: (fn: () => void, ms: number) => number };
						if (typeof globalObj.setTimeout === 'function') {
							globalObj.setTimeout(() => resolve(), ms);
							return;
						}
					}
					// Fallback: resolve immediately (compilation might be synchronous)
					resolve();
				};
				delay(2000);
			});

			// Check if PDF exists - construct PDF path from workspace and URI
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
			if (!workspaceFolder) {
				return {
					success: false,
					error: 'No workspace folder found'
				};
			}

			// Get base name from URI
			const uriPath = uri.path;
			const lastSlash = uriPath.lastIndexOf('/');
			const fileName = lastSlash >= 0 ? uriPath.substring(lastSlash + 1) : uriPath;
			const lastDot = fileName.lastIndexOf('.');
			const baseName = lastDot >= 0 ? fileName.substring(0, lastDot) : fileName;

			const pdfUri = vscode.Uri.joinPath(workspaceFolder.uri, baseName + '.pdf');

			try {
				await vscode.workspace.fs.stat(pdfUri);
				return {
					success: true,
					pdfPath: pdfUri.fsPath || pdfUri.toString()
				};
			} catch {
				return {
					success: false,
					error: 'PDF not generated'
				};
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.error(`LaTeX Workshop compilation failed: ${message}`);
			return {
				success: false,
				error: message
			};
		}
	}

	private async compileWithSystemCommand(_uri: vscode.Uri, _recipe: string): Promise<CompilationResult> {
		// This would require spawning a process, which is not available in browser context
		// For web, we should always use WASM or LaTeX Workshop extension
		// For Electron, we can spawn processes

		// This should not be reached in web context (handled in compile method)
		// For Electron, we could spawn latexmk/pdflatex/etc.
		// This is a placeholder for future implementation
		this.logger.warn('System command compilation not yet implemented');
		return {
			success: false,
			error: 'System command compilation not yet implemented. Please use LaTeX Workshop extension or WASM compiler.'
		};
	}

	dispose(): void {
		// Nothing to dispose
	}
}

