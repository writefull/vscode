/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CompletionArgs, CompleterProvider } from '../types';
import { FileSystemUtils } from '../utils/fileUtils';

interface PackageData {
	loaded: string[];
	suggestions: vscode.CompletionItem[];
}

const data: PackageData = {
	loaded: [],
	suggestions: []
};

let extensionRoot: vscode.Uri | undefined;

export async function initializePackageCompleter(root: string | vscode.Uri): Promise<void> {
	if (typeof root === 'string') {
		extensionRoot = vscode.Uri.file(root);
	} else {
		extensionRoot = root;
	}
	await loadDefaultPackages();
}

async function loadDefaultPackages(): Promise<void> {
	if (!extensionRoot) {
		return;
	}

	try {
		// Try multiple possible paths for data files
		const isBrowser = extensionRoot.scheme !== 'file';
		const possiblePaths = isBrowser
			? [
				['dist', 'browser', 'data', 'packagenames.json'],
				['data', 'packagenames.json']
			]
			: [
				['data', 'packagenames.json'],
				['extension', 'data', 'packagenames.json'],
				['out', 'data', 'packagenames.json']
			];

		let packagesUri: vscode.Uri | undefined;
		for (const pathParts of possiblePaths) {
			const testUri = FileSystemUtils.joinUri(extensionRoot, ...pathParts);
			console.log('[Package Completer] Trying packagenames path:', testUri.toString());
			if (await FileSystemUtils.exists(testUri)) {
				packagesUri = testUri;
				console.log('[Package Completer] Found packagenames at:', testUri.toString());
				break;
			}
		}

		if (packagesUri) {
			const content = await FileSystemUtils.readFile(packagesUri);
			const packages = JSON.parse(content);
			data.suggestions = packages.map((pkg: string) => {
				const item = new vscode.CompletionItem(pkg, vscode.CompletionItemKind.Module);
				item.detail = `LaTeX package: ${pkg}`;
				item.documentation = `Package ${pkg}`;
				item.insertText = pkg;
				return item;
			});
		} else {
			console.warn('[Package Completer] Could not find packagenames.json in any expected location');
		}
	} catch (error) {
		console.error('[Package Completer] Error loading package data:', error);
		if (error instanceof Error) {
			console.error('[Package Completer] Error message:', error.message);
			console.error('[Package Completer] Error stack:', error.stack);
		}
	}
}

export const provider: CompleterProvider = {
	from(_result: RegExpMatchArray, _args: CompletionArgs): vscode.CompletionItem[] {
		return provide();
	}
};

function provide(): vscode.CompletionItem[] {
	return data.suggestions;
}

export function load(packageName: string): void {
	if (data.loaded.includes(packageName)) {
		return;
	}
	data.loaded.push(packageName);
	// TODO: Load package-specific commands and environments
	// This would require loading from data/packages/{packageName}.json
}

export function getAll(_langId: string): Record<string, string[]> {
	// Return packages used in the document
	// This is a simplified version - full implementation would parse \usepackage commands
	return {};
}

export const usepackage = {
	load,
	getAll,
	provide
};

