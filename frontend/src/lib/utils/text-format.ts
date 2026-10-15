/**
 * Markup language of a rich text (objective: "everything is reStructuredText by
 * default, but a message starting with #MD is Markdown").
 *
 * The choice is carried by the text itself, so it works everywhere a text is
 * stored (task.yaml statements, problem headers, choices, course descriptions,
 * static pages AND grader feedback) without any new field. The UI hides the
 * marker: editors show a format switch (see RichTextInput) built on these
 * helpers, and the renderer (`#lib/server/text`) strips it.
 */

/** Supported markup languages. */
export type TextFormat = 'rst' | 'markdown';

/** First line that switches a text to Markdown: `#MD` (optionally followed by spaces). */
const MARKER = /^#MD[ \t]*(?:\r?\n|$)/;

/** Splits a stored text into its markup language and its content (marker removed). */
export function splitTextFormat(text: string): { format: TextFormat; body: string } {
	const match = MARKER.exec(text);
	return match ? { format: 'markdown', body: text.slice(match[0].length) } : { format: 'rst', body: text };
}

/** Builds the stored text for a content written in `format` (adds the marker for Markdown). */
export function joinTextFormat(format: TextFormat, body: string): string {
	return format === 'markdown' ? `#MD\n${body}` : body;
}
