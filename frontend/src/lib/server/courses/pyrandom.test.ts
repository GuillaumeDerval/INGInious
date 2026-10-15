import { describe, expect, it } from 'vitest';
import { PyRandom } from './pyrandom.js';

/** Vectors produced by CPython 3.14: random.Random(seed).shuffle(list(range(n))). */
const VECTORS: [string, number, number[]][] = [
	['a#1#t', 10, [6, 7, 5, 8, 3, 4, 2, 9, 0, 1]],
	['nav_alice#0#Pool A', 4, [3, 2, 1, 0]],
	['é∂😀', 7, [2, 5, 4, 3, 1, 0, 6]],
	['', 12, [11, 1, 5, 0, 4, 2, 8, 10, 6, 3, 9, 7]]
];

describe('PyRandom', () => {
	it.each(VECTORS)('shuffles like CPython for %j', (seed, n, expected) => {
		expect(new PyRandom(seed).shuffle([...Array(n).keys()])).toEqual(expected);
	});
	it('reproduces the combinatory test draws of the spec', () => {
		expect(new PyRandom('nav_alice#0#Pool A').shuffle(['c1', 'c2', 'c3', 'c4']).slice(0, 2)).toEqual(['c4', 'c3']);
		expect(new PyRandom('nav_bob#0#Pool A').shuffle(['c1', 'c2', 'c3', 'c4'])).toEqual(['c3', 'c1', 'c2', 'c4']);
	});
	it('handles degenerate inputs', () => {
		const r = new PyRandom('x');
		expect(r.randbelow(1)).toBe(0);
		expect(r.shuffle([])).toEqual([]);
	});
});
