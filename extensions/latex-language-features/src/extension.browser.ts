/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { LatexService } from './latexService';
import { CommandManager } from './commands/commandManager';
import { BuildCommand } from './commands/buildCommand';
import { PreviewCommand } from './commands/previewCommand';
import { CleanCommand } from './commands/cleanCommand';
import { SyncCommand } from './commands/syncCommand';
import { OutputChannelLogger } from './utils/logger';
import { PreviewManager } from './preview/previewManager';
import { LaTeXDocumentSymbolProvider } from './outline/documentSymbolProvider';
import { LaTeXCompletionProvider } from './completion/completionProvider';
import { initializeMacroCompleter } from './completion/completer/macro';
import { initializeEnvironmentCompleter } from './completion/completer/environment';
import { initializePackageCompleter } from './completion/completer/package';

let latexService: LatexService | undefined;
let commandManager: CommandManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const logger = new OutputChannelLogger('LaTeX');
	context.subscriptions.push(logger);

	// Initialize LaTeX service
	latexService = new LatexService(logger, context);
	const previewManager = new PreviewManager(context, logger);
	latexService.setPreviewManager(previewManager);
	context.subscriptions.push(latexService, previewManager);

	// Initialize command manager
	commandManager = new CommandManager();
	context.subscriptions.push(commandManager);

	// Register commands
	commandManager.register(new BuildCommand(latexService, logger));
	commandManager.register(new PreviewCommand(latexService, logger));
	commandManager.register(new CleanCommand(latexService, logger));
	commandManager.register(new SyncCommand(latexService, logger));

	// Register document symbol provider for outline
	const latexSelector: vscode.DocumentSelector = [
		{ language: 'latex', scheme: 'file' },
		{ language: 'latex', scheme: 'untitled' },
		{ language: 'tex', scheme: 'file' },
		{ language: 'tex', scheme: 'untitled' }
	];
	const documentSymbolProvider = new LaTeXDocumentSymbolProvider(logger);
	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(latexSelector, documentSymbolProvider)
	);

	// Initialize completion
	// In browser, we need to wait for data to load before registering the provider
	console.log('[Extension Browser] ===== STARTING COMPLETION INITIALIZATION =====');
	console.log('[Extension Browser] Initializing completion with extensionUri:', context.extensionUri.toString());
	console.log('[Extension Browser] Extension path:', context.extensionPath);

	// Try to find latex-workshop data
	// In web, we need to check if we can access the latex-workshop extension
	const finalDataUri = context.extensionUri;
	console.log('[Extension Browser] Using data URI:', finalDataUri.toString());
	console.log('[Extension Browser] Data URI scheme:', finalDataUri.scheme);
	console.log('[Extension Browser] Data URI path:', finalDataUri.path);

	// Initialize completers and wait for them to complete before registering provider
	console.log('[Extension Browser] Initializing completers...');
	try {
		await Promise.all([
			initializeMacroCompleter(finalDataUri)
				.then(() => {
					console.log('[Extension Browser] ✓ Macro completer initialized successfully');
				})
				.catch(err => {
					console.error('[Extension Browser] X Failed to initialize macro completer:', err);
					if (err instanceof Error) {
						console.error('[Extension Browser] Error stack:', err.stack);
					}
					logger.error(`Failed to initialize macro completer: ${err}`);
				}),
			initializeEnvironmentCompleter(finalDataUri)
				.then(() => {
					console.log('[Extension Browser] ✓ Environment completer initialized successfully');
				})
				.catch(err => {
					console.error('[Extension Browser] X Failed to initialize environment completer:', err);
					if (err instanceof Error) {
						console.error('[Extension Browser] Error stack:', err.stack);
					}
					logger.error(`Failed to initialize environment completer: ${err}`);
				}),
			initializePackageCompleter(finalDataUri)
				.then(() => {
					console.log('[Extension Browser] ✓ Package completer initialized successfully');
				})
				.catch(err => {
					console.error('[Extension Browser] X Failed to initialize package completer:', err);
					if (err instanceof Error) {
						console.error('[Extension Browser] Error stack:', err.stack);
					}
					logger.error(`Failed to initialize package completer: ${err}`);
				})
		]);
		console.log('[Extension Browser] ===== ALL COMPLETERS INITIALIZED =====');
	} catch (error) {
		console.error('[Extension Browser] ===== ERROR DURING INITIALIZATION =====');
		console.error('[Extension Browser] Error:', error);
		if (error instanceof Error) {
			console.error('[Extension Browser] Error stack:', error.stack);
		}
	}

	// Register completion provider AFTER data is loaded
	console.log('[Extension Browser] Registering completion provider');
	const completionProvider = new LaTeXCompletionProvider();
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			latexSelector,
			completionProvider,
			'\\',
			'{'
		)
	);
	console.log('[Extension Browser] Completion provider registered');

	// Register file watchers for auto-build
	const config = vscode.workspace.getConfiguration('latex');
	const autoBuild = config.get<string>('compilation.autoBuild', 'onSave');

	if (autoBuild !== 'never') {
		const watcher = vscode.workspace.createFileSystemWatcher('**/*.tex');
		context.subscriptions.push(watcher);

		if (autoBuild === 'onSave') {
			context.subscriptions.push(
				vscode.workspace.onDidSaveTextDocument(async (document) => {
					if (document.languageId === 'latex' || document.languageId === 'tex') {
						await latexService?.build(document.uri);
					}
				})
			);
		} else if (autoBuild === 'onFileChange') {
			watcher.onDidChange(async (uri) => {
				if (uri.fsPath.endsWith('.tex')) {
					await latexService?.build(uri);
				}
			});
		}
	}

	logger.info('LaTeX Language Features extension activated (browser)');
}

export function deactivate(): void {
	latexService?.dispose();
	commandManager?.dispose();
}

