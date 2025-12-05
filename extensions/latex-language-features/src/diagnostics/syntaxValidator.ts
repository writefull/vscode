/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface SyntaxDiagnostic {
	severity: vscode.DiagnosticSeverity;
	message: string;
	range: vscode.Range;
	source: string;
	code?: string | number;
}

/**
 * Validates LaTeX syntax and detects common errors without compilation
 */
export class LaTeXSyntaxValidator {
	/**
	 * Validate LaTeX document syntax
	 * @param document The LaTeX document to validate
	 * @returns Array of syntax diagnostics
	 */
	validate(document: vscode.TextDocument): SyntaxDiagnostic[] {
		const diagnostics: SyntaxDiagnostic[] = [];
		const text = document.getText();
		const lines = text.split(/\r?\n/);

		// Track environment nesting
		const environmentStack: Array<{ name: string; line: number }> = [];
		const beginRegex = /\\begin\{([^}]+)\}/g;
		const endRegex = /\\end\{([^}]+)\}/g;

		// Check for unmatched environments
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			let match: RegExpExecArray | null;

			// Find all \begin{...} in this line
			while ((match = beginRegex.exec(line)) !== null) {
				const envName = match[1];
				environmentStack.push({
					name: envName,
					line: i
				});
			}

			// Find all \end{...} in this line
			while ((match = endRegex.exec(line)) !== null) {
				const envName = match[1];
				if (environmentStack.length === 0) {
					// Extra \end without matching \begin
					const column = match.index;
					diagnostics.push({
						severity: vscode.DiagnosticSeverity.Error,
						message: `Extra \\end{${envName}} without matching \\begin`,
						range: new vscode.Range(i, column, i, column + match[0].length),
						source: 'LaTeX Syntax',
						code: 'extra-end'
					});
				} else {
					const lastEnv = environmentStack.pop()!;
					if (lastEnv.name !== envName) {
						// Mismatched environment
						diagnostics.push({
							severity: vscode.DiagnosticSeverity.Error,
							message: `Environment mismatch: \\begin{${lastEnv.name}} closed with \\end{${envName}}`,
							range: new vscode.Range(i, match.index, i, match.index + match[0].length),
							source: 'LaTeX Syntax',
							code: 'environment-mismatch'
						});
					}
				}
			}
		}

		// Check for unclosed environments
		for (const env of environmentStack) {
			diagnostics.push({
				severity: vscode.DiagnosticSeverity.Error,
				message: `Unclosed environment: \\begin{${env.name}} at line ${env.line + 1}`,
				range: new vscode.Range(env.line, 0, env.line, 100),
				source: 'LaTeX Syntax',
				code: 'unclosed-environment'
			});
		}

		// Check for unmatched braces
		this.checkUnmatchedBraces(document, diagnostics);

		// Check for unmatched math delimiters
		this.checkUnmatchedMathDelimiters(document, diagnostics);

		// Check for common LaTeX errors
		this.checkCommonErrors(document, diagnostics);

		return diagnostics;
	}

	private checkUnmatchedBraces(document: vscode.TextDocument, diagnostics: SyntaxDiagnostic[]): void {
		const text = document.getText();
		const braceStack: Array<{ char: string; pos: number; line: number; column: number }> = [];
		let inComment = false;
		let inString = false;

		for (let i = 0; i < text.length; i++) {
			const char = text[i];
			const prevChar = i > 0 ? text[i - 1] : '';
			const pos = document.positionAt(i);

			// Track comments
			if (char === '%' && prevChar !== '\\') {
				inComment = true;
			}
			if (char === '\n') {
				inComment = false;
			}
			if (inComment) {
				continue;
			}

			// Track strings (simple heuristic)
			if (char === '"' && prevChar !== '\\') {
				inString = !inString;
			}
			if (inString && char !== '"') {
				continue;
			}

			// Check for opening braces (but not escaped)
			if (char === '{' && prevChar !== '\\') {
				braceStack.push({ char: '{', pos: i, line: pos.line, column: pos.character });
			} else if (char === '}' && prevChar !== '\\') {
				if (braceStack.length === 0) {
					// Extra closing brace
					diagnostics.push({
						severity: vscode.DiagnosticSeverity.Warning,
						message: 'Extra closing brace }',
						range: new vscode.Range(pos.line, pos.character, pos.line, pos.character + 1),
						source: 'LaTeX Syntax',
						code: 'extra-brace'
					});
				} else {
					braceStack.pop();
				}
			}
		}

		// Check for unclosed braces
		for (const brace of braceStack) {
			diagnostics.push({
				severity: vscode.DiagnosticSeverity.Error,
				message: 'Unclosed opening brace {',
				range: new vscode.Range(brace.line, brace.column, brace.line, brace.column + 1),
				source: 'LaTeX Syntax',
				code: 'unclosed-brace'
			});
		}
	}

	private checkUnmatchedMathDelimiters(document: vscode.TextDocument, diagnostics: SyntaxDiagnostic[]): void {
		const text = document.getText();
		const dollarStack: Array<{ pos: number; line: number; column: number }> = [];
		let inComment = false;

		for (let i = 0; i < text.length; i++) {
			const char = text[i];
			const prevChar = i > 0 ? text[i - 1] : '';
			const pos = document.positionAt(i);

			// Track comments
			if (char === '%' && prevChar !== '\\') {
				inComment = true;
			}
			if (char === '\n') {
				inComment = false;
			}
			if (inComment) {
				continue;
			}

			// Check for $ (but not escaped or $$)
			if (char === '$' && prevChar !== '\\') {
				const nextChar = i < text.length - 1 ? text[i + 1] : '';
				if (nextChar === '$') {
					// Skip $$ (display math)
					i++;
					continue;
				}
				if (dollarStack.length > 0 && dollarStack[dollarStack.length - 1].pos === i - 1) {
					// This is closing the previous $
					dollarStack.pop();
				} else {
					dollarStack.push({ pos: i, line: pos.line, column: pos.character });
				}
			}
		}

		// Check for unmatched $
		if (dollarStack.length > 0) {
			for (const dollar of dollarStack) {
				diagnostics.push({
					severity: vscode.DiagnosticSeverity.Warning,
					message: 'Unmatched math delimiter $',
					range: new vscode.Range(dollar.line, dollar.column, dollar.line, dollar.column + 1),
					source: 'LaTeX Syntax',
					code: 'unmatched-dollar'
				});
			}
		}
	}

	private checkCommonErrors(document: vscode.TextDocument, diagnostics: SyntaxDiagnostic[]): void {
		const text = document.getText();
		const lines = text.split(/\r?\n/);

		// Check for common LaTeX errors
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Check for \begin{document} (should be present in most LaTeX files)
			if (i === 0 && !text.includes('\\begin{document}') && !text.includes('\\documentclass')) {
				// This is a warning, not an error, as some LaTeX files might not need it
				// Skip this check as it's too strict
			}

			// Check for common typos
			const typoPatterns = [
				{ pattern: /\\beging\{/, message: 'Typo: \\beging should be \\begin' },
				{ pattern: /\\end\{document\}/, message: 'Missing \\begin{document} before \\end{document}' }
			];

			for (const typo of typoPatterns) {
				const match = line.match(typo.pattern);
				if (match && match.index !== undefined) {
					diagnostics.push({
						severity: vscode.DiagnosticSeverity.Warning,
						message: typo.message,
						range: new vscode.Range(i, match.index, i, match.index + match[0].length),
						source: 'LaTeX Syntax',
						code: 'common-typo'
					});
				}
			}
		}
	}
}

