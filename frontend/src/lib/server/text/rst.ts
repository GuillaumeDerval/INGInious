/**
 * reStructuredText → HTML (unsanitized), compatible with the legacy docutils
 * output of `legacy/inginious/frontend/parsable_text.py` (TASK-*, COURSE-*,
 * feedback rendering; spec: docs/reference/rst-rendering.md).
 *
 * Parsing is done by `rst-compiler` (pure TypeScript). Its HTML generators
 * pretty-print a Sphinx-like markup, so EVERY generator is replaced here by a
 * docutils `html4css1`-compatible one, including the INGInious overrides
 * (§9.2): Bootstrap admonitions, `container` without the `container` class,
 * `table table-bordered` + `thead-light`, `<code>` literals, `:time:`,
 * `hidden-until`, emptiable `code-block`, disabled `include`, swallowed
 * docinfo, sections starting at `h3`, math left as `\( \)` for KaTeX.
 *
 * Problems are reported inline as docutils "System Message" divs; a SEVERE
 * problem (inconsistent title levels) throws, and the caller (index.ts) shows
 * the "Parsing failed" fallback. The output MUST go through sanitize.ts.
 */
import {
	RstToHtmlCompiler,
	type RstGeneratorState,
	type RstNode,
	type RstNodeMap,
	type RstDirective,
	type RstInterpretedText,
	type RstDirectiveGenerator,
	type RstInterpretedTextGenerator
} from 'rst-compiler';
import { escapeHtml } from '#lib/utils/escape.js';
import { t } from '#lib/i18n/index.js';
import { parseDate, toIsoString } from './dates.js';

/** Rendering options understood by the RST writer. */
export interface RstOptions {
	/** Reveal `hidden-until` blocks (course staff), with a caution message. */
	showEverything: boolean;
	/** HTML level of the first section title (3 by default, 2 for static pages). */
	headerLevel: number;
	/** Current time, compared with `hidden-until` dates. */
	now: Date;
}

/** Shorthand for the generator state. */
type S = RstGeneratorState;

/** Admonition class → Bootstrap colour (legacy `visit_admonition` converter). */
const ADMONITION_COLORS: Record<string, string> = Object.fromEntries(
	(
		'danger:danger attention:warning caution:warning error:danger hint:info important:warning note:default ' +
		'tip:info warning:warning success:success info:info primary:primary secondary:secondary light:light dark:dark'
	)
		.split(' ')
		.map((pair) => pair.split(':'))
);

/** Specific admonition directives registered by INGInious (no `info`/`seealso`). */
const ADMONITIONS = 'attention caution danger error hint important note tip warning'.split(' ');

/** Directives kept from rst-compiler as-is. */
const LIBRARY_DIRECTIVES = ['meta', 'rubric'];

/** Directives whose first line is an argument rather than body text. */
const INIT_CONTENT_DIRECTIVES = 'hidden-until container role include sourcecode compound'.split(' ');

/** rst-compiler enumerated list type → docutils class. */
const LIST_TYPES: Record<string, string> = {
	Arabic: 'arabic',
	AlphabetLower: 'loweralpha',
	AlphabetUpper: 'upperalpha',
	RomanLower: 'lowerroman',
	RomanUpper: 'upperroman'
};

/** Thrown for docutils SEVERE problems: the whole render falls back. */
export class SevereRstError extends Error {}

