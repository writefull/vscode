/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { OutputChannelLogger } from './utils/logger';
import { WasmLatexCompiler } from './compilers/wasmCompiler';
import { ServerLatexCompiler } from './compilers/serverCompiler';
import { PreviewManager } from './preview/previewManager';
import { LaTeXDiagnosticsProvider } from './diagnostics/diagnosticsProvider';

export interface CompilationResult {
	success: boolean;
	error?: string;
	pdfPath?: string;
	logPath?: string;
	logContent?: string; // Add log content for diagnostics
}

export class LatexService implements vscode.Disposable {
	private wasmCompiler: WasmLatexCompiler;
	private serverCompiler: ServerLatexCompiler;
	private previewManager: PreviewManager | undefined;
	private diagnosticsProvider: LaTeXDiagnosticsProvider | undefined;
	private disposables: vscode.Disposable[] = [];
	constructor(
		private readonly logger: OutputChannelLogger,
		context?: vscode.ExtensionContext
	) {
		this.wasmCompiler = new WasmLatexCompiler(logger, context);
		this.serverCompiler = new ServerLatexCompiler(logger);
		if (context) {
			this.diagnosticsProvider = new LaTeXDiagnosticsProvider(logger, context);
			this.disposables.push(this.diagnosticsProvider);
		}
	}

	setContext(context: vscode.ExtensionContext): void {
		// Recreate compiler with context
		this.wasmCompiler.dispose();
		this.wasmCompiler = new WasmLatexCompiler(this.logger, context);
	}

	setPreviewManager(previewManager: PreviewManager): void {
		this.previewManager = previewManager;
	}

	setDiagnosticsProvider(diagnosticsProvider: LaTeXDiagnosticsProvider): void {
		this.diagnosticsProvider = diagnosticsProvider;
	}

