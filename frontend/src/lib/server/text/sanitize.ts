/**
 * HTML sanitization of every rendered text: an allow-list of the tags,
 * classes and attributes produced by the RST/Markdown renderers plus the
 * common safe HTML found in `.. raw:: html` blocks of course material.
 *
 * Removed: script/style/iframe/object/form & co., `on*` handlers,
 * `javascript:`/`vbscript:` URLs, non-image `data:` URLs and every inline
 * style except a few harmless presentation properties (no positioning, no
 * viewport units: content stays inside its box and cannot cover the page).
 * Classes are restricted to the ones the renderers and the rich-text
 * stylesheet know (CLASSES); the other ones (author classes of `:class:`,
 * `.. class::`, custom roles or raw HTML) get the ID_PREFIX, so content never
 * picks up the application's own utility classes (e.g. `fixed inset-0`)
 * while keeping distinct names. `id`/`name` values get the
 * ID_PREFIX, together with in-document links (`href="#…"`) and ARIA id
 * references, so they never collide with the page's own elements while
 * footnotes and section links keep working.
 * Also applies the link policy (target="_blank" + rel on non-anchor links)
 * and the optional LTI asset URL rewriting of relative `href`/`src`.
 */
import sanitizeHtml from 'sanitize-html';
import hljs from 'highlight.js';
import type { SafeHtml } from '#lib/utils/safe-html.js';

/** A CSS length (or percentage / keyword) without functions such as url() nor viewport units. */
const LENGTH = /^-?\d+(\.\d+)?(px|em|rem|%|pt|ex|ch)?$|^auto$/;

/** Prefix of every `id`/`name` and unknown class of rendered content (and of the fragments pointing to them). */
export const ID_PREFIX = 'rt-';

/** Bootstrap colour names (admonitions and legacy course content). */
const COLORS = 'primary|secondary|success|info|warning|danger|light|dark|default';

/**
 * Classes kept in rendered content: the docutils/INGInious RST writer (rst.ts), the
 * Markdown renderer (markdown.ts), the Bootstrap 4 classes restyled by rich-text.css,
 * the highlight.js / KaTeX output classes and Font Awesome icons found in course material.
 */
const CLASSES = new Set(
	(
		'admonition attention caution danger error hint important note tip warning info success primary secondary ' +
		'light dark alert card card-header card-body mb-3 text-white text-muted row col section docutils first last ' +
		'simple arabic loweralpha upperalpha lowerroman upperroman literal pre code literal-block doctest-block math ' +
		'line-block line attribution compound figure caption legend target reference internal external ' +
		'image-reference field field-list field-name field-body footnote footnote-reference fn-backref citation label ' +
		'classifier classifier-delimiter option option-group option-list description head table table-bordered ' +
		'thead-light system-message system-message-title problematic rubric hljs katex katex-display fa'
	).split(' ')
);

/** Families of allowed classes (generated names and Bootstrap grid/colour/text utilities). */
const CLASS_PATTERNS = [
	/^admonition-[\w-]+$/,
	new RegExp(`^(alert|bg|border)-(${COLORS})$`),
	/^col-((xs|sm|md|lg)-)?([1-9]|1[0-2])$/,
	/^text-(center|left|right|justify)$/,
	/^align-(left|right|center|top|middle|bottom)$/,
	/^(hljs|fa)-[\w-]+$/
];

/**
 * Code languages accepted as classes of `pre`/`code` (the `code-block` language read
 * by RichText's highlighter): every highlight.js name and alias, plus the editor aliases
 * unknown to highlight.js (#lib/components/ui/code-languages.ts).
 */
const LANGUAGES = new Set([
	...hljs.listLanguages().flatMap((name) => [name, ...(hljs.getLanguage(name)?.aliases ?? [])]),
	...'python3 asm racket octave oz'.split(' ')
]);

/** True if the class may be kept on an element of this tag. */
function allowedClass(tag: string, name: string): boolean {
	if (CLASSES.has(name) || CLASS_PATTERNS.some((re) => re.test(name))) return true;
	return (tag === 'pre' || tag === 'code') && LANGUAGES.has(name.toLowerCase());
}

