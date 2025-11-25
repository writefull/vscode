/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import {
	ICollaborationService,
	ICollaborationUser,
	CollaborationState,
	ICollaborationConfiguration,
} from '../../../common/collaboration.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';

// Runtime module references for yjs - loaded on demand via require()
// We use 'any' types to avoid import() type syntax which causes bundler errors
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Y: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Awareness: any;

function loadYjs() {
	if (!Y) {
		// Use require for Node.js modules in Electron
		// eslint-disable-next-line local/code-no-any-casts, @typescript-eslint/no-explicit-any
		Y = (globalThis as any).require('yjs');
	}
	if (!Awareness) {
		// eslint-disable-next-line local/code-no-any-casts, @typescript-eslint/no-explicit-any
		const protocolsModule = (globalThis as any).require('y-protocols/awareness');
		Awareness = protocolsModule.Awareness;
	}
	if (!Y || !Awareness) {
		throw new Error('Failed to load yjs modules');
	}
	return { Y, Awareness };
}

/**
 * Native VS Code implementation of the collaboration service
 */
export class CollaborationService extends Disposable implements ICollaborationService {
	declare readonly _serviceBrand: undefined;

	private _state: CollaborationState = CollaborationState.Disconnected;
	private _users: ICollaborationUser[] = [];
	private _currentUser: ICollaborationUser | undefined;

	private readonly _onDidChangeState = this._register(new Emitter<CollaborationState>());
	readonly onDidChangeState: Event<CollaborationState> = this._onDidChangeState.event;

	private readonly _onDidChangeUsers = this._register(new Emitter<ICollaborationUser[]>());
	readonly onDidChangeUsers: Event<ICollaborationUser[]> = this._onDidChangeUsers.event;

	private readonly _onDidChangeCursor = this._register(new Emitter<ICollaborationUser>());
	readonly onDidChangeCursor: Event<ICollaborationUser> = this._onDidChangeCursor.event;

	private ws: WebSocket | null = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private ydoc: any = null; // Y.Doc loaded at runtime
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private awareness: any = null; // Awareness loaded at runtime
	private reconnectAttempts = 0;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private reconnectTimeout: any;
	private yjsLoaded = false;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		// Auto-connect if configured
		const config = this.getConfiguration();
		if (config.enabled && config.autoConnect) {
			this.connect().catch(err => {
				this.logService.error('Failed to auto-connect to collaboration server:', err);
			});
		}

