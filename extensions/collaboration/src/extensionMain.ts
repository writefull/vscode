/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { Doc, Text as YText } from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

interface SessionState {
	connected: boolean;
	userName: string;
	color: string;
}

class CollaborationController {
	private doc: Doc | undefined;
	private awareness: Awareness | undefined;
	private ws: any | undefined; // ws.WebSocket instance
	private bindings = new Map<string, YText>(); // documentUri -> YText
	private statusItem: vscode.StatusBarItem;
	private reconnectAttempts = 0;

	constructor(private readonly ctx: vscode.ExtensionContext) {
		this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
		this.statusItem.name = 'Collaboration Status';
		this.statusItem.command = 'collaboration.connect';
		this.statusItem.show();
		this.updateStatus('Disconnected');
	}

	async connect(): Promise<void> {
		const cfg = vscode.workspace.getConfiguration('collaboration');
		if (!cfg.get<boolean>('enabled')) {
			return;
		}
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			return; // already connected
		}
		const serverUrl = cfg.get<string>('serverUrl')!;
		this.updateStatus('Connecting...');
		try {
			const yjs = await import('yjs');
			const { Awareness } = await import('y-protocols/awareness');
			this.doc = new yjs.Doc();
			this.awareness = new Awareness(this.doc);
			// Use 'ws' package for WebSocket in Node extension host
			const { WebSocket } = await import('ws');
			this.ws = new WebSocket(serverUrl);
			this.ws.on('open', () => {
				this.reconnectAttempts = 0;
				this.updateStatus('Connected');
				const name = cfg.get<string>('userName') || this.generateUserName();
				const color = this.pickColor(name);
				this.awareness?.setLocalStateField('user', { name, color });
			});
			this.ws.on('message', (data: any) => this.applyRemoteUpdate(data));
			this.ws.on('close', () => this.handleDisconnect());
			this.ws.on('error', (err: any) => {
				this.updateStatus('Error');
				console.error('[collaboration] websocket error', err);
			});
			this.doc.on('update', (u: Uint8Array) => {
				if (this.ws && this.ws.readyState === 1 /* OPEN */) {
					this.ws.send(u);
				}
			});
			// bind already opened editors
			for (const doc of vscode.workspace.textDocuments) {
				this.ensureBinding(doc);
			}
			this.ctx.subscriptions.push(
				vscode.workspace.onDidOpenTextDocument((d: vscode.TextDocument) => this.ensureBinding(d)),
				vscode.workspace.onDidCloseTextDocument((d: vscode.TextDocument) => this.releaseBinding(d)),
				vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) =>
					this.propagateLocalEdits(e)
				)
			);
		} catch (err) {
			this.updateStatus('Error');
			console.error('[collaboration] connect failed', err);
		}
	}

	disconnect(): void {
		console.log('[collaboration] Manually disconnecting');
		this.reconnectAttempts = 999; // Prevent auto-reconnect after manual disconnect
		if (this.ws) {
			this.ws.close();
			this.ws = undefined;
		}
		this.bindings.clear();
		this.doc?.destroy();
		this.doc = undefined;
		this.awareness = undefined;
		this.updateStatus('Disconnected');
	}

	private ensureBinding(doc: vscode.TextDocument): void {
		if (!this.doc || doc.isUntitled || doc.languageId === 'Log') {
			return;
		}
		const key = doc.uri.toString();
		if (this.bindings.has(key)) {
			return;
		}
		// Y.Doc#getText always returns existing or creates new YText
		const yText = this.doc.getText(key) as YText;
		if (yText.length === 0) {
			yText.insert(0, doc.getText());
		}
		this.bindings.set(key, yText);
	}

	private releaseBinding(doc: vscode.TextDocument): void {
		const key = doc.uri.toString();
		this.bindings.delete(key);
	}

	private propagateLocalEdits(e: vscode.TextDocumentChangeEvent): void {
		if (!this.doc) {
			return;
		}
		const key = e.document.uri.toString();
		const yText = this.bindings.get(key);
		if (!yText) {
			return;
		}
		// Apply changes sequentially (simple approach - could batch)
		for (const change of e.contentChanges) {
			const start = e.document.offsetAt(change.range.start);
			const end = e.document.offsetAt(change.range.end);
			if (end > start) {
				yText.delete(start, end - start);
			}
			if (change.text.length) {
				yText.insert(start, change.text);
			}
		}
	}

	private applyRemoteUpdate(data: any): void {
		if (!this.doc) {
			return;
		}
		try {
			const yjs = this.YModuleSync();
			let update: Uint8Array;
			if (typeof data === 'string') {
				update = Uint8Array.from(Buffer.from(data));
			} else if (data instanceof ArrayBuffer) {
				update = new Uint8Array(data);
			} else if (Buffer.isBuffer(data)) {
				update = new Uint8Array(data);
			} else {
				console.warn('[collaboration] unknown message type');
				return;
			}
			yjs.applyUpdate(this.doc, update);
			for (const [key, yText] of this.bindings) {
				const openDoc = vscode.workspace.textDocuments.find(
					(d: vscode.TextDocument) => d.uri.toString() === key
				);
				if (!openDoc) {
					continue;
				}
				const newContent = yText.toString();
				if (openDoc.getText() !== newContent) {
					const fullRange = new vscode.Range(
						openDoc.positionAt(0),
						openDoc.positionAt(openDoc.getText().length)
					);
					const edit = new vscode.WorkspaceEdit();
					edit.replace(openDoc.uri, fullRange, newContent);
					vscode.workspace.applyEdit(edit);
				}
			}
		} catch (err) {
			console.error('[collaboration] failed remote update', err);
		}
	}

	private YModuleSync(): typeof import('yjs') {
		return require('yjs');
	}

	private handleDisconnect(): void {
		const cfg = vscode.workspace.getConfiguration('collaboration');
		const maxAttempts = 5;

		if (this.reconnectAttempts < maxAttempts && cfg.get<boolean>('autoConnect')) {
			const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // cap at 30s
			this.updateStatus(`Reconnecting (${this.reconnectAttempts + 1}/${maxAttempts})...`);
			this.reconnectAttempts++;
			setTimeout(() => this.connect(), delay);
		} else {
			this.updateStatus('Disconnected (max retries)');
			if (this.reconnectAttempts >= maxAttempts) {
				console.log(
					`[collaboration] Stopped auto-reconnect after ${maxAttempts} attempts. Run "Collaboration: Connect" to retry.`
				);
			}
		}
	}

	private updateStatus(text: string): void {
		this.statusItem.text = `$(globe) ${text}`;
	}

	private generateUserName(): string {
		return 'User-' + Math.floor(Math.random() * 10000);
	}

	private pickColor(seed: string): string {
		const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8'];
		let h = 0;
		for (const c of seed) {
			h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
		}
		return colors[Math.abs(h) % colors.length];
	}
}

export async function activate(context: vscode.ExtensionContext) {
	const ctrl = new CollaborationController(context);
	context.subscriptions.push(
		vscode.commands.registerCommand('collaboration.connect', () => ctrl.connect()),
		vscode.commands.registerCommand('collaboration.disconnect', () => ctrl.disconnect())
	);
	if (vscode.workspace.getConfiguration('collaboration').get<boolean>('autoConnect')) {
		ctrl.connect();
	}
}

export function deactivate() {
	// resources cleaned via controller dispose if needed in future
}
