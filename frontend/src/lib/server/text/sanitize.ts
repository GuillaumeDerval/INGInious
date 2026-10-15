/**
 * HTML sanitization of every rendered text: an allow-list of the tags,
 * classes and attributes produced by the RST/Markdown renderers plus the
 * common safe HTML found in `.. raw:: html` blocks of course material.
 *
 * Removed: script/style/iframe/object/form & co., `on*` handlers,
 * `javascript:`/`vbscript:` URLs, non-image `data:` URLs and every inline
 * style except a few harmless presentation properties.
 * Also applies the link policy (target="_blank" + rel on non-anchor links)
 * and the optional LTI asset URL rewriting of relative `href`/`src`.
 */
import sanitizeHtml from 'sanitize-html';
import type { SafeHtml } from '#lib/utils/safe-html.js';

/** A CSS length (or percentage / keyword) without functions such as url(). */
const LENGTH = /^-?\d+(\.\d+)?(px|em|rem|%|pt|vh|vw|ex|ch)?$|^auto$/;

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
