/**
 * Branded type for HTML that is safe to insert in the DOM.
 *
 * `SafeHtml` values are only produced by the server-side text renderer
 * (`lib/server/text`, which always runs `sanitize-html`) or by escaping plain
 * text with `textToSafeHtml`. `components/common/RichText.svelte`, the only
 * place allowed to use `{@html}`, accepts nothing else (architecture §4.2).
 * The type is isomorphic so components can import it.
 */
import { escapeHtml } from '#lib/utils/escape.js';

/** A string of sanitized HTML (compile-time brand, a plain string at runtime). */
export type SafeHtml = string & { readonly __safe: true };

/** Escapes plain text so it can be displayed through `RichText` as-is. */
export function textToSafeHtml(text: unknown): SafeHtml {
	return escapeHtml(text) as SafeHtml;
}
