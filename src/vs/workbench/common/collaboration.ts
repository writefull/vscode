/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { Event } from '../../base/common/event.js';

export const ICollaborationService = createDecorator<ICollaborationService>('collaborationService');

export interface ICollaborationUser {
	readonly id: string;
	readonly name: string;
	readonly color: string;
	readonly cursor?: {
		readonly line: number;
		readonly column: number;
	};
}

export enum CollaborationState {
	Disconnected = 'disconnected',
	Connecting = 'connecting',
	Connected = 'connected',
	Error = 'error',
}

export interface ICollaborationService {
	readonly _serviceBrand: undefined;

	/**
	 * Current connection state
	 */
	readonly state: CollaborationState;

	/**
	 * Event fired when connection state changes
	 */
	readonly onDidChangeState: Event<CollaborationState>;

	/**
	 * Event fired when users join or leave
	 */
	readonly onDidChangeUsers: Event<ICollaborationUser[]>;

	/**
	 * Event fired when a remote user's cursor position changes
	 */
	readonly onDidChangeCursor: Event<ICollaborationUser>;

	/**
	 * Currently connected users (including self)
	 */
	readonly users: ReadonlyArray<ICollaborationUser>;

	/**
	 * Current user information
	 */
	readonly currentUser: ICollaborationUser | undefined;

	/**
	 * Whether collaboration is enabled
	 */
	readonly isEnabled: boolean;

	/**
	 * Connect to the collaboration server
	 */
	connect(): Promise<void>;

	/**
	 * Disconnect from the collaboration server
	 */
	disconnect(): void;

	/**
	 * Check if a document is currently being collaborated on
	 */
	isCollaborating(resourceUri: string): boolean;

	/**
	 * Get users currently editing a specific document
	 */
	getUsersForDocument(resourceUri: string): ICollaborationUser[];
}

/**
 * Configuration for collaboration service
 */
export interface ICollaborationConfiguration {
	readonly enabled: boolean;
	readonly serverUrl: string;
	readonly userName: string;
	readonly autoConnect: boolean;
	readonly reconnectAttempts: number;
	readonly reconnectDelay: number;
}
