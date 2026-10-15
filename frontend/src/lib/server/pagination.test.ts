// Unit tests of the shared pagination helper.
import { describe, expect, it } from 'vitest';
import { pageSlice } from './pagination.js';

describe('pageSlice', () => {
	it('clamps the wished page to the existing pages', () => {
		expect(pageSlice(120, '2', 50)).toEqual({ page: 2, pages: 3, skip: 50, limit: 50 });
		expect(pageSlice(120, 9, 50)).toMatchObject({ page: 3, skip: 100 });
		expect(pageSlice(120, 'x', 50)).toMatchObject({ page: 1, skip: 0 });
		expect(pageSlice(120, -4, 50)).toMatchObject({ page: 1 });
		expect(pageSlice(0, 3, 50)).toEqual({ page: 1, pages: 1, skip: 0, limit: 50 });
	});
});
