/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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
	context.subscriptions.push(latexService);
	context.subscriptions.push(previewManager);

	// Diagnostics provider is initialized inside LatexService

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
	// Try to load data from latex-workshop extension if available, otherwise use local data
	const latexWorkshopPath = path.join(context.extensionPath, '..', '..', 'resources', 'extensions', 'latex-workshop', 'extension');
	const dataPath = fs.existsSync(latexWorkshopPath) ? latexWorkshopPath : context.extensionPath;
	const dataUri = vscode.Uri.file(dataPath);
	console.log('[Extension] Initializing completion with dataPath:', dataPath, 'uri:', dataUri.toString());
	// Initialize completers asynchronously
	initializeMacroCompleter(dataUri)
		.then(() => console.log('[Extension] Macro completer initialized successfully'))
		.catch(err => {
			console.error('[Extension] Failed to initialize macro completer:', err);
			logger.error(`Failed to initialize macro completer: ${err}`);
		});
	initializeEnvironmentCompleter(dataUri)
		.then(() => console.log('[Extension] Environment completer initialized successfully'))
		.catch(err => {
			console.error('[Extension] Failed to initialize environment completer:', err);
			logger.error(`Failed to initialize environment completer: ${err}`);
		});
	initializePackageCompleter(dataUri)
		.then(() => console.log('[Extension] Package completer initialized successfully'))
		.catch(err => {
			console.error('[Extension] Failed to initialize package completer:', err);
			logger.error(`Failed to initialize package completer: ${err}`);
		});

	// Register completion provider
	console.log('[Extension] Registering completion provider');
	const completionProvider = new LaTeXCompletionProvider();
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			latexSelector,
			completionProvider,
			'\\',
			'{'
		)
	);
	console.log('[Extension] Completion provider registered');

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

	logger.info('LaTeX Language Features extension activated');
}

export function deactivate(): void {
	latexService?.dispose();
	commandManager?.dispose();
}

