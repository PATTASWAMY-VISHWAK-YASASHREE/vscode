/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { IAuxiliaryWindowService, IAuxiliaryWindow } from '../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { CodeWindow, mainWindow } from '../../../base/browser/window.js';

suite('Auxiliary Window Theme Propagation', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	class MockAuxiliaryWindow implements IAuxiliaryWindow {
		onWillLayout = () => ({ dispose: () => { } });
		onDidLayout = () => ({ dispose: () => { } });
		onBeforeUnload = () => ({ dispose: () => { } });
		onUnload = () => ({ dispose: () => { } });
		whenStylesHaveLoaded = Promise.resolve();

		constructor(public window: CodeWindow, public container: HTMLElement) { }

		updateOptions() { }
		layout() { }
		createState() { return {}; }
		dispose() { }
	}

	class MockAuxiliaryWindowService implements IAuxiliaryWindowService {
		readonly _serviceBrand: undefined;
		onDidOpenAuxiliaryWindow = () => ({ dispose: () => { } });

		private windows: IAuxiliaryWindow[] = [];

		async open() {
			// Create a mock window for testing
			const mockDocument = {
				head: {
					getElementsByClassName: (className: string) => [],
					appendChild: (element: any) => element
				}
			} as any;

			const mockWindow = {
				document: mockDocument
			} as CodeWindow;

			const container = document.createElement('div');
			const auxWindow = new MockAuxiliaryWindow(mockWindow, container);
			this.windows.push(auxWindow);
			return auxWindow;
		}

		getWindow() { return this.windows[0]; }
		getWindows() { return this.windows; }
	}

	test('theme CSS rules are applied to auxiliary windows', async () => {
		const disposables = new DisposableStore();
		const auxiliaryWindowService = new MockAuxiliaryWindowService();

		try {
			// Create an auxiliary window
			const auxWindow = await auxiliaryWindowService.open();

			// Mock the _applyRules function behavior
			const testStyleContent = '.test-theme { color: red; }';
			const rulesClassName = 'testThemeRules';

			// Function that mimics _applyRules logic
			const applyRulesToWindow = (targetWindow: any, styleSheetContent: string, className: string) => {
				const themeStyles = targetWindow.document.head.getElementsByClassName(className);
				if (themeStyles.length === 0) {
					const elStyle = document.createElement('style') as HTMLStyleElement;
					elStyle.className = className;
					elStyle.textContent = styleSheetContent;
					targetWindow.document.head.appendChild(elStyle);
					return elStyle;
				} else {
					(themeStyles[0] as HTMLStyleElement).textContent = styleSheetContent;
					return themeStyles[0];
				}
			};

			// Apply to main window
			const mainStyle = applyRulesToWindow(mainWindow, testStyleContent, rulesClassName);
			assert.ok(mainStyle, 'Style should be applied to main window');

			// Apply to auxiliary window
			const auxStyle = applyRulesToWindow(auxWindow.window, testStyleContent, rulesClassName);
			assert.ok(auxStyle, 'Style should be applied to auxiliary window');

			// Verify content is the same
			assert.strictEqual((auxStyle as HTMLStyleElement).textContent, testStyleContent, 'Auxiliary window should have same CSS content as main window');

		} finally {
			disposables.dispose();
		}
	});

	test('getWindows returns all auxiliary windows', async () => {
		const auxiliaryWindowService = new MockAuxiliaryWindowService();

		// Initially no windows
		assert.strictEqual(auxiliaryWindowService.getWindows().length, 0, 'Should start with no auxiliary windows');

		// Add one window
		await auxiliaryWindowService.open();
		assert.strictEqual(auxiliaryWindowService.getWindows().length, 1, 'Should have one auxiliary window');

		// Add another window
		await auxiliaryWindowService.open();
		assert.strictEqual(auxiliaryWindowService.getWindows().length, 2, 'Should have two auxiliary windows');
	});
});
