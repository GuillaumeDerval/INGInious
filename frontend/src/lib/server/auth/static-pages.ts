/**
 * Static pages (AUTH-01, AUTH-02): operator-written YAML files
 * `<static_directory>/<pageid>.yaml` (`title`, `content`), optionally translated
 * as `<pageid>.<lang>.yaml` (the translation wins). The content is RST, or
 * Markdown when its first line is `#MD` (detected by `renderText`), always sanitized. Parsed files are
 * cached and re-read when their modification time changes.
 */
import { readFileSync, statSync } from 'node:fs';
import { error } from '@sveltejs/kit';
import { parse } from 'yaml';
import { t } from '#lib/i18n/index.js';
import { services } from '../app.js';
import { isValidId, safeJoin } from '../security/paths.js';
import { renderText } from '../text/index.js';
import type { SafeHtml } from '#lib/utils/safe-html.js';

/** A rendered static page. */
export interface StaticPage {
	title: string;
	html: SafeHtml;
}

/** Parsed files by path, with their modification time. */
const cache = new Map<string, { mtime: number; data: { title?: unknown; content?: unknown } }>();

/**
 * Loads and renders a static page in a language.
 * @returns null when the id is invalid or no file exists.
 */
export function staticPage(pageid: string, lang: string): StaticPage | null {
	// Explicit id validation: no path separator, no "..", nothing outside the directory.
	if (!isValidId(pageid)) return null;
	const dir = String(services().config.raw.static_directory ?? './static');
	let data = null;
	for (const name of [`${pageid}.yaml`, `${pageid}.${lang}.yaml`]) {
		const path = safeJoin(dir, name);
		const mtime = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
		if (mtime === undefined) continue;
		const hit = cache.get(path);
		if (!hit || hit.mtime !== mtime) cache.set(path, { mtime, data: parse(readFileSync(path, 'utf8')) ?? {} });
		data = cache.get(path)!.data;
	}
	if (!data) return null;
	return {
		title: String(data.title ?? ''),
		html: renderText(String(data.content ?? ''), { headerLevel: 2, language: lang })
	};
}

/** Loads a static page or answers 404 (home page and `/pages/<pageid>`, AUTH-01/02). */
export function requireStaticPage(pageid: string, lang: string): StaticPage {
	return staticPage(pageid, lang) ?? error(404, t("File doesn't exist."));
}

/** Links of the terms of service and privacy pages when both are configured (legacy IS_TOS_DEFINED, AUTH-09). */
export function tosLinks(): { terms: string; privacy: string } | null {
	const { isTosDefined, termsPage, privacyPage } = services().config;
	return isTosDefined
		? { terms: `/pages/${encodeURIComponent(termsPage!)}`, privacy: `/pages/${encodeURIComponent(privacyPage!)}` }
		: null;
}
