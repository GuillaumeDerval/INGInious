/**
 * Unit tests of the docutils-compatible RST writer (rst.ts) for the constructs
 * not covered by the golden examples: hidden-until variants, roles, images,
 * tables, lists, field/option lists, error messages.
 */
import { describe, expect, it } from 'vitest';
import { renderText, type RenderOptions } from './index.js';
import { rstToHtml, SevereRstError } from './rst.js';

process.env.TZ = 'UTC';

/** Removes insignificant whitespace. */
function normalize(html: string): string {
	return html
		.replace(/\s*(<[^>]+>)\s*/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Renders (and sanitizes) with a fixed clock. */
function html(source: string, options: RenderOptions = {}): string {
	return normalize(renderText(source, { now: new Date('2026-01-01T00:00:00Z'), ...options }));
}

/** Writer output before sanitizing (author classes and ids as written). */
function written(source: string): string {
	return normalize(rstToHtml(source, { showEverything: false, headerLevel: 3, now: new Date(0) }));
}

describe('hidden-until (TASK feedback)', () => {
	const future = '.. hidden-until:: 01/01/2999 10:00\n\n    Secret.';

	it('accepts the European legacy formats', () => {
		expect(html('.. hidden-until:: 01/02/2000\n\n    Visible.')).toBe('<div class="compound"><p>Visible.</p></div>');
		expect(html('.. hidden-until:: 01/02/2000 10:00:05\n\n    Visible.')).toContain('Visible.');
	});

	it('hides future content from students and shows it to staff with a caution', () => {
		expect(html(future)).not.toContain('Secret');
		expect(html(future)).toContain('hidden until 2999-01-01T10:00:00+00:00');
		const staff = html(future, { showEverything: true });
		expect(staff).toContain('<time datetime="2999-01-01T10:00:00+00:00">');
		expect(staff).toContain('<p>Secret.</p>');
	});

	it('reports an unparseable date without revealing the body to students', () => {
		const bad = '.. hidden-until:: notadate\n\n    Secret.';
		expect(html(bad)).toContain('Unknown date format in the "hidden-until" directive; notadate');
		expect(html(bad)).not.toContain('Secret');
		expect(html(bad, { showEverything: true })).toContain('Secret.');
	});

	it('reports a missing body as an error', () => {
		expect(html('.. hidden-until:: 01/02/2000')).toContain('Content block expected for the "hidden-until" directive');
	});

	it('is re-rendered when the time changes (cache key per minute)', () => {
		const later = renderText(future, { now: new Date('3000-01-01T00:00:00Z') });
		expect(later).toContain('Secret.');
		expect(renderText(future, { now: new Date('2026-01-01T00:00:00Z') })).not.toContain('Secret.');
	});
});

describe('directives', () => {
	it('renders code blocks with classes, and errors on empty `code`', () => {
		expect(written('.. class:: foo\n\n.. code-block:: python\n\n    x = 1')).toBe(
			'<pre class="code python foo literal-block">x = 1</pre>'
		);
		expect(written('.. code-block:: c\n   :class: extra\n\n   y')).toBe(
			'<pre class="code c extra literal-block">y</pre>'
		);
		expect(html('.. code:: c')).toContain('Content block expected for the "code" directive');
	});

	it('renders images, targets, alignment and figures with legends', () => {
		expect(written('.. image:: a.png\n   :height: 10px\n   :align: center\n   :class: big')).toBe(
			'<img alt="a.png" class="big align-center" src="a.png" style="height: 10px;" />'
		);
		const figure = html('.. figure:: a.png\n   :align: right\n\n   Caption.\n\n   Legend.');
		expect(figure).toBe(
			'<div class="figure align-right"><img alt="a.png" src="a.png" /><p class="caption">Caption.</p><div class="legend"><p>Legend.</p></div></div>'
		);
		expect(html('.. figure:: b.png')).toBe('<div class="figure"><img alt="b.png" src="b.png" /></div>');
		expect(html('An |icon| here.\n\n.. |icon| image:: i.png')).toBe('<p>An<img alt="icon" src="i.png" />here.</p>');
	});

	it('renders raw HTML only for the html format', () => {
		expect(html('.. raw:: latex\n\n    \\LaTeX')).toBe('');
		expect(html('|x| ok\n\n.. |x| raw:: latex\n\n    nope')).toBe('<p>ok</p>');
	});

	it('renders compound, container without class and rubric', () => {
		expect(html('.. compound::\n\n    a\n\n    b')).toBe('<div class="compound"><p>a</p><p>b</p></div>');
		// Rare docutils directives without an INGInious use are reported, not rendered.
		expect(html('.. topic:: T\n\n    body')).toContain('Unknown directive type "topic".');
		expect(html('.. container::\n\n    inside')).toBe('<div>inside</div>');
	});

	it('keeps the admonition-<title> class of a generic admonition without :class:', () => {
		expect(html('.. admonition:: My Title\n\n    body')).toBe(
			'<div class="admonition admonition-my-title alert alert-info">body</div>'
		);
	});

	it('renders titled light cards without text-white', () => {
		expect(html('.. note::\n    :title: T\n\n    b')).toContain('card-header bg-default"');
	});

	it('renders list and csv tables with widths and captions', () => {
		const list = html('.. list-table::\n   :widths: 1 3\n\n   * - a\n     - b');
		expect(list).toContain('<col width="25%" /><col width="75%" />');
		expect(list).not.toContain('thead');
		const csv = html('.. csv-table:: Cap\n   :header: "x, y", z\n\n   1, "say ""hi"""');
		expect(csv).toContain('<caption>Cap</caption>');
		expect(csv).toContain('<th class="head">x, y</th>');
		expect(csv).toContain('<td>say "hi"</td>');
		expect(html('.. table:: Named\n\n   ===  ===\n   a    b\n   ===  ===')).toContain('<caption>Named</caption>');
	});

	it('renders spanning grid cells with equal column widths', () => {
		const grid = '+-----+-----+\n| wide      |\n+=====+=====+\n| 1   | 2   |\n+-----+-----+';
		const out = html(grid);
		expect(out).toContain('<th class="head" colspan="2">wide</th>');
		expect(out).toContain('<col width="50%" />');
	});

	it('renders row spans and reports empty table directives', () => {
		const grid = '+---+---+\n| a | b |\n+   +---+\n|   | c |\n+---+---+';
		expect(html(grid)).toContain('<td rowspan="2">a</td>');
		expect(html('.. table:: T\n\n   just text')).toContain('exactly one table expected');
		expect(html('.. list-table:: T')).toContain('The "list-table" directive is empty');
		expect(html('.. csv-table:: T')).toContain('No table data detected');
		expect(html('.. csv-table::\n\n   a, b\n   c, d')).toBe(
			'<table class="docutils table table-bordered"><colgroup><col width="50%" /><col width="50%" /></colgroup><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>'
		);
	});

	it('reports unknown directives and keeps going', () => {
		expect(html('.. toctree::\n\nafter')).toContain('Unknown directive type "toctree".');
		expect(html('.. toctree::\n\nafter')).toContain('<p>after</p>');
	});

	it('keeps library directives such as rubric', () => {
		expect(html('.. rubric:: Heading')).toContain('Heading');
	});
});

describe('roles', () => {
	it('renders the standard roles', () => {
		const out = html(
			':emphasis:`e` :strong:`s` :sub:`b` :sup:`p` :abbreviation:`a` :ac:`c` :title:`t` :literal:`a  b` :code:`x`'
		);
		expect(out).toBe(
			'<p><em>e</em><strong>s</strong><sub>b</sub><sup>p</sup><abbr>a</abbr><acronym>c</acronym><cite>t</cite><code class="docutils literal">a b</code><code>x</code></p>'
		);
		// Runs of spaces are kept with non-breaking spaces (normalized away above).
		expect(renderText('``a  b``')).toContain('a\u00a0 b');
		expect(html(':t:`a` :ab:`b` :acronym:`c` :subscript:`d` :superscript:`e` :title-reference:`f`')).toContain(
			'<cite>f</cite>'
		);
	});

	it('renders custom roles based on raw, code, other roles or nothing', () => {
		const src =
			'.. role:: html(raw)\n   :format: html\n\n.. role:: tex(raw)\n   :format: latex\n\n.. role:: py(code)\n\n.. role:: big(strong)\n\n.. role:: plain\n\n.. role:: odd(unknownbase)\n\n.. role:: noformat(raw)\n\n';
		const out = written(src + ':html:`<b>x</b>` :tex:`y` :py:`z` :big:`w` :plain:`v` :odd:`u` :noformat:`t`');
		expect(out).toBe(
			'<p><span class="html"><b>x</b></span><code class="py">z</code><span class="big"><strong>w</strong></span><span class="plain">v</span><span class="odd">u</span></p>'
		);
		expect(html('.. role:: !!!\n\ntext')).toBe('<p>text</p>');
	});

	it('reports unknown roles', () => {
		expect(html(':nope:`x`')).toContain('Unknown interpreted text role "nope".');
	});
});

describe('lists and blocks', () => {
	it('renders non-simple lists with <p class="first">', () => {
		expect(html('- a\n\n  b\n- c')).toBe(
			'<ul><li><p class="first">a</p><p>b</p></li><li><p class="first">c</p></li></ul>'
		);
	});

	it('renders enumerated list types', () => {
		expect(html('a. x\nb. y')).toContain('<ol class="loweralpha simple">');
		expect(html('I. x\nII. y')).toContain('<ol class="upperroman simple">');
	});

	it('renders definition lists with classifiers', () => {
		expect(html('term : cls\n    def')).toBe(
			'<dl class="docutils"><dt>term<span class="classifier-delimiter">:</span><span class="classifier">cls</span></dt><dd>def</dd></dl>'
		);
	});

	it('renders field lists (not at the top) and option lists', () => {
		expect(html('text\n\n:name: value')).toContain(
			'<tr class="field"><th class="field-name">name:</th><td class="field-body">value</td></tr>'
		);
		const options = html('-a         all\n--file=F   file\n-v VALUE   value');
		// Option lists and citations use the rst-compiler markup (no INGInious content uses them).
		expect(options).toContain('-a');
		expect(options).toContain('value');
	});

	it('renders line blocks with empty lines, attributions, citations and transitions', () => {
		expect(html('| a\n|\n| b')).toBe(
			'<div class="line-block"><div class="line">a</div><div class="line"><br /></div><div class="line">b</div></div>'
		);
		expect(html('para\n\n    quote\n\n    -- Author')).toContain('<p class="attribution">—Author</p>');
		expect(html('See [CIT]_.\n\n.. [CIT] Ref.')).toContain('Ref.');
		expect(html('a\n\n.. _t:\n\nb `x`_\n\n.. _x: https://x.org\n\nc _`inline` d')).toContain(
			'<span class="target" id="rt-inline">inline</span>'
		);
	});

	it('drops a lone "::" paragraph before a literal block and lists unreferenced footnotes', () => {
		expect(html('::\n\n    code')).toBe('<pre class="literal-block">code</pre>');
		expect(html('Para ::\n\n    code')).toBe('<p>Para</p><pre class="literal-block">code</pre>');
		expect(html('.. [1] Alone.')).toContain('<td class="label">[1]</td>');
	});

	it('handles text with entities and comments', () => {
		expect(html('a &amp; b\n\n.. a comment')).toBe('<p>a &amp;amp; b</p>');
		expect(html('|r| x\n\n.. |r| replace:: *rep*')).toBe('<p><em>rep</em>x</p>');
	});

	it('handles short underlines and odd indentation like docutils', () => {
		expect(html('Ab\n=\n\ntext')).toBe('<p>Ab =</p><p>text</p>');
		expect(html('para\n\n      deep\n         deeper')).toContain('<blockquote>');
	});
});

describe('errors', () => {
	it('throws on inconsistent title levels', () => {
		expect(() =>
			rstToHtml('A\n===\n\nB\n---\n\nC\n===\n\nD\n~~~', {
				showEverything: false,
				headerLevel: 3,
				now: new Date()
			})
		).toThrow(SevereRstError);
	});

	it('reports a malformed table', () => {
		expect(html('+---+\n| a |\n+--')).toContain('Malformed table.');
	});
});
