/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, toDisposable, IDisposable } from '../common/lifecycle.js';
import { autorun, IObservable } from '../common/observable.js';
import { getWindows, sharedMutationObserver } from './dom.js';
import { mainWindow } from './window.js';
import { isFirefox } from './browser.js';

const globalStylesheets = new Map<HTMLStyleElement /* main stylesheet */, Set<HTMLStyleElement /* aux window clones that track the main stylesheet */>>();

export function isGlobalStylesheet(node: Node): boolean {
	return globalStylesheets.has(node as HTMLStyleElement);
}

/**
 * Interface that mimics the essential HTMLStyleElement methods needed by the codebase
 */
export interface IStyleElement {
	readonly type: string;
	readonly media: string;
	readonly parentElement: HTMLElement | null;
	readonly sheet: CSSStyleSheet | null;
	textContent: string | null;
	id: string;
	className: string;
	remove(): void;
	updateTextContent(content: string): void;
	cloneNode(deep?: boolean): Node;
	appendChild(newChild: Node): Node;
	setAttribute(name: string, value: string): void;
	getAttribute(name: string): string | null;
}

/**
 * Wrapper class that provides HTMLStyleElement-like interface
 * with Firefox-specific text content update functionality
 */
class StyleElementWrapper implements IStyleElement {
	private _element: HTMLStyleElement;

	constructor(element: HTMLStyleElement) {
		this._element = element;
	}

	get type(): string {
		return this._element.type;
	}

	get media(): string {
		return this._element.media;
	}

	get parentElement(): HTMLElement | null {
		return this._element.parentElement;
	}

	get sheet(): CSSStyleSheet | null {
		return this._element.sheet;
	}

	get textContent(): string | null {
		return this._element.textContent;
	}

	set textContent(value: string | null) {
		this._element.textContent = value;
	}

	get id(): string {
		return this._element.id;
	}

	set id(value: string) {
		this._element.id = value;
	}

	get className(): string {
		return this._element.className;
	}

	set className(value: string) {
		this._element.className = value;
	}

	remove(): void {
		this._element.remove();
	}

	cloneNode(deep?: boolean): Node {
		return this._element.cloneNode(deep);
	}

	appendChild(newChild: Node): Node {
		return this._element.appendChild(newChild);
	}

	setAttribute(name: string, value: string): void {
		this._element.setAttribute(name, value);
	}

	getAttribute(name: string): string | null {
		return this._element.getAttribute(name);
	}

	/**
	 * Updates text content with Firefox-specific handling.
	 * Sets a data attribute and updates content specifically for Firefox.
	 */
	updateTextContent(content: string): void {
		if (isFirefox) {
			// Set a data attribute to mark this as Firefox-updated content
			this._element.setAttribute('data-firefox-updated', 'true');
		}
		this._element.textContent = content;
	}

	// Expose the underlying element for cases where direct access is needed
	getElement(): HTMLStyleElement {
		return this._element;
	}
}

/**
 * A version of createStyleSheet which has a unified API to initialize/set the style content.
 */
export function createStyleSheet2(): WrappedStyleElement {
	return new WrappedStyleElement();
}

class WrappedStyleElement {
	private _currentCssStyle = '';
	private _styleSheet: IStyleElement | undefined = undefined;

	public setStyle(cssStyle: string): void {
		if (cssStyle === this._currentCssStyle) {
			return;
		}
		this._currentCssStyle = cssStyle;

		if (!this._styleSheet) {
			this._styleSheet = createStyleSheet(mainWindow.document.head, (s) => s.textContent = cssStyle);
		} else {
			this._styleSheet.textContent = cssStyle;
		}
	}

	public dispose(): void {
		if (this._styleSheet) {
			this._styleSheet.remove();
			this._styleSheet = undefined;
		}
	}
}

export function createStyleSheet(container: HTMLElement = mainWindow.document.head, beforeAppend?: (style: HTMLStyleElement) => void, disposableStore?: DisposableStore): IStyleElement {
	const style = document.createElement('style');
	style.type = 'text/css';
	style.media = 'screen';
	beforeAppend?.(style);
	container.appendChild(style);

	if (disposableStore) {
		disposableStore.add(toDisposable(() => style.remove()));
	}

	// With <head> as container, the stylesheet becomes global and is tracked
	// to support auxiliary windows to clone the stylesheet.
	if (container === mainWindow.document.head) {
		const globalStylesheetClones = new Set<HTMLStyleElement>();
		globalStylesheets.set(style, globalStylesheetClones);

		for (const { window: targetWindow, disposables } of getWindows()) {
			if (targetWindow === mainWindow) {
				continue; // main window is already tracked
			}

			const cloneDisposable = disposables.add(cloneGlobalStyleSheet(style, globalStylesheetClones, targetWindow));
			disposableStore?.add(cloneDisposable);
		}
	}

	return new StyleElementWrapper(style);
}

