/**
 * Unit tests of the HTML sanitizer (sanitize.ts): class allow-list, prefixed
 * ids/names and in-document links, inline style restrictions.
 */
import { describe, expect, it } from 'vitest';
import { ID_PREFIX, sanitize } from './sanitize.js';
import { renderText } from './index.js';

describe('TASK-19 class allow-list', () => {
	it('keeps the renderer, docutils and Bootstrap classes, prefixes the others', () => {
		expect(sanitize('<div class="fixed inset-0 z-50 bg-white card-body">x</div>')).toBe(
			'<div class="rt-fixed rt-inset-0 rt-z-50 rt-bg-white card-body">x</div>'
		);
		expect(sanitize('<div class="row"><div class="col-md-6 col-12 col-13">a</div></div>')).toBe(
			'<div class="row"><div class="col-md-6 col-12 rt-col-13">a</div></div>'
		);
		expect(sanitize('<p class="alert alert-danger bg-info border-dark text-center admonition-my-title">a</p>')).toBe(
			'<p class="alert alert-danger bg-info border-dark text-center admonition-my-title">a</p>'
		);
		expect(sanitize('<i class="fa fa-edit hljs-keyword katex">a</i>')).toBe(
			'<i class="fa fa-edit hljs-keyword katex">a</i>'
		);
		expect(sanitize('<span class=" hidden  absolute ">a</span><b class="">b</b>')).toBe(
			'<span class="rt-hidden rt-absolute">a</span><b>b</b>'
		);
	});

	it('accepts code languages only on code blocks and inline code', () => {
		expect(sanitize('<pre class="code python3 Java cpp sticky literal-block">x</pre>')).toBe(
			'<pre class="code python3 Java cpp rt-sticky literal-block">x</pre>'
		);
		expect(sanitize('<code class="py">x</code><span class="python">y</span>')).toBe(
			'<code class="py">x</code><span class="rt-python">y</span>'
		);
		expect(renderText('.. code-block:: ocaml\n\n    let x = 1')).toContain('class="code ocaml literal-block"');
	});
});

describe('TASK-19 ids and names', () => {
	it('prefixes ids, names, ARIA references and the in-document links', () => {
		expect(
			sanitize('<a name="top" href="#top">a</a><a href="#">b</a><p id="x" aria-describedby="x y" aria-label="l">c</p>')
		).toBe(
			`<a name="${ID_PREFIX}top" href="#${ID_PREFIX}top">a</a><a href="#">b</a>` +
				`<p id="${ID_PREFIX}x" aria-describedby="${ID_PREFIX}x ${ID_PREFIX}y" aria-label="l">c</p>`
		);
	});

	it('keeps footnotes and section links pointing to their target', () => {
		const html = renderText('Title\n=====\n\nSee [#]_ and `Title`_.\n\n.. [#] Note.');
		const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
		const targets = [...html.matchAll(/ href="#([^"]+)"/g)].map((m) => m[1]);
		expect(targets.length).toBeGreaterThanOrEqual(3);
		for (const target of targets) expect(ids).toContain(target);
		expect(ids.every((id) => id.startsWith(ID_PREFIX))).toBe(true);
	});
});

describe('TASK-19 inline styles', () => {
	it('drops positioning, stacking and viewport units', () => {
		expect(
			sanitize(
				'<div style="position:fixed;top:0;left:0;inset:0;z-index:9999;width:100vw;height:100vh;color:red">a</div>'
			)
		).toBe('<div style="color:red">a</div>');
		expect(sanitize('<div style="width:50%;height:3em;font-size:2vw">a</div>')).toBe(
			'<div style="width:50%;height:3em">a</div>'
		);
	});
});
