// Component tests of RichText: sanitized HTML display, KaTeX math, highlight.js
// code colouring, <time> formatting, scrolling tables and re-enhancement after updates.
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RichText from './RichText.svelte';
import { UI_PREFS_KEY } from '#lib/components/ui/prefs.js';
import type { SafeHtml } from '#lib/utils/safe-html.js';
// Static imports of the lazily loaded modules, so that Vite pre-bundles them before
// the run (a mid-run re-optimization would break the component's dynamic imports).
import 'highlight.js/lib/common';
import 'highlight.js/lib/languages/ocaml';
import 'highlight.js/lib/languages/scala';
import 'highlight.js/lib/languages/haskell';
import 'highlight.js/lib/languages/matlab';
import 'highlight.js/lib/languages/prolog';
import 'highlight.js/lib/languages/scheme';
import 'highlight.js/lib/languages/x86asm';
import 'highlight.js/lib/languages/latex';
import 'katex/contrib/auto-render';
// The rich text stylesheet is part of the global one.
import '../../../routes/layout.css';

/** Casts test HTML to SafeHtml (normally produced by the server sanitizer). */
const safe = (html: string) => html as SafeHtml;

/** The wrapper element once all asynchronous enhancements are finished. */
async function enhanced(): Promise<HTMLElement> {
	await expect.poll(() => document.querySelector<HTMLElement>('.rich-text')?.dataset.enhanced).toBe('done');
	return document.querySelector<HTMLElement>('.rich-text') as HTMLElement;
}

