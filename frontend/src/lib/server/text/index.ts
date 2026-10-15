/**
 * Rich text rendering entry point: reStructuredText (legacy default) or
 * Markdown → sanitized `SafeHtml`, for task contexts, problem headers, MCQ
 * choices, course descriptions, static pages and grader feedback. A text whose
 * first line is `#MD` is Markdown (see #lib/utils/text-format.ts), anything else
 * is reStructuredText, so the choice needs no stored setting.
 *
 * Pipeline (docs/reference/rst-rendering.md §9):
 *   1. size limit (MAX_SOURCE_LENGTH) and non-string tolerance;
 *   2. parse + render (rst.ts / markdown.ts), replacement of the legacy
 *      `document.write(input["@random"][N])` idiom by the value (scripts are never
 *      executed) and sanitization (sanitize.ts, mandatory even for author content),
 *      all inside ONE `vm` timeout: the RST parser is regex-heavy (possible ReDoS) and
 *      sanitize-html is slow on deeply nested markup, so a pathological input blocks
 *      the event loop at most RENDER_TIMEOUT_MS;
 *   3. any failure → translated `<b>Parsing failed</b>: <pre>{source}</pre>`.
 * Results (fallbacks included, so a slow text costs the budget once) are kept in a
 * small LRU cache, except LTI-rewritten ones (the links carry the session token).
 * Time-dependent sources (`hidden-until`) are cached per minute of `now`: a block is
 * revealed at most one minute late, never early.
 * Bounds: the work of one render is capped by the source size and the `vm` timeout,
 * which interrupts any synchronous code (parsing, regex backtracking, sanitizing), so
 * a render never blocks the process longer than RENDER_TIMEOUT_MS, and the cache makes
 * a slow text pay it once. Rendering is not moved to a worker thread: it would not be
 * bounded better, and `t()` must use the catalog of the current request, which a worker
 * cannot see. Grader feedback is also truncated when stored (submissions/manager.ts).
 */
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { t } from '#lib/i18n/index.js';
import { escapeHtml } from '#lib/utils/escape.js';
import type { SafeHtml } from '#lib/utils/safe-html.js';
import { rstToHtml } from './rst.js';
import { markdownToHtml } from './markdown.js';
import { sanitize } from './sanitize.js';
import { splitTextFormat, type TextFormat } from '#lib/utils/text-format.js';

export type { SafeHtml };

/** Options of `renderText`. */
export interface RenderOptions {
	/** Reveal `hidden-until` blocks (course staff on the feedback); default false. */
	showEverything?: boolean;
	/** Level of the first RST section title: 3 (default), 2 for static pages. */
	headerLevel?: number;
	/** Current time for `hidden-until` (tests); default `new Date()`. */
	now?: Date;
	/** Rewrites relative `href`/`src` (LTI asset route); disables caching. */
	ltiAssetRewrite?: (url: string) => string;
	/** Values of the task's random inputs (`input["@random"]`), substituted in raw HTML. */
	random?: number[];
	/**
	 * Language of the active translation catalog. The fixed strings ("[no content]",
	 * hidden-until messages, the fallback) are translated with `t()`, i.e. with the
	 * catalog of the current request; this value only separates cache entries.
	 */
	language?: string;
}

/** Sources longer than this (in UTF-16 code units, ~200 kB) are not parsed. */
export const MAX_SOURCE_LENGTH = 200_000;

/** Maximum time of a whole render (parse + sanitize) before falling back (event-loop blocking bound). */
export const RENDER_TIMEOUT_MS = 1000;

/** Number of rendered texts kept in the LRU cache. */
const CACHE_SIZE = 500;

/** LRU cache: Map iteration order is insertion order, re-inserted on hit. */
const cache = new Map<string, SafeHtml>();

/** Expands tabs to 8-column stops, like docutils (`tab_width` 8). */
function expandTabs(source: string): string {
	return source.replace(/^.*\t.*$/gm, (line) => {
		let out = '';
		for (const ch of line) out += ch === '\t' ? ' '.repeat(8 - (out.length % 8)) : ch;
		return out;
	});
}

/**
 * Replaces the legacy random-input idiom `<script>document.write(input["@random"][N]);</script>`
 * (tutorial 07) by the escaped value; without an index the whole list is written,
 * as JavaScript would. Other scripts are later removed by the sanitizer.
 */
function substituteRandom(html: string, random: number[] = []): string {
	return html.replace(
		/<script[^>]*>\s*document\.write\(\s*input\[\s*["']@random["']\s*\](?:\[\s*(\d+)\s*\])?\s*\)\s*;?\s*<\/script>/gi,
		(_, index?: string) => escapeHtml(index === undefined ? random.join(',') : (random[Number(index)] ?? ''))
	);
}

/**
 * The legacy fallback shown when a text cannot be rendered. The source is only
 * echoed when it cannot reveal `hidden-until` content to someone not allowed to
 * see it yet.
 */
function fallback(source: string, showEverything = false): SafeHtml {
	const shown = showEverything || !source.includes('hidden-until') ? escapeHtml(source) : '…';
	return sanitize(t('<b>Parsing failed</b>: <pre>{}</pre>', shown));
}

/**
 * Renders the source without limits/caching (may throw). The random idiom is
 * substituted in the Markdown source (markdown-it splits inline HTML) and in
 * the RST output (`.. raw:: html` is copied verbatim, code examples are escaped).
 */
function render(source: string, format: TextFormat, options: RenderOptions): string {
	if (format === 'markdown') return markdownToHtml(substituteRandom(source, options.random), options.headerLevel ?? 3);
	const html = rstToHtml(expandTabs(source), {
		showEverything: options.showEverything ?? false,
		headerLevel: options.headerLevel ?? 3,
		now: options.now ?? new Date()
	});
	return substituteRandom(html, options.random);
}

/**
 * Renders rich text (RST or Markdown) to sanitized HTML. Never throws: invalid
 * input gives the "Parsing failed" fallback; `null`/`undefined` (broken legacy
 * submissions) give an empty string, other non-strings are stringified.
 */
export function renderText(source: unknown, options: RenderOptions = {}): SafeHtml {
	const raw = typeof source === 'string' ? source : source == null ? '' : String(source);
	const { format, body: text } = splitTextFormat(raw);
	if (!text.trim()) return '' as SafeHtml;
	if (text.length > MAX_SOURCE_LENGTH) return fallback(text.slice(0, 10_000) + '…', options.showEverything);
	const cacheable = !options.ltiAssetRewrite;
	const { showEverything = false, headerLevel = 3, random, language } = options;
	// hidden-until blocks depend on the time: the minute of `now` is part of their key.
	const minute = text.includes('hidden-until') ? Math.floor((options.now ?? new Date()).getTime() / 60_000) : 0;
	const key = cacheable
		? createHash('sha256')
				.update(JSON.stringify([text, format, showEverything, headerLevel, random, language, minute]))
				.digest('base64')
		: '';
	const hit = cache.get(key);
	if (hit !== undefined) {
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}
	let html: SafeHtml;
	try {
		// The timeout interrupts synchronous code (including regex backtracking) run from the context.
		html = vm.runInNewContext(
			'run()',
			{ run: () => sanitize(render(text, format, options), options.ltiAssetRewrite) },
			{ timeout: RENDER_TIMEOUT_MS }
		) as SafeHtml;
	} catch {
		html = fallback(text, options.showEverything);
	}
	if (cacheable) {
		cache.set(key, html);
		if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
	}
	return html;
}
