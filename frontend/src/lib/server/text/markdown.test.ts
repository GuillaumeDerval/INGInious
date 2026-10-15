/**
 * Unit tests of the Markdown renderer edge cases (math delimiters, alerts,
 * linear behaviour on unmatched delimiters). Main cases: golden.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './markdown.js';

/** Renders with h3 as first heading level. */
const md = (source: string) => markdownToHtml(source, 3);

describe('markdown math', () => {
	it('ignores empty or space-padded dollars and unmatched delimiters', () => {
		expect(md('$$ $ a$ $x $ \\(')).toBe('<p>$$ $ a$ $x $ (</p>\n');
		expect(md('a $ b')).toBe('<p>a $ b</p>\n');
		expect(md('x $$a$$')).toBe('<p>x <span class="math">\\(a\\)</span></p>\n');
	});

	it('renders multi-line and unterminated display math', () => {
		expect(md('$$ a\nb $$')).toBe('<div class="math">\n\\[a\nb\\]\n</div>\n');
		expect(md('$$\nnever closed')).toBe('<p>$$\nnever closed</p>\n');
		expect(md('    $$ code')).toContain('<pre class="literal-block">');
	});

	it('handles math at the end of input, in link labels and interrupting paragraphs', () => {
		expect(md('cost: $')).toBe('<p>cost: $</p>\n');
		expect(md('[$a$](https://x.org)')).toBe('<p><a href="https://x.org"><span class="math">\\(a\\)</span></a></p>\n');
		expect(md('text\n$$\nx\n$$')).toBe('<p>text</p>\n<div class="math">\n\\[x\\]\n</div>\n');
	});

	it('stays linear on many unmatched delimiters', () => {
		// ~300,000 characters: well under a second when linear, far beyond 5 s when quadratic
		// (the margin absorbs a loaded machine running the whole suite in parallel).
		const start = Date.now();
		md('\\( $a '.repeat(50_000));
		expect(Date.now() - start).toBeLessThan(5000);
	});
});

describe('markdown alerts', () => {
	it('maps every GitHub alert type and ignores unknown ones', () => {
		expect(md('> [!TIP]\n> t')).toContain('class="admonition tip alert alert-info"');
		expect(md('> [!IMPORTANT] x')).toBe('<div class="admonition important alert alert-warning">\n<p>x</p>\n</div>\n');
		expect(md('> [!CAUTION]\n> c')).toContain('alert-danger');
		expect(md('> [!OTHER]\n> o')).toContain('<blockquote>');
		expect(md('> > [!NOTE]\n> > nested')).toBe(
			'<blockquote>\n<div class="admonition note alert alert-light">\n<p>nested</p>\n</div>\n</blockquote>\n'
		);
	});
});
