// Tests of the SafeHtml helpers.
import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape.js';
import { textToSafeHtml } from './safe-html.js';

describe('safe-html', () => {
	it('escapes plain text into SafeHtml', () => {
		expect(textToSafeHtml('<b>"x" & \'y\'</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
		expect(textToSafeHtml(null)).toBe('');
		expect(escapeHtml('<')).toBe('&lt;');
	});
});