describe('RichText', () => {
	it('displays the HTML with extra classes and typesets math', async () => {
		render(RichText, {
			html: safe(
				'<p>Inline <span class="math">\\(a^2\\)</span></p><div class="math">\n\\begin{equation*}\nx\n\\end{equation*}\n</div><p>$$y$$ and \\[z\\]</p>'
			),
			class: 'extra'
		});
		const root = await enhanced();
		expect(root.classList.contains('extra')).toBe(true);
		expect(root.querySelectorAll('.katex').length).toBe(4);
		expect(root.querySelectorAll('.katex-display').length).toBe(3);
	});

	it('highlights code blocks by language class and alias, leaving unknown languages', async () => {
		render(RichText, {
			html: safe(
				'<pre class="code python literal-block">def f(): return 1</pre><pre class="code sh literal-block">echo "hi"</pre>' +
					'<pre class="code rst literal-block">.. note::</pre><pre class="literal-block">plain</pre>'
			)
		});
		const root = await enhanced();
		const [python, shell, rst, plain] = root.querySelectorAll('pre');
		expect(python.querySelector('.hljs-keyword')?.textContent).toBe('def');
		expect(python.classList.contains('hljs')).toBe(true);
		expect(shell.querySelector('.hljs-string')).not.toBeNull();
		expect(rst.classList.contains('hljs')).toBe(false);
		expect(plain.innerHTML).toBe('plain');
	});

	it('loads every supported grammar', async () => {
		const names = [
			'python',
			'c',
			'cpp',
			'java',
			'bash',
			'shell',
			'javascript',
			'typescript',
			'sql',
			'yaml',
			'json',
			'xml',
			'ocaml',
			'scala',
			'haskell',
			'kotlin',
			'csharp',
			'rust',
			'go',
			'matlab',
			'prolog',
			'scheme',
			'makefile',
			'x86asm',
			'latex',
			'octave',
			'racket',
			'asm',
			'tex',
			'sh'
		];
		render(RichText, {
			html: safe(names.map((n) => `<pre class="code ${n} literal-block">x = 1</pre>`).join(''))
		});
		const root = await enhanced();
		expect(root.querySelectorAll('pre.hljs').length).toBe(names.length);
	});

	it('formats <time> elements with the user preferences, keeping invalid ones', async () => {
		render(RichText, {
			props: {
				html: safe('<time datetime="2024-01-01T10:00:00+00:00">raw</time> <time datetime="nope">bad</time>')
			},
			context: new Map([[UI_PREFS_KEY, () => ({ locale: 'fr', timeZone: 'Europe/Brussels', indentation: '4' })]])
		});
		const root = await enhanced();
		const [good, bad] = root.querySelectorAll('time');
		expect(good.textContent).toBe('1 janv. 2024, 11:00');
		expect(good.title).toBe('2024-01-01T10:00:00+00:00');
		expect(bad.textContent).toBe('bad');
	});

	it('falls back to English/UTC on invalid preferences', async () => {
		render(RichText, {
			props: { html: safe('<time datetime="2024-01-01T10:00:00Z">raw</time>') },
			context: new Map([[UI_PREFS_KEY, () => ({ locale: 'en', timeZone: 'Not/AZone', indentation: '4' })]])
		});
		const root = await enhanced();
		expect(root.querySelector('time')?.textContent).toBe('Jan 1, 2024, 10:00 AM');
	});

	it('re-enhances the content after every update', async () => {
		const screen = render(RichText, { html: safe('<p>first</p>') });
		await enhanced();
		await screen.rerender({
			html: safe('<pre class="code java literal-block">class A {}</pre><p>\\(b\\)</p>')
		});
		await expect.poll(() => document.querySelector('.rich-text .hljs-keyword')?.textContent).toBe('class');
		await expect.poll(() => document.querySelector('.rich-text .katex')).not.toBeNull();
		expect(document.querySelector('.rich-text')?.textContent).not.toContain('first');
		screen.unmount();
		expect(document.querySelector('.rich-text')).toBeNull();
	});

	it('styles legacy Bootstrap classes with the theme', async () => {
		document.documentElement.style.setProperty('--color-error-500', 'red');
		document.documentElement.style.setProperty('--color-primary-400', 'blue');
		const screen = render(RichText, {
			html: safe(
				'<div class="row"><div class="col-xs-8">a</div></div><div class="admonition alert alert-danger alert-info">x</div>'
			)
		});
		const root = await enhanced();
		expect(getComputedStyle(root.querySelector('.row') as Element).display).toBe('flex');
		const alert = root.querySelector('.alert') as HTMLElement;
		// Bootstrap order: alert-danger is declared after alert-info, so danger wins.
		expect(getComputedStyle(alert).getPropertyValue('--rt-tone').trim()).toBe('red');
		// A "light" card header follows the colour scheme (light/dark pair of the theme).
		document.documentElement.style.setProperty('--color-surface-300-700', 'gray');
		await screen.rerender({ html: safe('<div class="card"><div class="card-header bg-light">Examples</div></div>') });
		await expect
			.poll(
				() =>
					document.querySelector('.rich-text .card-header') &&
					getComputedStyle(document.querySelector('.rich-text .card-header')!).backgroundColor
			)
			.toBe('rgb(128, 128, 128)');
	});

	it('scrolls wide tables horizontally inside a narrow container, keeping full-width tables on wide ones', async () => {
		const cell = '<td><code>second_largest([5, 1, 5, 3, 8, 13, 21])</code></td>';
		const table = `<table class="table table-bordered"><tr>${cell}${cell}<td><table><tr><td>in</td></tr></table></td></tr></table>`;
		const screen = render(RichText, { html: safe(`<p>Results</p>${table}`), class: 'w-[200px]' });
		const root = await enhanced();
		// Only the outermost table is wrapped: the nested one stays in its cell.
		const boxes = root.querySelectorAll<HTMLElement>('.table-scroll');
		expect(boxes.length).toBe(1);
		expect(boxes[0].firstElementChild?.matches('table.table')).toBe(true);
		expect(boxes[0].clientWidth).toBe(200);
		expect(boxes[0].scrollWidth).toBeGreaterThan(200);
		expect(getComputedStyle(boxes[0]).overflowX).toBe('auto');
		// On a wide container, a Bootstrap table still spans the whole width (no scrolling).
		await screen.rerender({ html: safe('<table class="table"><tr><td>a</td></tr></table>'), class: 'w-[600px]' });
		await expect.poll(() => document.querySelector('.rich-text .table-scroll')).not.toBeNull();
		const wide = document.querySelector<HTMLElement>('.rich-text .table-scroll')!;
		expect(wide.querySelector('table')!.offsetWidth).toBe(600);
		expect(wide.scrollWidth).toBe(600);
	});
});
