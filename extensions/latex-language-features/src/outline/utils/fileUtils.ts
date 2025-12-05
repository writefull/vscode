/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Resolve file path from multiple search directories
 * Ported from latex-workshop utils
 * Browser-compatible version using vscode.workspace.findFiles instead of glob
 */
export async function resolveFile(searchDirs: string[], fileName: string): Promise<string | undefined> {
	// Remove extension if present
	const nameWithoutExt = path.parse(fileName).name;
	const ext = path.extname(fileName) || '.tex';

	// Try with and without extension
	const candidates = [
		fileName,
		`${nameWithoutExt}${ext}`,
		`${nameWithoutExt}.tex`
	];

	for (const candidate of candidates) {
		// Try absolute path first
		if (path.isAbsolute(candidate)) {
			try {
				const uri = vscode.Uri.file(candidate);
				await vscode.workspace.fs.stat(uri);
				return candidate;
			} catch {
				// File doesn't exist
			}
		}

		// Try relative to search directories
		for (const dir of searchDirs) {
			const fullPath = path.join(dir, candidate);
			try {
				const uri = vscode.Uri.file(fullPath);
				await vscode.workspace.fs.stat(uri);
				return fullPath;
			} catch {
				// File doesn't exist, try searching with findFiles (browser-compatible)
				try {
					const baseName = path.basename(candidate);
					const pattern = new vscode.RelativePattern(dir, `**/${baseName}`);
					const matches = await vscode.workspace.findFiles(pattern, null, 1);
					if (matches.length > 0) {
						return matches[0].fsPath;
					}
				} catch {
					// Search failed
				}
			}
		}
	}

	return undefined;
}

/**
 * Sanitize input file path
 * Ported from latex-workshop inputfilepath
 */
export function sanitizeInputFilePath(filePath: string): string {
	// Remove quotes
	let sanitized = filePath.replace(/^["']|["']$/g, '');
	
	// Normalize path separators
	sanitized = sanitized.replace(/\\/g, '/');
	
	// Remove leading/trailing whitespace
	sanitized = sanitized.trim();
	
	return sanitized;
}