/** Docutils `make_id`: lowercase, non-alphanumerics → '-'. */
function makeId(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * Builds ` class=".." id=".."` from the given classes, the node's `.. class::`
 * classes (inserted at `at`, first by default, like docutils) and resolved id.
 */
function attrs(s: S, node: RstNode | null, classes: string[] = [], extra = '', at = 0): string {
	const id = node ? s.htmlAttrResolver.getNodeHtmlId(node) : null;
	const own = node ? s.htmlAttrResolver.getNodeHtmlClasses(node) : [];
	// docutils `starttag` de-duplicates classes, keeping the first occurrence.
	const all = [...new Set([...classes.slice(0, at), ...own, ...classes.slice(at)].filter(Boolean))];
	return (all.length ? ` class="${escapeHtml(all.join(' '))}"` : '') + (id ? ` id="${escapeHtml(id)}"` : '') + extra;
}

/** Writes `<tag attrs>` children `</tag>`. */
function wrap(s: S, tag: string, node: RstNode | null, classes: string[], children: () => void, extra = ''): void {
	s.writeText(`<${tag}${attrs(s, node, classes, extra)}>`);
	children();
	s.writeText(`</${tag}>\n`);
}

/** Visits block children. */
function kids(s: S, nodes: readonly RstNode[]): void {
	s.visitNodes(nodes);
}

/** Option value of a directive (`:name: value`), or null. */
function opt(node: Pick<RstDirective, 'config'>, name: string): string | null {
	return node.config?.getField(name) ?? null;
}

/** `:class:` option of a directive split into class names. */
function classOpt(node: Pick<RstDirective, 'config'>): string[] {
	return (opt(node, 'class') ?? '').split(/\s+/).filter(Boolean);
}

/** Children that produce visible output (docutils ignores `Invisible` nodes). */
function visible(nodes: readonly RstNode[]): RstNode[] {
	return nodes.filter((n) => n.willRenderVisibleContent);
}

/**
 * docutils `SimpleListChecker`: a list is "simple" when each item holds at most
 * one paragraph (optionally followed by a nested list). Its paragraphs are then
 * rendered without `<p>` and the list gets the `simple` class.
 */
function isSimpleList(list: RstNode): boolean {
	return list.children.every((item) => {
		const c = visible(item.children);
		if (c.length > 1 && c[0].nodeType === 'Paragraph' && /List$/.test(c[c.length - 1].nodeType)) c.pop();
		return c.length <= 1 && (c.length === 0 || c[0].nodeType === 'Paragraph');
	});
}

/** Simple lists cache (they are checked once per list, from each paragraph). */
const simpleLists = new WeakMap<RstNode, boolean>();

/** True when the list is simple (cached). */
function isSimple(list: RstNode): boolean {
	if (!simpleLists.has(list)) simpleLists.set(list, isSimpleList(list));
	return simpleLists.get(list) as boolean;
}

/** `simple` class of a list, omitted for lists nested in a simple list (html4css1 `compact_simple`). */
function simpleClass(list: RstNode): string {
	const outer = list.parent?.nodeType === 'BulletListItem' ? list.parent.parent : null;
	return isSimple(list) && !(outer && isSimple(outer)) ? 'simple' : '';
}

/**
 * html4css1 `should_be_compact_paragraph`: a paragraph without classes that is
 * the first visible child of a non-document parent is rendered without `<p>`
 * inside a simple list (`compact_simple`), or when it is alone in its parent
 * unless it is inside a non-simple list (lists reset `compact_p`, tables set it).
 */
function isCompact(s: S, node: RstNode): boolean {
	const parent = node.parent;
	if (!parent || /^(Document|Section)$/.test(parent.nodeType) || s.htmlAttrResolver.getNodeHtmlClasses(node).length)
		return false;
	if (parent.nodeType === 'Directive' && (parent as RstDirective).directive === 'hidden-until') return false;
	const siblings = visible(
		parent.nodeType === 'DefinitionListItem' ? (parent as RstNodeMap['DefinitionListItem']).definition : parent.children
	);
	if (siblings[0] !== node) return false;
	let scope: RstNode | null = parent;
	while (scope && !/^(BulletList|EnumeratedList|Table)$/.test(scope.nodeType)) scope = scope.parent;
	if (scope && scope.nodeType !== 'Table') return isSimple(scope);
	return siblings.length === 1;
}

/** Builds a docutils system message (level 2 = WARNING, 3 = ERROR). */
function systemMessage(level: 2 | 3, line: number, message: string, literal?: string): string {
	const title = `System Message: ${level === 2 ? 'WARNING' : 'ERROR'}/${level} (<tt class="docutils">&lt;string&gt;</tt>, line ${line})`;
	const body =
		literal === undefined
			? escapeHtml(message)
			: `<p>${escapeHtml(message)}</p>\n<pre class="literal-block">\n${escapeHtml(literal)}\n</pre>\n`;
	return `<div class="system-message">\n<p class="system-message-title">${title}</p>\n${body}</div>\n`;
}

/** System messages raised by inline nodes, written after the enclosing block (like docutils). */
const pendingMessages = new WeakMap<S, string[]>();

/** Writes the pending inline system messages. */
function flushMessages(s: S): void {
	s.writeText((pendingMessages.get(s) ?? []).join(''));
	pendingMessages.delete(s);
}

/** Error message echoing the directive source, like docutils `self.error(...)`. */
function directiveError(s: S, node: RstDirective, message: string, level: 2 | 3 = 3): void {
	s.writeText(systemMessage(level, node.source.startLineIdx + 1, message, directiveSource(s, node)));
}

/** docutils error for a directive without its required body. */
function noContent(s: S, node: RstDirective): void {
	directiveError(s, node, `Content block expected for the "${node.directive}" directive; none found.`);
}

/** Source lines of the directive, dedented (shown in error messages). */
function directiveSource(s: S, node: RstDirective): string {
	const lines = linesOf(s, node.source.startLineIdx, node.source.endLineIdx);
	const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
	return lines
		.map((l) => l.slice(indent))
		.join('\n')
		.replace(/\s+$/, '');
}

/** Source lines of each parsed document (used by error messages). */
const sourceLines = new WeakMap<RstNode, string[]>();

/** Source lines [from, to) of the document being rendered. */
function linesOf(s: S, from: number, to: number): string[] {
	return (sourceLines.get(s.root) as string[]).slice(from, to);
}

/** A table cell: RST content (`node`) or plain text (csv-table). */
type Cell = { node?: RstNode; text?: string; rowspan: number; colspan: number };

/** Plain-text cells of a csv-table row. */
function textCells(row: string[]): Cell[] {
	return row.map((text) => ({ text, rowspan: 1, colspan: 1 }));
}

/** Renders a table (grid/simple tables, list-table, csv-table) the html4css1 way. */
function table(s: S, node: RstNode, rows: Cell[][], head: number, widths: number[], caption?: () => void): void {
	const total = widths.reduce((a, b) => a + b, 0);
	s.writeText(`<table${attrs(s, node, ['docutils', 'table', 'table-bordered'])}>\n`);
	if (caption) {
		s.writeText('<caption>');
		caption();
		s.writeText('</caption>\n');
	}
	s.writeText(
		`<colgroup>\n${widths.map((w) => `<col width="${Math.floor((w * 100) / total + 0.5)}%" />\n`).join('')}</colgroup>\n`
	);
	const section = (tag: string, cell: string, part: typeof rows) => {
		if (!part.length) return;
		s.writeText(tag === 'thead' ? '<thead class="thead-light">\n' : '<tbody>\n');
		for (const row of part) {
			s.writeText('<tr>');
			for (const c of row) {
				const span = c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : '';
				const cols = c.colspan > 1 ? ` colspan="${c.colspan}"` : '';
				s.writeText(`<${cell}${cell === 'th' ? ' class="head"' : ''}${cols}${span}>`);
				if (c.node) kids(s, c.node.children);
				else s.writeText(escapeHtml(c.text));
				s.writeText(`</${cell}>\n`);
			}
			s.writeText('</tr>\n');
		}
		s.writeText(`</${tag}>\n`);
	};
	section('thead', 'th', rows.slice(0, head));
	section('tbody', 'td', rows.slice(head));
	s.writeText('</table>\n');
}

/** Table caption from the directive argument (plain text). */
function caption(s: S, node: RstDirective): (() => void) | undefined {
	return node.initContentText ? () => s.writeText(escapeHtml(node.initContentText)) : undefined;
}

/** Column widths from the `:widths:` option, else equal columns. */
function optionWidths(node: RstDirective, count: number): number[] {
	const given = (opt(node, 'widths') ?? '')
		.split(/[\s,]+/)
		.map(Number)
		.filter((n) => n > 0);
	return given.length === count ? given : Array<number>(count).fill(1);
}

/** Minimal CSV line parser (quotes with doubled-quote escaping) for `csv-table`. */
function parseCsv(text: string): string[][] {
	return text
		.split('\n')
		.filter((l) => l.trim())
		.map((line) =>
			[...line.matchAll(/\s*(?:"((?:[^"]|"")*)"|([^,]*))\s*(?:,|$)/g)].slice(0, -1).map((m) =>
				String(m[1] ?? m[2])
					.replace(/""/g, '"')
					.trim()
			)
		);
}

