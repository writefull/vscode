/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-no-unexternalized-strings */

import { Disposable } from "../../../../base/common/lifecycle.js";
import {
	IWorkbenchContribution,
	IWorkbenchContributionsRegistry,
	Extensions as WorkbenchExtensions,
} from "../../../common/contributions.js";
import { Registry } from "../../../../platform/registry/common/platform.js";
import {
	IConfigurationRegistry,
	Extensions as ConfigurationExtensions,
} from "../../../../platform/configuration/common/configurationRegistry.js";
import { localize, localize2 } from "../../../../nls.js";
import {
	Action2,
	registerAction2,
} from "../../../../platform/actions/common/actions.js";
import { ServicesAccessor } from "../../../../platform/instantiation/common/instantiation.js";
import { INotificationService } from "../../../../platform/notification/common/notification.js";
import {
	IStatusbarService,
	StatusbarAlignment,
} from "../../../services/statusbar/browser/statusbar.js";
import { LifecyclePhase } from "../../../services/lifecycle/common/lifecycle.js";
import {
	ThemeColor,
	themeColorFromId,
} from "../../../../base/common/themables.js";
import {
	CollaborationState,
	ICollaborationService,
	ICollaborationUser,
} from "../../../common/collaboration.js";

// ==================== Configuration ====================
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	ConfigurationExtensions.Configuration,
);
configurationRegistry.registerConfiguration({
	id: "collaboration",
	order: 100,
	title: localize("collaborationConfigurationTitle", "Collaboration"),
	type: "object",
	properties: {
		"collaboration.enabled": {
			type: "boolean",
			default: true,
			description: localize(
				"collaboration.enabled",
				"Enable real-time collaborative editing features.",
			),
		},
		"collaboration.serverUrl": {
			type: "string",
			default: "ws://localhost:1234",
			description: localize(
				"collaboration.serverUrl",
				"WebSocket URL of the collaboration server.",
			),
		},
		"collaboration.userName": {
			type: "string",
			default: "",
			description: localize(
				"collaboration.userName",
				"Your display name for collaboration sessions. If empty, a random name will be generated.",
			),
		},
		"collaboration.autoConnect": {
			type: "boolean",
			default: true,
			description: localize(
				"collaboration.autoConnect",
				"Automatically connect to the collaboration server on startup.",
			),
		},
		"collaboration.reconnectAttempts": {
			type: "number",
			default: 10,
			minimum: 0,
			maximum: 100,
			description: localize(
				"collaboration.reconnectAttempts",
				"Number of times to attempt reconnection after disconnection.",
			),
		},
		"collaboration.reconnectDelay": {
			type: "number",
			default: 1000,
			minimum: 100,
			maximum: 30000,
			description: localize(
				"collaboration.reconnectDelay",
				"Initial delay (in milliseconds) between reconnection attempts.",
			),
		},
	},
});

// ==================== Actions ====================