export function cloneGlobalStylesheets(targetWindow: Window): IDisposable {
	const disposables = new DisposableStore();

	for (const [globalStylesheet, clonedGlobalStylesheets] of globalStylesheets) {
		disposables.add(cloneGlobalStyleSheet(globalStylesheet, clonedGlobalStylesheets, targetWindow));
	}

	return disposables;
}

function cloneGlobalStyleSheet(globalStylesheet: HTMLStyleElement, globalStylesheetClones: Set<HTMLStyleElement>, targetWindow: Window): IDisposable {
	const disposables = new DisposableStore();

	const clone = globalStylesheet.cloneNode(true) as HTMLStyleElement;
	targetWindow.document.head.appendChild(clone);
	disposables.add(toDisposable(() => clone.remove()));

	for (const rule of getDynamicStyleSheetRules(globalStylesheet)) {
		clone.sheet?.insertRule(rule.cssText, clone.sheet?.cssRules.length);
	}

	disposables.add(sharedMutationObserver.observe(globalStylesheet, disposables, { childList: true, characterData: true, subtree: true })(() => {
		clone.textContent = globalStylesheet.textContent;
	}));

	globalStylesheetClones.add(clone);
	disposables.add(toDisposable(() => globalStylesheetClones.delete(clone)));

	return disposables;
}

let _sharedStyleSheet: IStyleElement | null = null;
function getSharedStyleSheet(): IStyleElement {
	if (!_sharedStyleSheet) {
		_sharedStyleSheet = createStyleSheet();
	}
	return _sharedStyleSheet;
}

function getDynamicStyleSheetRules(style: HTMLStyleElement) {
	if (style?.sheet?.rules) {
		// Chrome, IE
		return style.sheet.rules;
	}
	if (style?.sheet?.cssRules) {
		// FF
		return style.sheet.cssRules;
	}
	return [];
}

export function createCSSRule(selector: string, cssText: string, style = getSharedStyleSheet()): void {
	if (!style || !cssText) {
		return;
	}

	style.sheet?.insertRule(`${selector} {${cssText}}`, 0);

	// Apply rule also to all cloned global stylesheets
	// Access the underlying HTMLStyleElement to check for clones
	const element = (style as StyleElementWrapper).getElement();
	for (const clonedGlobalStylesheet of globalStylesheets.get(element) ?? []) {
		createCSSRule(selector, cssText, new StyleElementWrapper(clonedGlobalStylesheet));
	}
}

export function removeCSSRulesContainingSelector(ruleName: string, style = getSharedStyleSheet()): void {
	if (!style) {
		return;
	}

	// Access the underlying HTMLStyleElement to get rules
	const element = (style as StyleElementWrapper).getElement();
	const rules = getDynamicStyleSheetRules(element);
	const toDelete: number[] = [];
	for (let i = 0; i < rules.length; i++) {
		const rule = rules[i];
		if (isCSSStyleRule(rule) && rule.selectorText.indexOf(ruleName) !== -1) {
			toDelete.push(i);
		}
	}

	for (let i = toDelete.length - 1; i >= 0; i--) {
		style.sheet?.deleteRule(toDelete[i]);
	}

	// Remove rules also from all cloned global stylesheets
	for (const clonedGlobalStylesheet of globalStylesheets.get(element) ?? []) {
		removeCSSRulesContainingSelector(ruleName, new StyleElementWrapper(clonedGlobalStylesheet));
	}
}

function isCSSStyleRule(rule: CSSRule): rule is CSSStyleRule {
	return typeof (rule as CSSStyleRule).selectorText === 'string';
}

export function createStyleSheetFromObservable(css: IObservable<string>): IDisposable {
	const store = new DisposableStore();
	const w = store.add(createStyleSheet2());
	store.add(autorun(reader => {
		w.setStyle(css.read(reader));
	}));
	return store;
}
