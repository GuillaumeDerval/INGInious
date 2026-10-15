/**
 * Markdown (CommonMark + GFM tables/strikethrough/autolinks) → HTML
 * (unsanitized) with markdown-it, for content whose course/task sets
 * a `#MD` first line (see #lib/utils/text-format.ts).
 *
 * The output uses the same conventions as the RST renderer so `RichText`
 * treats both alike: fenced code → `<pre class="code <lang> literal-block">`,
 * tables → `table table-bordered` + `thead-light`, math left as `\( \)` /
 * `\[ \]` in `span.math` / `div.math` for KaTeX, and GitHub alerts
 * (`> [!NOTE]`) → the RST admonition alert classes.
 * The output MUST go through sanitize.ts.
 */
import MarkdownIt from 'markdown-it';
import type { StateBlock, StateCore, StateInline, Token } from 'markdown-it';
import { escapeHtml } from '#lib/utils/escape.js';

/** GitHub alert type → RST admonition name + Bootstrap colour (same mapping as RST). */
const ALERTS: Record<string, [string, string]> = {
	NOTE: ['note', 'light'],
	TIP: ['tip', 'info'],
	IMPORTANT: ['important', 'warning'],
	WARNING: ['warning', 'warning'],
	CAUTION: ['caution', 'danger']
};

/** Inline math delimiters: opening → closing. */
const INLINE_MATH: [string, string][] = [
	['\\(', '\\)'],
	['$$', '$$'],
	['$', '$']
];

/**
 * Inline math rule (runs before backslash escapes, which would eat `\(`).
 * Closing delimiters known to be absent are remembered in `state.env` so a
 * text full of unmatched `$` stays linear.
 */
function mathInline(state: StateInline, silent: boolean): boolean {
	const env = state.env as { noClose?: Set<string> };
	const [open, close] = INLINE_MATH.find(([o]) => state.src.startsWith(o, state.pos)) ?? [];
	if (!open || !close || env.noClose?.has(close)) return false;
	const start = state.pos + open.length;
	// `$` must hug its content ("$5 and $6" is not math), like Pandoc.
	if (open === '$' && /\s/.test(state.src[start] ?? ' ')) return false;
	const end = state.src.indexOf(close, start);
	if (end < 0) {
		(env.noClose ??= new Set()).add(close);
		return false;
	}
	if (end === start || (open === '$' && /\s/.test(state.src[end - 1]))) return false;
	if (!silent) state.push('math_inline', '', 0).content = state.src.slice(start, end);
	state.pos = end + close.length;
	return true;
}

/** Block math rule: `$$ … $$` or `\[ … \]` starting a line (possibly on several lines). */
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
	const first = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
	const open = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : null;
	if (!open || state.sCount[startLine] - state.blkIndent >= 4) return false;
	const close = open === '$$' ? '$$' : '\\]';
	const lines = [first.slice(2)];
	let line = startLine;
	while (!lines[lines.length - 1].trimEnd().endsWith(close) || (line === startLine && lines[0].trim() === '')) {
		if (++line >= endLine) return false;
		lines.push(state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]));
	}
	if (silent) return true;
	const body = lines.join('\n').trimEnd();
	state.push('math_block', '', 0).content = body.slice(0, body.length - close.length).trim();
	state.line = line + 1;
	return true;
}

/** Turns `> [!NOTE]` blockquotes into alert divs (core rule on the token stream). */
function alerts(state: StateCore): void {
	const tokens = state.tokens;
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type !== 'blockquote_open' || tokens[i + 2]?.type !== 'inline') continue;
		const inline = tokens[i + 2];
		const match = /^\[!(\w+)\]\s*\n?/.exec(inline.content);
		const alert = match && ALERTS[match[1].toUpperCase()];
		if (!alert) continue;
		inline.content = inline.content.slice(match[0].length);
		// Remove "[!TYPE]" from the first text token; drop it (and the line break after it) when
		// nothing else is on that line (`> [!TIP] text` keeps "text").
		const children = inline.children as Token[];
		children[0].content = children[0].content.replace(/^\[!\w+\]\s*/, '');
		if (!children[0].content) inline.children = children.slice(children[1]?.type === 'softbreak' ? 2 : 1);
		const cls = `admonition ${alert[0]} alert alert-${alert[1]}`;
		tokens[i].tag = 'div';
		tokens[i].attrSet('class', cls);
		// Close the matching blockquote as a div too.
		let depth = 0;
		for (let j = i; j < tokens.length; j++) {
			depth += tokens[j].type === 'blockquote_open' ? 1 : tokens[j].type === 'blockquote_close' ? -1 : 0;
			if (depth === 0) {
				tokens[j].tag = 'div';
				break;
			}
		}
	}
}

/** The configured markdown-it instance (stateless, shared). */
const md = new MarkdownIt({ html: true, linkify: true });
md.inline.ruler.before('escape', 'math_inline', mathInline);
md.block.ruler.before('fence', 'math_block', mathBlock, {
	alt: ['paragraph', 'reference', 'blockquote', 'list']
});
md.core.ruler.push('alerts', alerts);
md.renderer.rules.math_inline = (tokens, i) => `<span class="math">\\(${escapeHtml(tokens[i].content)}\\)</span>`;
md.renderer.rules.math_block = (tokens, i) => `<div class="math">\n\\[${escapeHtml(tokens[i].content)}\\]\n</div>\n`;
md.renderer.rules.fence = (tokens, i) => {
	const lang = tokens[i].info.trim().split(/\s+/)[0];
	return `<pre class="code ${lang ? escapeHtml(lang) + ' ' : ''}literal-block">\n${escapeHtml(tokens[i].content.replace(/\n$/, ''))}\n</pre>\n`;
};
md.renderer.rules.code_block = (tokens, i) =>
	`<pre class="literal-block">\n${escapeHtml(tokens[i].content.replace(/\n$/, ''))}\n</pre>\n`;
md.renderer.rules.table_open = () => '<table class="table table-bordered">\n';
md.renderer.rules.thead_open = () => '<thead class="thead-light">\n';

md.renderer.rules.heading_open = (tokens, i, _opts, env) => `<${shift(tokens[i].tag, (env as { base: number }).base)}>`;
md.renderer.rules.heading_close = (tokens, i, _opts, env) =>
	`</${shift(tokens[i].tag, (env as { base: number }).base)}>\n`;

/** Shifts a heading tag so that `#` becomes `h<base>` (like RST sections), at most h6. */
function shift(tag: string, base: number): string {
	return `h${Math.min(6, Number(tag.slice(1)) + base - 1)}`;
}

/** Renders Markdown to (unsanitized) HTML; `#` titles start at `h<headerLevel>`. */
export function markdownToHtml(source: string, headerLevel: number): string {
	return md.render(source, { base: headerLevel });
}
