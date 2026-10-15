/**
 * Root universal load: loads the translation catalog of the page language in
 * the browser (the server uses the per-request catalog of hooks.server.ts).
 */
import { browser } from '$app/env';
import { loadCatalog } from '#lib/i18n/index.js';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ data }) => ({
	...data,
	catalog: browser ? await loadCatalog(data.lang) : {}
});