		// Listen to configuration changes
		this._register(
			this.configurationService.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('collaboration')) {
					this.handleConfigurationChange();
				}
			})
		);
	}

	get state(): CollaborationState {
		return this._state;
	}

	get users(): ReadonlyArray<ICollaborationUser> {
		return this._users;
	}

	get currentUser(): ICollaborationUser | undefined {
		return this._currentUser;
	}

	get isEnabled(): boolean {
		return this.getConfiguration().enabled;
	}

	async connect(): Promise<void> {
		if (this._state === CollaborationState.Connected || this._state === CollaborationState.Connecting) {
			this.logService.info('Already connected or connecting to collaboration server');
			return;
		}

		const config = this.getConfiguration();
		if (!config.enabled) {
			throw new Error('Collaboration is disabled in settings');
		}

		this.setState(CollaborationState.Connecting);

		// Load yjs if not already loaded
		if (!this.yjsLoaded) {
			try {
				this.logService.info('Loading yjs libraries...');
				const { Y: YModule, Awareness: AwarenessModule } = loadYjs();

				// Initialize yjs document and awareness
				this.ydoc = new YModule.Doc();
				this.awareness = new AwarenessModule(this.ydoc);

				// Setup awareness listener
				this.awareness.on('change', () => {
					this.updateUsers();
				});

				this.yjsLoaded = true;
				this.logService.info('Yjs libraries loaded successfully');
			} catch (error) {
				this.logService.error('Failed to load yjs libraries:', error);
				this.setState(CollaborationState.Error);
				throw new Error(`Failed to load collaboration libraries: ${error}`);
			}
		}

		return new Promise((resolve, reject) => {
			try {
				this.logService.info(`Connecting to collaboration server: ${config.serverUrl}`);

				// Create WebSocket connection
				this.ws = new WebSocket(config.serverUrl);
				this.ws.binaryType = 'arraybuffer';

				this.ws.onopen = () => {
					this.logService.info('Connected to collaboration server');
					this.setState(CollaborationState.Connected);
					this.reconnectAttempts = 0;

					// Set current user in awareness
					this._currentUser = {
						id: this.generateUserId(),
						name: config.userName || `User-${Math.floor(Math.random() * 10000)}`,
						color: this.generateColor(),
					};

					if (this.awareness) {
						this.awareness.setLocalStateField('user', this._currentUser);
						this.updateUsers();
					}

					resolve();
				};

				this.ws.onmessage = event => {
					this.handleMessage(event.data);
				};

				this.ws.onclose = () => {
					this.logService.info('Disconnected from collaboration server');
					this.handleDisconnect();
				};

				this.ws.onerror = error => {
					this.logService.error('WebSocket error:', error);
					this.setState(CollaborationState.Error);
					reject(error);
				};

				// Send yjs updates to server
				if (this.ydoc) {
					this.ydoc.on('update', (update: Uint8Array) => {
						if (this.ws && this.ws.readyState === WebSocket.OPEN) {
							this.ws.send(update);
						}
					});
				}
			} catch (error) {
				this.logService.error('Failed to connect:', error);
				this.setState(CollaborationState.Error);
				reject(error);
			}
		});
	}

	disconnect(): void {
		this.logService.info('Disconnecting from collaboration server');

		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = undefined;
		}

		// Close WebSocket
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}

		this._currentUser = undefined;
		this._users = [];
		this.setState(CollaborationState.Disconnected);
		this._onDidChangeUsers.fire([]);
	}

	isCollaborating(resourceUri: string): boolean {
		// Stub for now
		return false;
	}

	getUsersForDocument(resourceUri: string): ICollaborationUser[] {
		// In this simple implementation, return all connected users
		// In a more advanced version, track which users are viewing which documents
		return [...this._users];
	}

	private handleMessage(data: ArrayBuffer): void {
		if (!Y || !this.ydoc) {
			this.logService.warn('Received message but yjs is not loaded');
			return;
		}

		try {
			const message = new Uint8Array(data);
			Y.applyUpdate(this.ydoc, message);
		} catch (error) {
			this.logService.error('Error handling message:', error);
		}
	}

	private handleDisconnect(): void {
		this.setState(CollaborationState.Disconnected);

		const config = this.getConfiguration();
		if (this.reconnectAttempts < config.reconnectAttempts) {
			this.reconnectAttempts++;
			const delay = Math.min(config.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);

			this.logService.info(
				`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${config.reconnectAttempts})`
			);

			this.reconnectTimeout = setTimeout(() => {
				this.connect().catch(error => {
					this.logService.error('Reconnection failed:', error);
				});
			}, delay);
		} else {
			this.logService.error('Max reconnection attempts reached');
			this.setState(CollaborationState.Error);
		}
	}

	private updateUsers(): void {
		if (!this.awareness) {
			return;
		}

		const states = this.awareness.getStates();
		this._users = Array.from(states.values())
			.map((state: any) => state.user as ICollaborationUser) // eslint-disable-line @typescript-eslint/no-explicit-any
			.filter(user => user !== undefined);

		this._onDidChangeUsers.fire(this._users);
	}

	private setState(state: CollaborationState): void {
		if (this._state !== state) {
			this._state = state;
			this._onDidChangeState.fire(state);
		}
	}

	private getConfiguration(): ICollaborationConfiguration {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const config = this.configurationService.getValue<any>('collaboration') || {};

		return {
			enabled: config.enabled ?? true,
			serverUrl: config.serverUrl ?? 'ws://localhost:4003',
			userName: config.userName ?? '',
			autoConnect: config.autoConnect ?? true,
			reconnectAttempts: config.reconnectAttempts ?? 10,
			reconnectDelay: config.reconnectDelay ?? 1000,
		};
	}

	private handleConfigurationChange(): void {
		const config = this.getConfiguration();

		// If collaboration was disabled, disconnect
		if (!config.enabled && this._state !== CollaborationState.Disconnected) {
			this.disconnect();
		}
	}

	private generateUserId(): string {
		return `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	private generateColor(): string {
		const colors = [
			'#FF6B6B',
			'#4ECDC4',
			'#45B7D1',
			'#FFA07A',
			'#98D8C8',
			'#F7DC6F',
			'#BB8FCE',
			'#85C1E2',
			'#F8B739',
			'#52B788',
		];
		return colors[Math.floor(Math.random() * colors.length)];
	}

	override dispose(): void {
		this.disconnect();
		super.dispose();
	}
}
