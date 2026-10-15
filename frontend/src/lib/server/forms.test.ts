/** Unit tests of the shared form/download helpers, `attempt()` and the id check. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { attempt } from './attempt.js';
import { disposition, download, formText, jsonField, uploadText } from './forms.js';
import { isValidId } from '#lib/utils/ids.js';

const form = (fields: Record<string, string | Blob>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.append(k, v);
	return f;
};

describe('attempt', () => {
	it('returns the value or the fallback of the error', () => {
		expect(
			attempt(
				() => 1,
				() => 2
			)
		).toBe(1);
		const boom = () => {
			throw new Error('x');
		};
		expect(attempt(boom, (e) => e.message)).toBe('x');
	});
});

describe('form fields', () => {
	it('reads text, JSON and uploaded files', async () => {
		const f = form({ a: ' x ', j: '{"b":1}', bad: '{', file: new File(['hi'], 'f.txt'), empty: new File([], 'e') });
		expect([formText(f, 'a'), formText(f, 'nope')]).toEqual([' x ', '']);
		const schema = z.object({ b: z.number() });
		expect(jsonField(f, 'j', schema)).toEqual({ b: 1 });
		expect(jsonField(f, 'bad', schema)).toBeNull();
		expect(jsonField(f, 'nope', schema)).toBeNull();
		expect(jsonField(form({ j: '{"b":"1"}' }), 'j', schema)).toBeNull();
		expect([await uploadText(f, 'file'), await uploadText(f, 'empty'), await uploadText(f, 'a')]).toEqual([
			'hi',
			null,
			null
		]);
	});
});

describe('downloads', () => {
	it('builds attachments with RFC 5987 names and nosniff', async () => {
		expect(disposition('inline', 'é a.txt')).toBe(`inline; filename="__a.txt"; filename*=UTF-8''%C3%A9%20a.txt`);
		const r = download('x', 'f.csv', 'text/csv');
		expect(Object.fromEntries(r.headers)).toEqual({
			'content-type': 'text/csv',
			'content-disposition': `attachment; filename="f.csv"; filename*=UTF-8''f.csv`,
			'x-content-type-options': 'nosniff'
		});
		expect(download('x', 'a').headers.get('content-type')).toBe('application/octet-stream');
		expect(await r.text()).toBe('x');
	});
});

describe('isValidId', () => {
	it('accepts legacy ids only', () => {
		expect(['a-b_c.1', 'Task2'].every(isValidId)).toBe(true);
		expect(['', '.', '..', 'a b', 'a/b', 3].some(isValidId)).toBe(false);
	});
});