/** Renders a Bootstrap alert/card admonition (legacy `visit_admonition`). */
function admonition(s: S, node: RstDirective, classes: string[], body: () => void): void {
	const color = classes.map((c) => ADMONITION_COLORS[c.replace(/^admonition-/, '')]).find(Boolean) ?? 'info';
	const title = opt(node, 'title');
	const cls = ['admonition', ...classes];
	if (title) {
		const header = `bg-${color}${['default', 'light', 'secondary'].includes(color) ? '' : ' text-white'}`;
		s.writeText(`<div${attrs(s, node, [...cls, 'card', 'mb-3', `border-${color}`])}>\n`);
		s.writeText(`<div${attrs(s, null, [...cls, 'card-header', ...header.split(' ')])}>\n${escapeHtml(title)}</div>\n`);
		wrap(s, 'div', null, [...cls, 'card-body'], body);
		s.writeText('</div>\n');
	} else {
		s.writeText(`<div${attrs(s, node, [...cls, 'alert', `alert-${color === 'default' ? 'light' : color}`])}>\n`);
		body();
		s.writeText('</div>\n');
	}
}

/** hidden-until messages (legacy msgids, translated by the catalogs). */
const STUDENT_HIDDEN =
	'A part of this feedback is hidden until {}. Please come back later and reload the submission to see the full feedback.';
const STAFF_HIDDEN = 'The feedback below will be hidden to the students until :time:`{}`.';

