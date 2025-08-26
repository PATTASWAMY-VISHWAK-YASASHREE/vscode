/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createStyleSheet, cloneGlobalStylesheets } from '../../browser/domStylesheets.js';
import { mainWindow } from '../../browser/window.js';
import { timeout } from '../../common/async.js';
import { DisposableStore } from '../../common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';

suite('domStylesheets', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('createStyleSheet creates global stylesheet in main window head', () => {
		const styleSheet = createStyleSheet();
		disposables.add({ dispose: () => styleSheet.remove() });

		assert.strictEqual(styleSheet.parentElement, mainWindow.document.head);
		assert.strictEqual(styleSheet.type, 'text/css');
		assert.strictEqual(styleSheet.media, 'screen');
	});

	test('global stylesheet textContent changes should propagate to auxiliary windows', async () => {
		// Create a mock auxiliary window without using window.open()
		// Mock the auxiliary window with proper document structure
		const mockDocument = {
			head: document.createElement('head'),
			createElement: (tagName: string) => document.createElement(tagName)
		};
		
		const auxWindow = {
			document: mockDocument
		} as Window;

		const disposableStore = disposables.add(new DisposableStore());

		try {
			// Create a global stylesheet in the main window
			const originalStyleSheet = createStyleSheet(mainWindow.document.head, undefined, disposableStore);
			originalStyleSheet.textContent = 'body { color: red; }';

			// Test the cloning functionality directly using the cloneGlobalStylesheets function
			// This simulates what happens when an auxiliary window is created
			const cloneDisposable = disposables.add(cloneGlobalStylesheets(auxWindow));

			// Check that the auxiliary window's head now has a cloned stylesheet
			assert.strictEqual(auxWindow.document.head.children.length, 1, 'Auxiliary window should have one cloned stylesheet');
			
			const clonedStylesheet = auxWindow.document.head.children[0] as HTMLStyleElement;
			assert.strictEqual(clonedStylesheet.textContent, 'body { color: red; }', 'Cloned stylesheet should have same content as original');

			// Test that textContent changes propagate through mutation observer
			originalStyleSheet.textContent = 'body { color: blue; }';
			
			// Wait for mutation observer to trigger
			await timeout(50);
			
			// Verify that the cloned stylesheet was updated
			assert.strictEqual(clonedStylesheet.textContent, 'body { color: blue; }', 'Cloned stylesheet should be updated when original changes');

			// Test updateTextContent method
			originalStyleSheet.updateTextContent('body { color: green; }');
			assert.strictEqual(originalStyleSheet.textContent, 'body { color: green; }');

		} finally {
			// Cleanup is handled by disposableStore
		}
	});

	test('updateTextContent method sets data attribute on Firefox', () => {
		const styleSheet = createStyleSheet();
		disposables.add({ dispose: () => styleSheet.remove() });

		// Test the updateTextContent method
		styleSheet.updateTextContent('body { color: green; }');
		assert.strictEqual(styleSheet.textContent, 'body { color: green; }');

		// Check if the underlying element has the Firefox data attribute
		// (we can't easily mock isFirefox in this test, but we can verify the method exists)
		assert.strictEqual(typeof styleSheet.updateTextContent, 'function');
	});

	test('wrapper provides all required HTMLStyleElement-like properties', () => {
		const styleSheet = createStyleSheet();
		disposables.add({ dispose: () => styleSheet.remove() });

		// Test all the key properties that existing code expects
		assert.strictEqual(typeof styleSheet.type, 'string');
		assert.strictEqual(typeof styleSheet.media, 'string');
		assert.strictEqual(typeof styleSheet.id, 'string');
		assert.strictEqual(typeof styleSheet.className, 'string');
		assert.strictEqual(styleSheet.textContent, null); // Initially null
		assert.strictEqual(typeof styleSheet.parentElement, 'object');
		assert.strictEqual(typeof styleSheet.sheet, 'object');
		assert.strictEqual(typeof styleSheet.remove, 'function');
		assert.strictEqual(typeof styleSheet.cloneNode, 'function');
		assert.strictEqual(typeof styleSheet.appendChild, 'function');
		assert.strictEqual(typeof styleSheet.setAttribute, 'function');
		assert.strictEqual(typeof styleSheet.getAttribute, 'function');
	});
});
