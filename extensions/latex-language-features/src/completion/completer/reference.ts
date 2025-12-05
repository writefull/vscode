/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CompletionArgs, CompleterProvider } from '../types';
import { get as getCache } from '../../outline/cache';

interface ReferenceData {
	suggestions: Map<string, vscode.CompletionItem>;
}

const data: ReferenceData = {
	suggestions: new Map()
};

export const provider: CompleterProvider = {
	from(_result: RegExpMatchArray, args: CompletionArgs): vscode.CompletionItem[] {
		return provide(args.uri, args.line, args.position);
	}
};

function provide(uri: vscode.Uri, _line: string, _position: vscode.Position): vscode.CompletionItem[] {
	updateAll(uri);
	const items: vscode.CompletionItem[] = [];
	for (const [, item] of data.suggestions.entries()) {
		items.push(item);
	}
	return items;
}

function updateAll(uri: vscode.Uri): void {
	data.suggestions.clear();

	// Get cache for current file
	const fileCache = getCache(uri.fsPath);
	if (!fileCache) {
		return;
	}

	// Extract labels from AST if available
	if (fileCache.ast) {
		extractLabelsFromAST(fileCache.ast, uri.fsPath);
	}

	// Also search in content for \label commands
	extractLabelsFromContent(fileCache.content, uri.fsPath);
}

function extractLabelsFromAST(ast: any, filePath: string): void {
	// Recursively search for label nodes in AST
	function searchLabels(node: any): void {
		if (!node || typeof node !== 'object') {
			return;
		}

		if (node.type === 'macro' && node.content === 'label') {
			// Found a \label command
			const labelArg = node.args?.[0];
			if (labelArg && labelArg.content) {
				const labelText = extractTextFromNode(labelArg.content);
				if (labelText) {
					addLabel(labelText, filePath);
				}
			}
		}

		// Recursively search in content
		if (Array.isArray(node.content)) {
			for (const child of node.content) {
				searchLabels(child);
			}
		}

		// Search in args
		if (Array.isArray(node.args)) {
			for (const arg of node.args) {
				searchLabels(arg);
			}
		}
	}

	if (ast.content) {
		for (const node of ast.content) {
			searchLabels(node);
		}
	}
}

function extractTextFromNode(content: any[]): string {
	if (!Array.isArray(content)) {
		return '';
	}

	return content
		.map(node => {
			if (typeof node === 'string') {
				return node;
			}
			if (node && typeof node === 'object') {
				if (node.type === 'string') {
					return node.content || '';
				}
				if (node.content && Array.isArray(node.content)) {
					return extractTextFromNode(node.content);
				}
			}
			return '';
		})
		.join('')
		.trim();
}

function extractLabelsFromContent(content: string, filePath: string): void {
	// Simple regex to find \label{...} commands
	const labelRegex = /\\label\s*\{([^}]+)\}/g;
	let match;
	while ((match = labelRegex.exec(content)) !== null) {
		const labelText = match[1].trim();
		if (labelText) {
			addLabel(labelText, filePath);
		}
	}
}

function addLabel(labelText: string, _filePath: string): void {
	if (data.suggestions.has(labelText)) {
		return; // Already added
	}

	const item = new vscode.CompletionItem(labelText, vscode.CompletionItemKind.Reference);
	item.detail = `Label: ${labelText}`;
	item.documentation = `Reference to label "${labelText}"`;
	item.insertText = labelText;
	item.sortText = labelText;

	data.suggestions.set(labelText, item);
}

export function getItem(token: string): vscode.CompletionItem | undefined {
	return data.suggestions.get(token);
}

export const reference = {
	getItem,
	provide
};

