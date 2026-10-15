/**
 * Unit tests of the #MD markup marker helpers.
 */
import { describe, it, expect } from 'vitest';
import { splitTextFormat, joinTextFormat } from './text-format.js';

describe('text format marker', () => {
	it('detects the #MD first line and strips it', () => {
		expect(splitTextFormat('#MD\n# Title')).toEqual({ format: 'markdown', body: '# Title' });
		expect(splitTextFormat('#MD  \r\nx')).toEqual({ format: 'markdown', body: 'x' });
		expect(splitTextFormat('#MD')).toEqual({ format: 'markdown', body: '' });
	});

	it('treats everything else as reStructuredText', () => {
		for (const text of ['Title\n=====', '#MDX\n', ' #MD\nx', '#md\nx', '']) {
			expect(splitTextFormat(text)).toEqual({ format: 'rst', body: text });
		}
	});

	it('round-trips through joinTextFormat', () => {
		for (const [format, body] of [
			['markdown', '**b**'],
			['rst', '**b**']
		] as const) {
			expect(splitTextFormat(joinTextFormat(format, body))).toEqual({ format, body });
		}
		expect(joinTextFormat('rst', 'x')).toBe('x');
	});
});
