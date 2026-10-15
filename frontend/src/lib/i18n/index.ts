/**
 * Internationalisation (AUTH-10), usable on the server and in the browser.
 *
 * Messages are keyed by their English text, exactly like the legacy gettext
 * catalogs (converted to `locales/<lang>.json` by tools/po2json.mjs), so every
 * legacy translation is reused when the English wording is kept. Placeholders
 * follow Python's `str.format`: `{}` (positional) and `{name}`.
 *
 * The active catalog is obtained through a pluggable getter: the server binds
 * it to the current request (AsyncLocalStorage, see hooks.server.ts) and the
 * browser to the language of the page (see routes/+layout.svelte).
 */

/** Languages offered to users, in the legacy order: code -> native name. */
export const LANGUAGES: Record<string, string> = {
	en: 'English',
	de: 'Deutsch',
	el: 'ελληνικά',
	es: 'Español',
	fr: 'Français',
	he: 'עִבְרִית',
	nl: 'Nederlands',
	nb_NO: 'Norsk (bokmål)',
	pt: 'Português',
	vi: 'Tiếng Việt'
};

/** A translation catalog: English msgid -> translated text. */
export type Catalog = Record<string, string>;

/** Lazy loaders of the JSON catalogs (one chunk per language in the browser). */
const loaders = import.meta.glob<Catalog>('./locales/*.json', { import: 'default' });

/** Loads the catalog of a language (empty for English or unknown languages). */
export async function loadCatalog(lang: string): Promise<Catalog> {
	const loader = loaders[`./locales/${lang}.json`];
	return loader ? await loader() : {};
}

let catalogGetter: () => Catalog = () => ({});

/** Installs the function returning the catalog of the current context. */
export function setCatalogGetter(getter: () => Catalog): void {
	catalogGetter = getter;
}

/**
 * Replaces `{}` / `{name}` placeholders (Python `str.format` subset: the messages
 * of the app only use these two forms). Unknown names are kept as is (e.g. the
 * `{a1start}` markers split by TosCheckbox).
 */
export function format(text: string, ...args: unknown[]): string {
	const named = (args.length === 1 && args[0] && typeof args[0] === 'object' ? args[0] : {}) as Record<string, unknown>;
	let index = 0;
	return text.replace(/\{(\w*)\}/g, (match, key: string) =>
		key === '' ? String(args[index++]) : key in named ? String(named[key]) : match
	);
}

/**
 * Translates a message and formats it.
 * @example t('Welcome {}', name) or t('{count} tasks', { count: 3 })
 */
export function t(msgid: string, ...args: unknown[]): string {
	if (!msgid) return '';
	return format(catalogGetter()[msgid] || msgid, ...args);
}

/** Picks the best supported language from an Accept-Language header (default "en"). */
export function negotiateLanguage(header: string | null): string {
	const wanted = (header ?? '')
		.split(',')
		.map((part) => {
			const [tag, q] = part.trim().split(';q=');
			return { tag: tag.replace('-', '_'), q: q === undefined ? 1 : Number(q) };
		})
		.filter((x) => x.tag && x.q > 0)
		.sort((a, b) => b.q - a.q);
	for (const { tag } of wanted) {
		const exact = Object.keys(LANGUAGES).find((l) => l.toLowerCase() === tag.toLowerCase());
		if (exact) return exact;
		const base = Object.keys(LANGUAGES).find((l) => l.split('_')[0] === tag.split('_')[0].toLowerCase());
		if (base) return base;
	}
	return 'en';
}

/** True for right-to-left languages (Hebrew; legacy magic msgid "__is_rtl"). */
export function isRtl(lang: string): boolean {
	return lang === 'he';
}
