/**
 * Tests of the rendering entry point (index.ts): formats, fallbacks, limits,
 * timeout, cache, random idiom, LTI rewriting, translation of fixed strings,
 * and the HTML injection vectors of docs/reference/rst-rendering.md §7.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setCatalogGetter } from '#lib/i18n/index.js';
import { MAX_SOURCE_LENGTH, RENDER_TIMEOUT_MS, renderText } from './index.js';

afterEach(() => setCatalogGetter(() => ({})));

describe('renderText', () => {
	it('defaults to RST and supports Markdown', () => {
		expect(renderText('**a**')).toBe('<p><strong>a</strong></p>\n\n');
		expect(renderText('#MD\n# T')).toBe('<h3>T</h3>\n');
		expect(renderText('#MD\n# T', { headerLevel: 2 })).toBe('<h2>T</h2>\n');
		expect(renderText('Title\n=====\n\nx', { headerLevel: 2 })).toContain('<h2>Title</h2>');
	});

	it('handles empty and non-string sources gracefully', () => {
		expect(renderText('')).toBe('');
		expect(renderText('   \n')).toBe('');
		expect(renderText(null)).toBe('');
		expect(renderText(undefined)).toBe('');
		expect(renderText(42)).toContain('<p>42</p>');
	});

	it('falls back to the escaped source on SEVERE errors, translated', () => {
		const source = 'A\n===\n\nB\n---\n\nC\n===\n\nD\n~~~\n<x>';
		expect(renderText(source)).toBe(`<b>Parsing failed</b>: <pre>${source.replace('<x>', '&lt;x&gt;')}</pre>`);
		setCatalogGetter(() => ({
			'<b>Parsing failed</b>: <pre>{}</pre>': "<b>L'analyse a échoué</b> : <pre>{}</pre>"
		}));
		expect(renderText(source + ' ')).toContain("L'analyse a échoué");
	});

	it('translates [no content] with the current catalog', () => {
		setCatalogGetter(() => ({ '[no content]': '[pas de contenu]' }));
		expect(renderText('.. code-block:: java', { language: 'fr' })).toContain('[pas de contenu]');
	});

	it('refuses sources above the size limit', () => {
		const html = renderText('a'.repeat(MAX_SOURCE_LENGTH + 1));
		expect(html).toContain('Parsing failed');
		expect(html.length).toBeLessThan(20_000);
	});

	it('interrupts pathological inputs (ReDoS) after the timeout', () => {
		const start = Date.now();
		expect(renderText('|a '.repeat(20000))).toContain('Parsing failed');
		expect(Date.now() - start).toBeLessThan(5000);
	}, 10_000);

	/** Renders an empty code block: its "[no content]" text reveals which catalog was used. */
	const probe = (n: string | number, options = {}) => renderText(`.. code-block:: java${n}`, options);
	const french = () => setCatalogGetter(() => ({ '[no content]': '[pas de contenu]' }));

	it('caches results, except time-dependent and LTI renders', () => {
		probe(1);
		french();
		expect(probe(1)).toContain('[no content]'); // cached
		expect(probe(1, { language: 'fr' })).toContain('[pas de contenu]'); // other key
		expect(probe(1, { ltiAssetRewrite: (u: string) => u })).toContain('[pas de contenu]'); // not cached
	});

	it('caches hidden-until texts per minute of `now` (never revealed early)', () => {
		const text = '.. hidden-until:: 2000-01-01\n\n    .. code-block:: c';
		const now = new Date('2026-01-01T10:00:05Z');
		renderText(text, { now });
		french();
		expect(renderText(text, { now: new Date('2026-01-01T10:00:55Z') })).toContain('[no content]'); // same minute
		expect(renderText(text, { now: new Date('2026-01-01T10:01:00Z') })).toContain('[pas de contenu]');
	});

	it('a pathological input blocks the event loop at most the render budget (sanitization included)', () => {
		const timed = (source: string) => {
			const start = performance.now();
			const html = renderText(source);
			return { html, ms: performance.now() - start };
		};
		// Deep nesting at the size limit (sanitize-html took ≈10 s on 1 MB before the fix). The
		// margins absorb CPU contention when the whole suite runs in parallel.
		const nested = '.. raw:: html\n\n    ' + '<div><span>'.repeat(Math.floor((MAX_SOURCE_LENGTH - 30) / 11));
		expect(timed(nested).ms).toBeLessThan(2 * RENDER_TIMEOUT_MS + 1000);
		// Regex backtracking in the parser: interrupted, then the fallback is cached (budget spent once).
		const redos = timed('|b '.repeat(20000));
		expect(redos.html).toContain('Parsing failed');
		expect(redos.ms).toBeLessThan(2 * RENDER_TIMEOUT_MS + 1000);
		expect(timed('|b '.repeat(20000)).ms).toBeLessThan(100);
	}, 20_000);

	it('evicts the least recently used entries', () => {
		for (let i = 0; i < 510; i++) probe(i);
		probe(509);
		french();
		expect(probe(509)).toContain('[no content]');
		expect(probe(0)).toContain('[pas de contenu]');
	});
});

