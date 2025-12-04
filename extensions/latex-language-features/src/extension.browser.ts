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

