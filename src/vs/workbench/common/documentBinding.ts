/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextModel } from '../../editor/common/model.js';
import { Disposable } from '../../base/common/lifecycle.js';

/**
 * Binds a VS Code ITextModel to a Yjs Y.Text, enabling real-time collaboration
 * Uses any types for yjs to avoid import() type syntax bundler errors
 */
export class DocumentBinding extends Disposable {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private readonly ytext: any; // Y.Text
	private updating = false;
	private readonly documentName: string;

	constructor(
		private readonly textModel: ITextModel,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		private readonly ydoc: any // Y.Doc
	) {
		super();

		// Generate document name from URI
		this.documentName = textModel.uri.toString();

		// Get or create Y.Text for this document
		this.ytext = this.ydoc.getText(this.documentName);

		// Initialize Y.Text with current content if empty
		if (this.ytext.toString() === '' && textModel.getValue().length > 0) {
			this.ytext.insert(0, textModel.getValue());
		}

		this.setupListeners();
	}

	private setupListeners(): void {
		// Listen to VS Code ITextModel changes
		this._register(
			this.textModel.onDidChangeContent(event => {
				if (this.updating) {
					return;
				}

				this.updating = true;
				try {
					this.handleTextModelChange(event);
				} finally {
					this.updating = false;
				}
			})
		);

		// Listen to Yjs changes
		// eslint-disable-next-line
		const ytextObserver = (event: any) => {
			// YTextEvent
			if (this.updating) {
				return;
			}

			this.updating = true;
			try {
				this.handleYjsChange(event);
			} finally {
				this.updating = false;
			}
		};

		this.ytext.observe(ytextObserver);

		// Cleanup observer on dispose
		this._register({
			dispose: () => {
				this.ytext.unobserve(ytextObserver);
			},
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private handleTextModelChange(event: any): void {
		// VS Code's ITextModel change event has a different structure than the extension API
		// event.changes is an array of { range, rangeOffset, rangeLength, text }

		this.ydoc.transact(() => {
			// Process changes in reverse order to maintain correct offsets
			const changes = [...event.changes].reverse();

			for (const change of changes) {
				const offset = change.rangeOffset;
				const length = change.rangeLength;
				const text = change.text;

				// Delete old content
				if (length > 0) {
					this.ytext.delete(offset, length);
				}

				// Insert new content
				if (text.length > 0) {
					this.ytext.insert(offset, text);
				}
			}
		});
	}

	// eslint-disable-next-line
	private handleYjsChange(event: any): void {
		// YTextEvent
		// Apply Yjs changes to the text model
		// eslint-disable-next-line
		const edits: any[] = [];

		let index = 0;
		// eslint-disable-next-line
		event.delta.forEach((delta: any) => {
			if (delta.retain !== undefined) {
				index += delta.retain;
			} else if (delta.insert !== undefined) {
				const pos = this.textModel.getPositionAt(index);
				const text = typeof delta.insert === 'string' ? delta.insert : '';

				edits.push({
					range: {
						startLineNumber: pos.lineNumber,
						startColumn: pos.column,
						endLineNumber: pos.lineNumber,
						endColumn: pos.column,
					},
					text,
				});

				index += text.length;
			} else if (delta.delete !== undefined) {
				const pos = this.textModel.getPositionAt(index);
				const endPos = this.textModel.getPositionAt(index + delta.delete);

				edits.push({
					range: {
						startLineNumber: pos.lineNumber,
						startColumn: pos.column,
						endLineNumber: endPos.lineNumber,
						endColumn: endPos.column,
					},
					text: '',
				});
			}
		});

		if (edits.length > 0) {
			this.textModel.applyEdits(edits);
		}
	}

	/**
	 * Get the document name (URI string)
	 */
	public getDocumentName(): string {
		return this.documentName;
	}

	/**
	 * Get the underlying Y.Text
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public getYText(): any {
		// Y.Text
		return this.ytext;
	}

	override dispose(): void {
		super.dispose();
	}
}