/** ARIA attributes holding (space-separated) element ids. */
const ARIA_REFS = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-details'];

/** Tags allowed in rendered content. */
const TAGS = (
	'p div span br hr h1 h2 h3 h4 h5 h6 a img blockquote pre code tt kbd samp var em strong b i u s del ins mark ' +
	'small big sub sup cite abbr acronym q time ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td ' +
	'figure figcaption section details summary center'
).split(' ');

/** sanitize-html configuration (built once). */
function options(rewrite?: (url: string) => string): sanitizeHtml.IOptions {
	/** True for URLs relative to the current page (no scheme, no host, no anchor). */
	const relative = (url: string) => !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url.trim());
	return {
		allowedTags: TAGS,
		allowedAttributes: {
			'*': ['class', 'id', 'title', 'lang', 'dir', 'style', 'aria-*'],
			a: ['href', 'name', 'target', 'rel'],
			img: ['src', 'alt', 'width', 'height'],
			time: ['datetime'],
			col: ['width', 'span'],
			td: ['colspan', 'rowspan'],
			th: ['colspan', 'rowspan'],
			table: ['frame', 'rules'],
			tbody: ['valign'],
			ol: ['start', 'type'],
			li: ['value']
		},
		allowedStyles: {
			'*': {
				'text-align': [/^(left|right|center|justify)$/],
				'font-size': [LENGTH],
				'font-weight': [/^(normal|bold|bolder|lighter|\d{3})$/],
				'font-style': [/^(normal|italic)$/],
				width: [LENGTH],
				height: [LENGTH],
				color: [/^(#[0-9a-f]{3,8}|[a-z]+)$/i]
			}
		},
		allowedSchemes: ['http', 'https', 'mailto'],
		allowedSchemesByTag: { img: ['http', 'https', 'data'] },
		allowProtocolRelative: true,
		transformTags: {
			a: (tagName, attribs) => {
				const href = attribs.href;
				// In-document links point to the prefixed ids (footnotes, section links).
				if (href?.length > 1 && href.startsWith('#')) attribs.href = `#${ID_PREFIX}${href.slice(1)}`;
				if (href !== undefined && !href.startsWith('#')) {
					// Non-anchor links open in a new tab (like legacy), with rel=noopener noreferrer.
					attribs.target = '_blank';
					attribs.rel = 'noopener noreferrer';
					if (rewrite && relative(href)) attribs.href = rewrite(href);
				} else {
					delete attribs.target;
				}
				return { tagName, attribs };
			},
			img: (tagName, attribs) => {
				const src = attribs.src ?? '';
				// Only raster/vector images are allowed as data: URLs (no data:text/html).
				if (/^\s*data:/i.test(src) && !/^\s*data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml)[;,]/i.test(src))
					delete attribs.src;
				else if (rewrite && src && relative(src)) attribs.src = rewrite(src);
				return { tagName, attribs };
			},
			// Every element: class allow-list, prefixed ids/names and id references.
			'*': (tagName, attribs) => {
				if (attribs.class !== undefined)
					attribs.class = attribs.class
						.split(/\s+/)
						.filter(Boolean)
						.map((name) => (allowedClass(tagName, name) ? name : ID_PREFIX + name))
						.join(' ');
				for (const key of ['id', 'name']) if (attribs[key]) attribs[key] = ID_PREFIX + attribs[key];
				for (const key of ARIA_REFS)
					if (attribs[key]) attribs[key] = attribs[key].replace(/\S+/g, (id) => ID_PREFIX + id);
				if (attribs.class === '') delete attribs.class;
				return { tagName, attribs };
			}
		}
	};
}

/** Default configuration (no LTI rewriting), shared by all calls. */
const DEFAULT = options();

/** Sanitizes rendered HTML; `rewrite` maps relative URLs (LTI asset route). */
export function sanitize(html: string, rewrite?: (url: string) => string): SafeHtml {
	return sanitizeHtml(html, rewrite ? options(rewrite) : DEFAULT) as SafeHtml;
}