	async build(uri: vscode.Uri): Promise<CompilationResult> {
		const config = vscode.workspace.getConfiguration('latex');
		const mode = config.get<string>('compilation.mode', 'auto');
		const recipe = config.get<string>('compilation.recipe', 'latexmk');

		this.logger.info(`Building with recipe: ${recipe}`);
		this.logger.info(`Compilation mode: ${mode}`);

		// Determine compilation strategy
		let result: CompilationResult;
		if (mode === 'wasm') {
			result = await this.buildWithWasm(uri, recipe);
		} else if (mode === 'server') {
			result = await this.buildWithServer(uri, recipe);
		} else {
			// Auto mode: try WASM first, fallback to server
			this.logger.info('Attempting WASM compilation...');
			const wasmResult = await this.buildWithWasm(uri, recipe);
			if (wasmResult.success) {
				result = wasmResult;
			} else {
				this.logger.warn(`WASM compilation failed: ${wasmResult.error || 'Unknown error'}`);
				this.logger.info('Falling back to server-side compilation...');
				const serverResult = await this.buildWithServer(uri, recipe);

				// Provide helpful error message if both fail
				if (!serverResult.success) {
					const isWeb = vscode.env.uiKind === vscode.UIKind.Web;
					if (isWeb) {
						// In web context, provide a clear error message
						const combinedError = `Both WASM and server compilation failed.\n` +
							`WASM error: ${wasmResult.error || 'Unknown error'}\n` +
							`Server error: ${serverResult.error || 'Unknown error'}\n\n` +
							`In web context, only WASM compilation is supported. ` +
							`Please check:\n` +
							`1. SwiftLaTeX files are in vendors/swiftlatex/ directory\n` +
							`2. Extension context is available (webview support)\n` +
							`3. Check "LaTeX" output channel for detailed error messages`;

						this.logger.error(combinedError);

						result = {
							success: false,
							error: `LaTeX compilation failed in web context. WASM compiler error: ${wasmResult.error || 'Unknown'}. ` +
								`Please check the "LaTeX" output channel for details. ` +
								`Ensure SwiftLaTeX files are downloaded (see SETUP_SWIFTLATEX.md).`
						};
					} else {
						result = serverResult;
					}
				} else {
					result = serverResult;
				}
			}
		}

		// Update diagnostics from compilation log if available
		// Read log file directly (like latex-workshop does)
		if (this.diagnosticsProvider && result.logContent) {
			try {
				const document = await vscode.workspace.openTextDocument(uri);
				this.diagnosticsProvider.updateFromLog(document, result.logContent);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.logger.warn(`Failed to update diagnostics from log: ${message}`);
			}
		} else if (this.diagnosticsProvider && mode !== 'wasm') {
			// Try to read log file directly for server compilation
			try {
				const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
				if (workspaceFolder) {
					const uriPath = uri.path;
					const lastSlash = uriPath.lastIndexOf('/');
					const fileName = lastSlash >= 0 ? uriPath.substring(lastSlash + 1) : uriPath;
					const lastDot = fileName.lastIndexOf('.');
					const baseName = lastDot >= 0 ? fileName.substring(0, lastDot) : fileName;
					const logUri = vscode.Uri.joinPath(workspaceFolder.uri, baseName + '.log');

					try {
						const logBytes = await vscode.workspace.fs.readFile(logUri);
						const logContent = new TextDecoder('utf-8').decode(logBytes);
						const document = await vscode.workspace.openTextDocument(uri);
						this.diagnosticsProvider.updateFromLog(document, logContent);
					} catch {
						// Log file might not exist, which is okay
					}
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.logger.warn(`Failed to read log file for diagnostics: ${message}`);
			}
		}

		return result;
	}

	private async buildWithWasm(uri: vscode.Uri, recipe: string): Promise<CompilationResult> {
		try {
			return await this.wasmCompiler.compile(uri, recipe);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.error(`WASM compilation error: ${message}`);
			return {
				success: false,
				error: `WASM compilation failed: ${message}`
			};
		}
	}

	private async buildWithServer(uri: vscode.Uri, recipe: string): Promise<CompilationResult> {
		try {
			return await this.serverCompiler.compile(uri, recipe);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.error(`Server compilation error: ${message}`);
			return {
				success: false,
				error: `Server compilation failed: ${message}`
			};
		}
	}

	async preview(uri: vscode.Uri): Promise<void> {
		const config = vscode.workspace.getConfiguration('latex');
		const viewer = config.get<string>('preview.viewer', 'tab');

		// First ensure the document is built
		const buildResult = await this.build(uri);
		if (!buildResult.success || !buildResult.pdfPath) {
			throw new Error('Cannot preview: compilation failed or no PDF generated');
		}

		if (viewer === 'tab') {
			if (!this.previewManager) {
				throw new Error('Preview manager not initialized');
			}
			await this.previewManager.showPreview(uri, buildResult.pdfPath!);
		} else {
			// External viewer
			const pdfUri = typeof buildResult.pdfPath === 'string'
				? vscode.Uri.file(buildResult.pdfPath)
				: vscode.Uri.parse(buildResult.pdfPath);
			await vscode.commands.executeCommand('vscode.open', pdfUri);
		}
	}

	async clean(uri: vscode.Uri): Promise<void> {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		if (!workspaceFolder) {
			throw new Error('No workspace folder found');
		}

		// Get base name and directory from URI
		const uriPath = uri.path;
		const lastSlash = uriPath.lastIndexOf('/');
		const dirPath = lastSlash >= 0 ? uriPath.substring(0, lastSlash) : '';
		const fileName = lastSlash >= 0 ? uriPath.substring(lastSlash + 1) : uriPath;
		const lastDot = fileName.lastIndexOf('.');
		const baseName = lastDot >= 0 ? fileName.substring(0, lastDot) : fileName;

		// LaTeX auxiliary files to clean
		const extensions = [
			'.aux', '.log', '.out', '.toc', '.lof', '.lot',
			'.fls', '.fdb_latexmk', '.synctex.gz', '.bbl', '.blg',
			'.nav', '.snm', '.vrb', '.bcf', '.run.xml'
		];

		let cleanedCount = 0;
		for (const ext of extensions) {
			const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, dirPath, baseName + ext);
			try {
				await vscode.workspace.fs.delete(fileUri, { useTrash: false });
				cleanedCount++;
				this.logger.info(`Deleted: ${baseName}${ext}`);
			} catch (error) {
				// File might not exist, which is fine
				const errorObj = error as { code?: string };
				if (errorObj.code !== 'FileNotFound') {
					this.logger.warn(`Failed to delete ${baseName}${ext}: ${error}`);
				}
			}
		}

		// Clean PDF if it exists
		const pdfUri = vscode.Uri.joinPath(workspaceFolder.uri, dirPath, baseName + '.pdf');
		try {
			await vscode.workspace.fs.delete(pdfUri, { useTrash: false });
			cleanedCount++;
			this.logger.info(`Deleted: ${baseName}.pdf`);
		} catch (error) {
			const errorObj = error as { code?: string };
			if (errorObj.code !== 'FileNotFound') {
				this.logger.warn(`Failed to delete ${baseName}.pdf: ${error}`);
			}
		}

		this.logger.info(`Cleaned ${cleanedCount} file(s)`);
	}

	async syncFromSource(uri: vscode.Uri, position: vscode.Position): Promise<void> {
		// SyncTeX: Sync from source to PDF
		// This would require SyncTeX file parsing
		// For now, just open the preview
		await this.preview(uri);
		this.logger.info(`SyncTeX: Syncing from source position ${position.line}:${position.character}`);
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.wasmCompiler.dispose();
		this.serverCompiler.dispose();
		this.previewManager?.dispose();
		this.diagnosticsProvider?.dispose();
	}
}

