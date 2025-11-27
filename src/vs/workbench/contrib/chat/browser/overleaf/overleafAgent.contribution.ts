/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../../common/contributions.js';
import { OverleafAgent } from './overleafAgent.js';

/**
 * Workbench contribution that registers the Overleaf AI agent on startup
 */
export class OverleafAgentContribution
	extends Disposable
	implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.overleafAgent';

	constructor(
		@IInstantiationService
		private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this.logService.info(
			'[OverleafAgentContribution] Registering Overleaf AI agent...',
		);

		// Register the agent
		this._register(OverleafAgent.registerAgent(this.instantiationService));

		this.logService.info(
			'[OverleafAgentContribution] Overleaf AI agent registered successfully',
		);
	}
}

// Register the contribution
registerWorkbenchContribution2(OverleafAgentContribution.ID, OverleafAgentContribution, WorkbenchPhase.BlockStartup);