class ConnectToCollaborationServerAction extends Action2 {
	constructor() {
		super({
			id: "workbench.action.collaboration.connect",
			title: localize2(
				"connectToCollaborationServer",
				"Collaboration: Connect to Server",
			),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const collaborationService = accessor.get(ICollaborationService);
		const notificationService = accessor.get(INotificationService);

		if (collaborationService.state === CollaborationState.Connected) {
			notificationService.info(
				localize(
					"alreadyConnected",
					"Already connected to collaboration server",
				),
			);
			return;
		}

		try {
			await collaborationService.connect();
			const userName = collaborationService.currentUser?.name || "Unknown";
			notificationService.info(
				localize(
					"connected",
					"Connected to collaboration server as {0}",
					userName,
				),
			);
		} catch (error) {
			notificationService.error(
				localize(
					"connectionFailed",
					"Failed to connect to collaboration server: {0}",
					String(error),
				),
			);
		}
	}
}

class DisconnectFromCollaborationServerAction extends Action2 {
	constructor() {
		super({
			id: "workbench.action.collaboration.disconnect",
			title: localize2(
				"disconnectFromCollaborationServer",
				"Collaboration: Disconnect",
			),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const collaborationService = accessor.get(ICollaborationService);
		const notificationService = accessor.get(INotificationService);

		if (collaborationService.state === CollaborationState.Disconnected) {
			notificationService.info(
				localize(
					"alreadyDisconnected",
					"Not connected to collaboration server",
				),
			);
			return;
		}

		collaborationService.disconnect();
		notificationService.info(
			localize("disconnected", "Disconnected from collaboration server"),
		);
	}
}

class ShowCollaborationStatusAction extends Action2 {
	constructor() {
		super({
			id: "workbench.action.collaboration.showStatus",
			title: localize2("showCollaborationStatus", "Collaboration: Show Status"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const collaborationService = accessor.get(ICollaborationService);
		const notificationService = accessor.get(INotificationService);

		const state = collaborationService.state;
		const users = collaborationService.users;
		const currentUser = collaborationService.currentUser;

		let message = `Status: ${state}\n`;
		message += `Current User: ${currentUser?.name || "Not connected"}\n`;
		message += `Connected Users: ${users.length}\n`;

		if (users.length > 0) {
			message += "\nUsers:\n";
			users.forEach((user: ICollaborationUser) => {
				// allow-any-unicode-next-line
				const marker = user.id === currentUser?.id ? "● " : "○ ";
				message += `${marker}${user.name}\n`;
			});
		}

		notificationService.info(message);
	}
}

// Register all actions
registerAction2(ConnectToCollaborationServerAction);
registerAction2(DisconnectFromCollaborationServerAction);
registerAction2(ShowCollaborationStatusAction);

// ==================== Status Bar Contribution ====================

class CollaborationStatusbarContribution
	extends Disposable
	implements IWorkbenchContribution {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private statusbarEntry: any;

	constructor(
		@ICollaborationService
		private readonly collaborationService: ICollaborationService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
	) {
		super();

		// Initial render
		this.updateStatusbar();

		// Listen to changes
		this._register(
			this.collaborationService.onDidChangeState(() => {
				this.updateStatusbar();
			}),
		);

		this._register(
			this.collaborationService.onDidChangeUsers(() => {
				this.updateStatusbar();
			}),
		);
	}

	private updateStatusbar(): void {
		const state = this.collaborationService.state;
		const users = this.collaborationService.users;
		const userCount = users.length;

		let text: string;
		let tooltip: string;
		let command: string;
		let backgroundColor: ThemeColor | undefined;

		switch (state) {
			case CollaborationState.Connected:
				text = `$(live-share) ${userCount}`;
				tooltip = this.buildTooltip(users);
				command = "workbench.action.collaboration.showStatus";
				backgroundColor = themeColorFromId("statusBarItem.prominentBackground");
				break;

			case CollaborationState.Connecting:
				text = "$(sync~spin) Connecting...";
				tooltip = localize(
					"connectingTooltip",
					"Connecting to collaboration server",
				);
				command = "workbench.action.collaboration.showStatus";
				backgroundColor = themeColorFromId("statusBarItem.warningBackground");
				break;

			case CollaborationState.Error:
				text = "$(error) Collaboration Error";
				tooltip = localize(
					"errorTooltip",
					"Failed to connect to collaboration server. Click to retry.",
				);
				command = "workbench.action.collaboration.connect";
				backgroundColor = themeColorFromId("statusBarItem.errorBackground");
				break;

			case CollaborationState.Disconnected:
			default:
				text = "$(circle-slash) Disconnected";
				tooltip = localize(
					"disconnectedTooltip",
					"Not connected to collaboration server. Click to connect.",
				);
				command = "workbench.action.collaboration.connect";
				break;
		}

		const entry = {
			name: localize("collaborationStatus", "Collaboration Status"),
			text,
			tooltip,
			command,
			backgroundColor,
			ariaLabel: tooltip,
		};

		if (this.statusbarEntry) {
			this.statusbarEntry.update(entry);
		} else {
			this.statusbarEntry = this.statusbarService.addEntry(
				entry,
				"collaboration.status",
				StatusbarAlignment.LEFT,
				100,
			);
			this._register(this.statusbarEntry);
		}
	}

	private buildTooltip(users: readonly ICollaborationUser[]): string {
		if (users.length === 0) {
			return localize("noUsers", "No active users");
		}

		const currentUser = this.collaborationService.currentUser;
		const lines = [
			localize("collaborationActive", "Collaboration Active"),
			"",
			localize("activeUsers", "Active Users:"),
		];

		users.forEach((user: ICollaborationUser) => {
			// allow-any-unicode-next-line
			const marker = user.id === currentUser?.id ? "● " : "○ ";
			lines.push(`${marker}${user.name}`);
		});

		return lines.join("\n");
	}
}

// Register the statusbar contribution to be instantiated at startup
const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(
	WorkbenchExtensions.Workbench,
);
workbenchRegistry.registerWorkbenchContribution(
	CollaborationStatusbarContribution,
	LifecyclePhase.Restored,
);