describe('random inputs idiom (tutorial 07)', () => {
	const raw = (script: string) => `.. raw:: html\n\n    <b>${script}</b>`;

	it('substitutes indexed and whole values, escaped', () => {
		expect(
			renderText(raw('<script>document.write(input["@random"][1]);</script>'), {
				random: [0.1, 0.2]
			}).trim()
		).toBe('<b>0.2</b>');
		expect(
			renderText(raw("<script> document.write( input['@random'] ) </script>"), {
				random: [1, 2]
			}).trim()
		).toBe('<b>1,2</b>');
		expect(renderText(raw('<script>document.write(input["@random"][5])</script>')).trim()).toBe('<b></b>');
	});

	it('removes every other script', () => {
		expect(
			renderText(raw('<script>let v = input["@random"]; document.write(v)</script>'), {
				random: [1]
			}).trim()
		).toBe('<b></b>');
	});
});

describe('TASK-19 sanitization', () => {
	/** Anything executable or styling-based that must never survive, inside a tag. */
	const FORBIDDEN =
		/<(script|iframe|object|embed|form|input|style|svg)\b|<[^>]*(\son\w+=|javascript:|data:text|url\()/i;

	it.each([
		'<img src=x onerror="alert(1)">',
		'<a href="javascript:alert(1)">x</a>',
		'<iframe src="https://evil"></iframe><object></object><embed><form><input></form><svg onload="x()"></svg>',
		'<style>body{}</style><p style="background:url(x)">s</p>',
		'<img src="data:text/html;base64,PHNjcmlwdD4=">',
		'<a href="JaVaScRiPt:alert(1)">x</a><a href=" javascript:alert(1)">y</a>',
		'<script>alert(document.cookie)</script>'
	])('neutralizes raw HTML %s', (raw) => {
		expect(renderText(`.. raw:: html\n\n    ${raw}`)).not.toMatch(FORBIDDEN);
		expect(renderText(`#MD\n${raw}`)).not.toMatch(FORBIDDEN);
		expect(renderText(`.. role:: h(raw)\n   :format: html\n\n:h:\`${raw.replace(/`/g, '')}\``)).not.toMatch(FORBIDDEN);
	});

	it('neutralizes javascript: links and images', () => {
		const url = /(href|src)="\s*javascript/i;
		expect(renderText('`x <javascript:alert(1)>`_')).not.toMatch(url);
		expect(renderText('.. image:: javascript:alert(1)\n   :target: javascript:alert(2)')).not.toMatch(url);
		expect(renderText('#MD\n[x](javascript:alert(1)) ![i](javascript:x)')).not.toMatch(url);
	});

	it('escapes student input echoed in feedback', () => {
		const student = '\n\n.. raw:: html\n\n    <script>steal()</script>';
		expect(renderText(`Your answer: \`\`${student}\`\``)).not.toMatch(FORBIDDEN);
	});

	it('keeps safe raw HTML: icons, sizes, data images, alignment', () => {
		const html = renderText(
			'.. raw:: html\n\n    <i style="font-size:120px;" class="fa fa-edit"></i><p style="text-align: center;">c</p><img src="data:image/png;base64,iVBO">'
		);
		expect(html.trim()).toBe(
			'<i style="font-size:120px" class="fa fa-edit"></i><p style="text-align:center">c</p><img src="data:image/png;base64,iVBO" />'
		);
	});

	it('opens external links in a new tab and rewrites relative URLs for LTI', () => {
		const rewrite = (url: string) => `asset/${url}?session_id=s`;
		const html = renderText(
			'`a <rel.txt>`_ `b <#anchor>`_ `c <https://x.org>`_ `d <//cdn.org/x>`_\n\n.. image:: i.png',
			{ ltiAssetRewrite: rewrite }
		);
		expect(html).toContain('href="asset/rel.txt?session_id=s" target="_blank" rel="noopener noreferrer"');
		expect(html).toContain('<a class="reference external" href="#anchor">b</a>');
		expect(html).toContain('href="https://x.org" target="_blank"');
		expect(html).toContain('href="//cdn.org/x" target="_blank"');
		expect(html).toContain('src="asset/i.png?session_id=s"');
		expect(renderText('.. raw:: html\n\n    <a target="_top">x</a>').trim()).toBe('<a>x</a>');
		expect(renderText('.. raw:: html\n\n    <img alt="no source">', { ltiAssetRewrite: rewrite }).trim()).toBe(
			'<img alt="no source" />'
		);
	});
});

describe('#MD marker', () => {
	it('renders texts starting with #MD as Markdown and the rest as RST', () => {
		expect(renderText('#MD\n**bold** and `code`')).toContain('<strong>bold</strong>');
		expect(renderText('#MD\n**bold**')).not.toContain('#MD');
		// In RST, `code` with single backquotes is interpreted text (emphasis), not code.
		expect(renderText('**bold** and ``code``')).toContain('<code');
	});
});

describe('regressions', () => {
	it('renders simple tables whose cells are indented', () => {
		const html = renderText('=====  =====\n A      B\n=====  =====\n 1      2\n=====  =====\n');
		expect(html).toContain('<th class="head">A</th>');
		expect(html).not.toContain('Parsing failed');
	});

	it('never echoes hidden-until sources in the failure fallback to students', () => {
		// Oversized sources always take the fallback path.
		const big = '.. hidden-until:: 2099-01-01\n\n    SECRET\n\n' + ' '.repeat(MAX_SOURCE_LENGTH + 1);
		expect(renderText(big)).not.toContain('SECRET');
		expect(renderText(big, { showEverything: true })).toContain('SECRET');
	});
});
