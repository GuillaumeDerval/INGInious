/**
 * HTML escaping for the rare places where HTML is built as a string on the
 * server (e-mails, maintenance page). Svelte templates escape automatically.
 */

/** Characters that must be escaped in HTML text and attribute values. */
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes a value for safe inclusion in HTML text or a quoted attribute. */
export function escapeHtml(value: unknown): string {
	return String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