/** Renders the `hidden-until` directive (legacy `HiddenUntilDirective`). */
function hiddenUntil(s: S, node: RstDirective, o: RstOptions): void {
	const raw = node.initContentText.trim();
	const date = parseDate(raw);
	if (!date) {
		// The error quotes the directive source to course staff only: students get its first line, never the body.
		const source = directiveSource(s, node);
		const shown = o.showEverything ? source : source.split('\n')[0];
		const message = `Unknown date format in the "hidden-until" directive; ${raw}`;
		return void s.writeText(systemMessage(3, node.source.startLineIdx + 1, message, shown));
	}
	if (!visible(node.children).length) return noContent(s, node);
	const iso = toIsoString(date);
	const caution = (html: string) =>
		s.writeText(`<div class="admonition caution alert alert-warning">\n${html}</div>\n`);
	const passed = date.getTime() <= o.now.getTime();
	if (!passed && !o.showEverything) return caution(escapeHtml(t(STUDENT_HIDDEN, iso)));
	// The translated staff message contains the RST role ":time:`{}`": render it as <time>.
	const staff = escapeHtml(t(STAFF_HIDDEN, iso));
	if (!passed) caution(staff.replace(/:time:`([^`]*)`/, (_, d) => `<time datetime="${d}">\n${d}</time>`));
	wrap(s, 'div', node, ['compound'], () => kids(s, node.children));
}

/** Directive-like nodes carrying an argument and options (directives, substitution definitions). */
type DirectiveLike = Pick<RstDirective, 'initContentText' | 'config' | 'children'>;

/** Builds the `<img>` of an image directive / substitution (`alt` defaults to the URI). */
function imgTag(node: DirectiveLike, alt: string, figure = false): string {
	const src = node.initContentText.trim();
	const style = ['width', 'height']
		.filter((k) => opt(node, k))
		.map((k) => `${k}: ${opt(node, k)};`)
		.join(' ');
	const align = opt(node, 'align');
	const cls = [...classOpt(node), ...(align && !figure ? [`align-${align}`] : [])];
	const img = `<img alt="${escapeHtml(opt(node, 'alt') ?? alt)}"${cls.length ? ` class="${escapeHtml(cls.join(' '))}"` : ''} src="${escapeHtml(src)}"${style ? ` style="${escapeHtml(style)}"` : ''} />`;
	const target = opt(node, 'target');
	return target ? `<a class="reference external image-reference" href="${escapeHtml(target)}">\n${img}\n</a>` : img;
}

/** Renders an `.. image::` or a `.. figure::` (image + caption + legend). */
function image(s: S, node: RstDirective, figure: boolean): void {
	const img = imgTag(node, node.initContentText.trim(), figure);
	if (!figure) return s.writeText(img + '\n');
	const align = opt(node, 'align');
	s.writeText(`<div class="figure${align ? ` align-${escapeHtml(align)}` : ''}">\n${img}\n`);
	const [caption, ...legend] = node.children;
	if (caption) wrap(s, 'p', null, ['caption'], () => kids(s, caption.children));
	if (legend.length) wrap(s, 'div', null, ['legend'], () => kids(s, legend));
	s.writeText('</div>\n');
}

/** Renders a code block (`code-block`, `code`, `sourcecode`). */
function codeBlock(s: S, node: RstDirective): void {
	let code = node.rawBodyText.replace(/^\n+|\s+$/g, '');
	if (!code) {
		// Only `code-block` is "emptiable" in legacy (EmptiableCodeBlock).
		if (node.directive !== 'code-block') return noContent(s, node);
		code = t('[no content]');
	}
	const lang = node.initContentText.trim().split(/\s+/)[0];
	s.writeText(
		`<pre${attrs(s, node, ['code', lang, ...classOpt(node), 'literal-block'], '', lang ? 2 : 1)}>\n${escapeHtml(code)}\n</pre>\n`
	);
}

/** Generators of the INGInious directives, by directive name. */
function directiveGenerators(o: RstOptions): Record<string, (s: S, node: RstDirective) => void> {
	const gens: Record<string, (s: S, node: RstDirective) => void> = {
		admonition: (s, node) => {
			const cls = classOpt(node);
			// docutils adds `admonition-<title>` when no :class: is given.
			admonition(s, node, cls.length ? cls : [`admonition-${makeId(node.initContentText)}`], () =>
				kids(s, node.children)
			);
		},
		'hidden-until': (s, node) => hiddenUntil(s, node, o),
		'code-block': codeBlock,
		code: codeBlock,
		sourcecode: codeBlock,
		container: (s, node) =>
			wrap(s, 'div', node, node.initContentText.trim().split(/\s+/), () => kids(s, node.children)),
		compound: (s, node) => wrap(s, 'div', node, ['compound', ...classOpt(node)], () => kids(s, node.children)),
		class: (s, node) => kids(s, node.children),
		role: () => {},
		math: (s, node) =>
			s.writeText(
				`<div class="math">\n\\begin{equation*}\n${escapeHtml(node.rawBodyText.trim())}\n\\end{equation*}\n</div>\n`
			),
		raw: (s, node) => {
			if (node.initContentText.trim().split(/\s+/).includes('html'))
				s.writeText(node.rawBodyText.replace(/^\n+|\s+$/g, ''));
		},
		image: (s, node) => image(s, node, false),
		figure: (s, node) => image(s, node, true),
		include: (s, node) => directiveError(s, node, '"include" directive disabled.', 2),
		table: (s, node) => {
			const tbl = node.children.find((c) => c.nodeType === 'Table') as RstNodeMap['Table'] | undefined;
			if (!tbl)
				return directiveError(
					s,
					node,
					'Error parsing content block for the "table" directive: exactly one table expected.'
				);
			gridTable(s, tbl, caption(s, node), node);
		},
		'list-table': (s, node) => {
			const list = node.children.find((c) => c.nodeType === 'BulletList');
			if (!list) return directiveError(s, node, 'The "list-table" directive is empty; content required.');
			// Each item holds a nested bullet list: one item per cell.
			const rows = list.children.map((row) =>
				(row.children[0]?.children ?? []).map((cell): Cell => ({
					node: cell,
					rowspan: 1,
					colspan: 1
				}))
			);
			table(s, node, rows, Number(opt(node, 'header-rows') ?? 0), optionWidths(node, rows[0].length), caption(s, node));
		},
		'csv-table': (s, node) => {
			const header = parseCsv(opt(node, 'header') ?? '');
			const rows = [...header, ...parseCsv(node.children.map((c) => c.textContent).join('\n'))].map(textCells);
			if (!rows.length) return directiveError(s, node, 'No table data detected in CSV file.');
			table(s, node, rows, header.length, optionWidths(node, rows[0].length), caption(s, node));
		}
	};
	for (const name of ADMONITIONS) {
		gens[name] = (s, node) => {
			if (!visible(node.children).length) return noContent(s, node);
			// The :class: values come before the type class (legacy ordering).
			admonition(s, node, [...classOpt(node), name], () => {
				const body = visible(node.children);
				// html4css1 `set_first_last`: the last paragraph of a multi-paragraph admonition gets "last".
				body.forEach((child, i) => {
					if (body.length > 1 && i === body.length - 1 && child.nodeType === 'Paragraph') lastParagraphs.add(child);
				});
				kids(s, node.children);
			});
		};
	}
	return gens;
}

/** Paragraphs that must carry the `last` class (see admonitions). */
const lastParagraphs = new WeakSet<RstNode>();

/** Renders a grid/simple table; column widths come from the first row's cell widths. */
function gridTable(s: S, node: RstNodeMap['Table'], caption: (() => void) | undefined, owner: RstNode): void {
	const rows = [...node.headRows, ...node.bodyRows].map((row) => row.children as RstNodeMap['TableCell'][]);
	const first = rows[0];
	// Spanning cells in the first row: fall back to equal widths.
	const widths = first.every((c) => c.colSpan === 1)
		? first.map((c) => c.characterWidth)
		: Array<number>(first.reduce((n, c) => n + c.colSpan, 0)).fill(1);
	table(
		s,
		owner,
		rows.map((row) => row.map((c): Cell => ({ node: c, rowspan: c.rowSpan, colspan: c.colSpan }))),
		node.headRows.length,
		widths,
		caption
	);
}

/** Inline role generators (`:time:`, `:math:`, `:code:`, …). */
function roleGenerators(): Record<string, (s: S, node: RstInterpretedText) => void> {
	const tag = (name: string) => (s: S, node: RstInterpretedText) =>
		s.writeText(`<${name}>${escapeHtml(node.textContent)}</${name}>`);
	return {
		time: (s, node) =>
			s.writeText(`<time datetime="${escapeHtml(node.textContent)}">\n${escapeHtml(node.textContent)}</time>`),
		math: (s, node) => s.writeText(`<span class="math">\\(${escapeHtml(node.rawTextContent)}\\)</span>`),
		code: tag('code'),
		literal: (s, node) => literal(s, node.textContent),
		'title-reference': tag('cite'),
		title: tag('cite'),
		t: tag('cite'),
		emphasis: tag('em'),
		strong: tag('strong'),
		subscript: tag('sub'),
		sub: tag('sub'),
		superscript: tag('sup'),
		sup: tag('sup'),
		abbreviation: tag('abbr'),
		ab: tag('abbr'),
		acronym: tag('acronym'),
		ac: tag('acronym')
	};
}

/** Inline literal (``x``) the legacy way: `<code class="docutils literal">` + `pre` spans. */
function literal(s: S, text: string): void {
	// docutils `words_and_spaces` / `in_word_wrap_point` regexes.
	const body = text.replace(/[^ \n]+| +|\n/g, (tok) => {
		if (tok.trim())
			return /.+[^\p{L}\p{N}_]{2}.+|[-?].+/u.test(tok)
				? `<span class="pre">${escapeHtml(tok)}</span>`
				: escapeHtml(tok);
		return tok === ' ' || tok === '\n' ? tok : '&nbsp;'.repeat(tok.length - 1) + ' ';
	});
	s.writeText(`<code class="docutils literal">${body}</code>`);
}

/** Renders a block list (document body), nesting sections like docutils. */
function documentBody(s: S, nodes: readonly RstNode[], base: number): void {
	const open: number[] = [];
	for (const node of nodes) {
		if (node.nodeType !== 'Section') {
			s.visitNode(node);
			s.writeText('\n');
			flushMessages(s);
			continue;
		}
		const level = (node as RstNodeMap['Section']).level;
		// docutils: an underline shorter than the title and than 4 characters is not a title.
		const [title, underline] = linesOf(s, node.source.startLineIdx, node.source.startLineIdx + 2);
		if (underline !== undefined && underline.trim().length < Math.min(4, title.trim().length)) {
			s.writeText(`<p>${escapeHtml(title)}\n${escapeHtml(underline)}</p>\n`);
			continue;
		}
		while (open.length && open[open.length - 1] >= level) {
			s.writeText('</div>\n');
			open.pop();
		}
		// docutils SEVERE "Title level inconsistent" → whole-document fallback.
		if (level > open.length + 1) throw new SevereRstError('Title level inconsistent');
		open.push(level);
		s.writeText(`<div${attrs(s, node, ['section'])}>\n<h${level + base - 1}>`);
		s.visitNodes(node.children);
		s.writeText(`</h${level + base - 1}>\n`);
	}
	s.writeText('</div>\n'.repeat(open.length));
}

/** Installs the docutils-compatible node generators on a compiler. */
function installNodeGenerators(c: RstToHtmlCompiler, o: RstOptions): void {
	const gen = <T extends keyof RstNodeMap>(nodeType: T, generate: (s: S, node: RstNodeMap[T]) => void) =>
		c.useNodeGenerator({ nodeType, generate } as never);
	const inline = (tagName: string) => (s: S, node: RstNode) =>
		s.writeText(`<${tagName}>${escapeHtml(node.textContent)}</${tagName}>`);
	gen('Document', (s, node) => documentBody(s, node.children, o.headerLevel));
	gen('Section', () => {}); // handled by documentBody
	gen('Transition', (s) => s.writeText('<hr class="docutils" />\n'));
	gen('Paragraph', (s, node) => {
		const text = node.getOutputText(s);
		if (text === null) return;
		if (isCompact(s, node)) return s.writeText(text);
		// html4css1 marks the first child of list items, table cells and definitions.
		const first =
			node.isFirstChild() && /^(BulletListItem|TableCell|DefinitionListItem)$/.test(String(node.parent?.nodeType));
		s.writeText(`<p${attrs(s, node, [first ? 'first' : '', lastParagraphs.has(node) ? 'last' : ''])}>${text}</p>\n`);
		flushMessages(s);
	});
	gen('BulletList', (s, node) => wrap(s, 'ul', node, [simpleClass(node)], () => kids(s, node.children)));
	gen('EnumeratedList', (s, node) => {
		wrap(s, 'ol', node, [LIST_TYPES[node.listType], simpleClass(node)], () => kids(s, node.children));
	});
	gen('BulletListItem', (s, node) => wrap(s, 'li', node, [], () => kids(s, node.children)));
	gen('DefinitionList', (s, node) => wrap(s, 'dl', node, ['docutils'], () => kids(s, node.children)));
	gen('DefinitionListItem', (s, node) => {
		wrap(s, 'dt', node, [], () => {
			s.visitNodes(node.term);
			for (const cl of node.classifiers) {
				s.writeText(' <span class="classifier-delimiter">:</span> <span class="classifier">');
				s.visitNodes(cl);
				s.writeText('</span>');
			}
		});
		wrap(s, 'dd', null, [], () => kids(s, node.definition));
	});
	gen('FieldList', (s, node) => {
		s.writeText(`<table${attrs(s, node, ['docutils', 'field-list'])} frame="void" rules="none">\n`);
		s.writeText('<col class="field-name" />\n<col class="field-body" />\n<tbody valign="top">\n');
		kids(s, node.children);
		s.writeText('</tbody>\n</table>\n');
	});
	gen('FieldListItem', (s, node) => {
		s.writeText('<tr class="field"><th class="field-name">');
		s.visitNodes(node.name);
		s.writeText(':</th><td class="field-body">');
		kids(s, node.body);
		s.writeText('</td>\n</tr>\n');
	});
	const pre = (cls: string) => (s: S, node: RstNode) =>
		s.writeText(`<pre${attrs(s, node, [cls])}>\n${escapeHtml(node.rawTextContent)}\n</pre>\n`);
	gen('LiteralBlock', pre('literal-block'));
	gen('DoctestBlock', pre('doctest-block'));
	gen('LineBlock', (s, node) => wrap(s, 'div', node, ['line-block'], () => s.visitNodes(node.children)));
	gen('LineBlockLine', (s, node) => {
		s.writeText('<div class="line">');
		if (node.children.length) s.visitNodes(node.children);
		else s.writeText('<br />');
		s.writeText('</div>\n');
	});
	gen('Blockquote', (s, node) => {
		// rst-compiler nests one blockquote per 4 columns of indentation; docutils makes only one.
		let inner: RstNode = node;
		while (inner.children.length === 1 && inner.children[0].nodeType === 'Blockquote') inner = inner.children[0];
		wrap(s, 'blockquote', node, [], () => kids(s, inner.children));
	});
	gen('BlockquoteAttribution', (s, node) => {
		s.writeText('<p class="attribution">&mdash;');
		s.visitNodes(node.children);
		s.writeText('</p>\n');
	});
	gen('Table', (s, node) => {
		if (node.headRows.length + node.bodyRows.length) return gridTable(s, node, undefined, node);
		const lines = linesOf(s, node.source.startLineIdx, node.source.endLineIdx);
		s.writeText(systemMessage(3, node.source.startLineIdx + 1, 'Malformed table.', lines.join('\n').trimEnd()));
	});
	gen('FootnoteDefGroup', (s, node) => kids(s, node.children));
	gen('FootnoteDef', (s, node) => {
		// Single reference: the label links back to it (docutils `fn-backref`).
		const [ref, ...more] = s.resolveFootnoteDefBacklinks(node);
		const label = `[${escapeHtml(s.resolveFootnoteDefLabel(node))}]`;
		const backref = ref && !more.length ? `<a class="fn-backref" href="${escapeHtml(ref)}">${label}</a>` : label;
		s.writeText(`<table${attrs(s, node, ['docutils', 'footnote'])} frame="void" rules="none">\n`);
		s.writeText(`<colgroup><col class="label" /><col /></colgroup>\n<tbody valign="top">\n`);
		s.writeText(`<tr><td class="label">${backref}</td><td>`);
		kids(s, node.children);
		s.writeText('</td></tr>\n</tbody>\n</table>\n');
	});
	gen('FootnoteRef', (s, node) => {
		const href = s.resolveNodeToUrl(s.resolveFootnoteDef(node));
		s.writeText(
			`<a class="footnote-reference" href="${escapeHtml(href)}"${attrs(s, node)}>[${escapeHtml(s.resolveFootnoteRefLabel(node))}]</a>`
		);
	});
	const librarySubstitution = c.nodeGenerators.get('SubstitutionRef') as {
		generate: (s: S, node: RstNode) => void;
	};
	gen('SubstitutionRef', (s, node) => {
		const def = s.substitutionResolver.resolveSubstitution(s, node);
		if (def.directive === 'image') return s.writeText(imgTag(def, node.textContent));
		if (def.directive !== 'raw') return librarySubstitution.generate(s, node);
		// `.. |x| raw:: html` (unsupported by rst-compiler): first child = formats, then the raw body.
		const [formats, ...body] = def.children;
		if (formats?.textContent.split(/\s+/).includes('html')) s.writeText(body.map((b) => b.rawTextContent).join('\n'));
	});
	gen('HyperlinkTarget', () => {});
	gen('SubstitutionDef', () => {});
	gen('Comment', () => {});
	gen('Text', text);
	gen('Emphasis', inline('em'));
	gen('StrongEmphasis', inline('strong'));
	gen('InlineLiteral', (s, node) => literal(s, node.textContent));
	gen('InlineInternalTarget', (s, node) =>
		s.writeText(`<span${attrs(s, node, ['target'])}>${escapeHtml(node.textContent)}</span>`)
	);
	gen('HyperlinkRef', (s, node) => {
		const url = s.resolveHyperlinkRefToUrl(node);
		// Embedded URIs and external targets are "external" even when they start with '#'.
		const kind = url.startsWith('#') && !node.isEmbeded ? 'internal' : 'external';
		s.writeText(`<a class="reference ${kind}" href="${escapeHtml(url)}">${escapeHtml(node.label)}</a>`);
	});
}

/** Role generator. */
type RoleGen = (s: S, node: RstInterpretedText) => void;

/**
 * Custom roles declared with `.. role:: name(base)`: `<code class="name">` for
 * `code`, the raw text for `raw` (when `:format:` includes html), else a
 * `<span class="name">` around the base role (or plain text).
 */
function customRoles(root: RstNode, roles: Record<string, RoleGen>): Record<string, RoleGen> {
	const out: Record<string, RoleGen> = {};
	for (const d of root.findAllChildren('Directive').filter((x) => x.directive === 'role')) {
		const [, name, base = ''] = /^\s*([\w.-]+)\s*(?:\(\s*([\w.-]+)\s*\))?/.exec(d.initContentText) ?? [];
		if (!name) continue;
		const cls = `class="${escapeHtml([name, ...classOpt(d)].join(' '))}"`;
		const raw = base === 'raw';
		const inner: RoleGen = raw ? (st, n) => st.writeText(n.rawTextContent) : (roles[base] ?? text);
		out[name] =
			base === 'code'
				? (st, n) => st.writeText(`<code ${cls}>${escapeHtml(n.textContent)}</code>`)
				: (st, n) => {
						if (raw && !` ${opt(d, 'format')} `.includes(' html ')) return;
						st.writeText(`<span ${cls}>`);
						inner(st, n);
						st.writeText('</span>');
					};
	}
	return out;
}

/** Plain escaped text of an inline node. */
const text = (s: S, node: RstNode) => s.writeText(escapeHtml(node.textContent));

/** Border line of a simple or grid table (cells may be indented inside it). */
const TABLE_BORDER = /^ *(=+( +=+)+|\+[-=+]+\+) *$/;

/**
 * rst-compiler expects block quotes and definitions to be indented by exactly
 * `inputIndentSize` (4) columns; docutils accepts any indentation. Before each
 * block parser runs, the option is set to the actual nested indentation of the
 * current (block quote) or next (definition) line — except at a table border,
 * whose cell text may legitimately be indented (e.g. ` A      B`).
 */
function relaxIndentation(c: RstToHtmlCompiler): void {
	c.nodeParsers.forEach((parser, i) => {
		c.nodeParsers[i] = {
			parse: (state, indentSize, ...rest) => {
				const opts = state.opts as { inputIndentSize: number };
				const nested = state.peekTest(TABLE_BORDER)
					? undefined
					: [state.peekIndentSize(0), state.peekIndentSize(1)].find((n) => n > indentSize);
				opts.inputIndentSize = nested === undefined ? 4 : nested - indentSize;
				return parser.parse(state, indentSize, ...rest);
			}
		} as typeof parser;
	});
}

/**
 * Renders RST source to (unsanitized) HTML. Throws on SEVERE problems.
 * The source must already be tab-expanded and size-checked (see index.ts).
 */
export function rstToHtml(source: string, o: RstOptions): string {
	const compiler = new RstToHtmlCompiler();
	installNodeGenerators(compiler, o);
	relaxIndentation(compiler);
	const parsed = compiler.parse(source, {
		disableWarnings: true,
		disableErrors: true,
		directivesWithInitContent: INIT_CONTENT_DIRECTIVES,
		directivesWithRawText: ['sourcecode', 'math']
	});
	sourceLines.set(parsed.root, source.split('\n'));
	const directives = directiveGenerators(o);
	const roles = { ...roleGenerators(), ...customRoles(parsed.root, roleGenerators()) };
	const library = compiler.directiveGenerators;
	// Unknown directives/roles become docutils ERROR system messages instead of exceptions.
	const directiveMap = new Map<string, RstDirectiveGenerator>();
	directiveMap.get = (name: string) => {
		const own = directives[name];
		if (own) return { directives: [name], generate: own };
		if (LIBRARY_DIRECTIVES.includes(name)) return library.get(name);
		return {
			directives: [name],
			generate: (s, node) => directiveError(s, node, `Unknown directive type "${name}".`)
		};
	};
	const roleMap = new Map<string, RstInterpretedTextGenerator>();
	roleMap.get = (name: string) => ({
		roles: [name],
		generate:
			roles[name] ??
			((s, node) => {
				s.writeText(`<span class="problematic">${escapeHtml(`:${name}:\`${node.rawTextContent}\``)}</span>`);
				const message = systemMessage(3, node.source.startLineIdx + 1, `Unknown interpreted text role "${name}".`);
				pendingMessages.set(s, [...(pendingMessages.get(s) ?? []), message]);
			})
	});
	Object.assign(compiler, {
		directiveGenerators: directiveMap,
		interpretedTextGenerators: roleMap
	});
	return compiler.generate(
		{ basePath: '/', currentDocPath: 'index', docs: [{ docPath: 'index', parserOutput: parsed }] },
		{ disableWarnings: true, disableErrors: true }
	).body;
}
