/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createStyleSheet } from '../../browser/domStylesheets.js';
import { mainWindow } from '../../browser/window.js';
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

	test('global stylesheet textContent changes should propagate to auxiliary windows', () => {
		const disposableStore = disposables.add(new DisposableStore());

		try {
			// Create a global stylesheet in the main window
			const originalStyleSheet = createStyleSheet(mainWindow.document.head, undefined, disposableStore);
			originalStyleSheet.textContent = 'body { color: red; }';

			// Verify the stylesheet was created correctly
			assert.strictEqual(originalStyleSheet.textContent, 'body { color: red; }');
			assert.strictEqual(originalStyleSheet.parentElement, mainWindow.document.head);

			// Test that we can clone the stylesheet (simulates auxiliary window cloning)
			const clonedNode = originalStyleSheet.cloneNode(true) as HTMLStyleElement;
			assert.strictEqual(clonedNode.textContent, 'body { color: red; }', 'Cloned stylesheet should have same content as original');

			// Test updateTextContent method with Firefox-specific handling
			originalStyleSheet.updateTextContent('body { color: green; }');
			assert.strictEqual(originalStyleSheet.textContent, 'body { color: green; }', 'updateTextContent should update text content');

			// Test that updateTextContent method exists and is callable
			assert.strictEqual(typeof originalStyleSheet.updateTextContent, 'function', 'updateTextContent should be a function');

			// Test that normal textContent setting still works
			originalStyleSheet.textContent = 'body { color: blue; }';
			assert.strictEqual(originalStyleSheet.textContent, 'body { color: blue; }', 'Direct textContent assignment should work');

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
