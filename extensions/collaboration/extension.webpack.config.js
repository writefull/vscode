/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
import withDefaults from '../shared.webpack.config.mjs';

export default withDefaults({
	context: path.join(import.meta.dirname),
	entry: {
		extension: './src/extensionMain.ts'
	},
	resolve: {
		mainFields: ['module', 'main']
	},
});
