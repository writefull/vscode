/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ICommand } from './commandManager';
import { LatexService } from '../latexService';
import { OutputChannelLogger } from '../utils/logger';

export class BuildCommand implements ICommand {
	readonly id = 'latex.build';

	constructor(
		private readonly latexService: LatexService,
		private readonly logger: OutputChannelLogger
	) { }

	async execute(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('No active editor');
			return;
		}

		const document = editor.document;
		if (document.languageId !== 'latex' && document.languageId !== 'tex') {
			vscode.window.showWarningMessage('Active document is not a LaTeX file');
			return;
		}

		this.logger.show();
		this.logger.info(`Building LaTeX document: ${document.fileName}`);

		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Building LaTeX document...',
					cancellable: false
				},
				async () => {
					const result = await this.latexService.build(document.uri);
					if (result.success) {
						vscode.window.showInformationMessage('LaTeX compilation successful');
					} else {
						vscode.window.showErrorMessage(`LaTeX compilation failed: ${result.error || 'Unknown error'}`);
					}
				}
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.error(`Build failed: ${message}`);
			vscode.window.showErrorMessage(`LaTeX build failed: ${message}`);
		}
	}
}

