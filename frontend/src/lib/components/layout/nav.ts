/**
 * Navigation model of the application shell (CORE-01, AUTH-18).
 *
 * Pages and nested layouts contribute sidebar sections by returning
 * `nav: NavSection[]` from their load function (a universal `+layout.ts` may
 * include icon components); the root layout appends them after the global
 * sections. Everything here is plain data so that it stays testable.
 */
import type { Component } from 'svelte';

/** One link of the navigation menu. */
export interface NavItem {
	/** Visible (already translated) label. */
	label: string;
	/** Target URL (same-site path). */
	href: string;
	/** Optional icon component (e.g. from `@lucide/svelte/icons/...`). */
	icon?: Component;
	/** Forces the active state; computed from the current path when omitted. */
	active?: boolean;
}

/** A titled group of navigation items. */
export interface NavSection {
	/** Optional (already translated) section title. */
	title?: string;
	/**
	 * Makes the section a context header (e.g. the course being administered): the title
	 * is shown prominently with this (translated) subtitle, linked to `contextHref`.
	 */
	context?: string;
	/** Link of the context header (required with `context`, like `title`). */
	contextHref?: string;
	items: NavItem[];
}

/**
 * Returns the href of the item matching the current location best: the longest
 * href path equal to the current path or being a parent of it (so that
 * `/course/x/task` only highlights the task entry, not also the course entry),
 * whose query parameters (e.g. `?tab=groups`) are all present in the current
 * URL; on equal paths the item with the most matching parameters wins.
 * @param current path of the page, optionally followed by its `?query`.
 */
export function activeHref(sections: NavSection[], current: string): string | null {
	const [path, query = ''] = current.split('?');
	const params = new URLSearchParams(query);
	let best: string | null = null;
	let bestScore = -1;
	for (const { href } of sections.flatMap((s) => s.items)) {
		const [base, search = ''] = href.split('#')[0].split('?');
		const wanted = [...new URLSearchParams(search)];
		// "/" only matches itself, otherwise it would be the parent of every page.
		const matches = path === base || (base !== '/' && path.startsWith(base + '/'));
		const score = base.length * 100 + wanted.length;
		if (matches && wanted.every(([k, v]) => params.get(k) === v) && score > bestScore) {
			best = href;
			bestScore = score;
		}
	}
	return best;
}
