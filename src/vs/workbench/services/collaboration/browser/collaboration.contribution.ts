/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollaborationService } from './collaborationService.js';
import { ICollaborationService } from '../../../common/collaboration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

// Register the collaboration service as a singleton
registerSingleton(ICollaborationService, CollaborationService, InstantiationType.Delayed);
