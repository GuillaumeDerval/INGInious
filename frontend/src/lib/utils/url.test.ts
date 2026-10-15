// Unit tests of the URL helpers.
import { describe, expect, it } from 'vitest';
import { actionUrl, withQuery } from './url.js';

describe('withQuery', () => {
	it('changes some parameters and keeps the others', () => {
		const url = new URL('http://x/admin/c/submissions?q=alice&page=2');
		expect(withQuery(url, { page: 3 })).toBe('?q=alice&page=3');
		expect(withQuery(url, { page: null, tab: 'groups' })).toBe('?q=alice&tab=groups');
		expect(withQuery(new URL('http://x/a?page=2'), { page: null })).toBe('?');
	});
});

describe('actionUrl', () => {
	it('keeps the query of the page in the action URL', () => {
		expect(actionUrl(new URL('http://x/mycourses?q=a&page=2'), 'pin')).toBe('?q=a&page=2&/pin');
		expect(actionUrl(new URL('http://x/mycourses'), 'pin')).toBe('?/pin');
	});
});
