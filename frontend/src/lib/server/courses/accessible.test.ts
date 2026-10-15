import { describe, expect, it } from 'vitest';
import * as a from './accessible.js';

const local = (...args: number[]) =>
	new Date(args[0], args[1] - 1, args[2], args[3] ?? 0, args[4] ?? 0, args[5] ?? 0).getTime();

describe('parseDate', () => {
	it('reads naive dates in the server timezone', () => {
		expect(a.parseDate('2014-07-16')).toBe(local(2014, 7, 16));
		expect(a.parseDate('2014-07-16 11:24:00')).toBe(local(2014, 7, 16, 11, 24));
		expect(a.parseDate('2014-07-16T11:24')).toBe(local(2014, 7, 16, 11, 24));
		expect(a.parseDate('2014-07-16 11')).toBe(local(2014, 7, 16, 11));
		expect(a.parseDate('2014-07-16 11:24:00.5')).toBe(local(2014, 7, 16, 11, 24) + 500);
	});
	it('honours offsets', () => {
		expect(a.parseDate('2014-07-16T11:24:00+02:00')).toBe(Date.UTC(2014, 6, 16, 9, 24));
		expect(a.parseDate('2014-07-16 11:24:00-0130')).toBe(Date.UTC(2014, 6, 16, 12, 54));
		expect(a.parseDate('2014-07-16T11:24:00Z')).toBe(Date.UTC(2014, 6, 16, 11, 24));
		expect(a.parseDate('2014-07-16T11:24:00+01')).toBe(Date.UTC(2014, 6, 16, 10, 24));
	});
	it('accepts the legacy dd/mm/YYYY formats', () => {
		expect(a.parseDate('16/07/2014')).toBe(local(2014, 7, 16));
		expect(a.parseDate('16/07/2014 11:24')).toBe(local(2014, 7, 16, 11, 24));
	});
	it.each(['notadate', '2014-02-30', '2014-13-01', '2014-07-16 25:00', '31/02/2014', ''])('rejects %j', (s) => {
		expect(() => a.parseDate(s)).toThrow(`Unknown format for ${s}`);
	});
});

describe('accessibleTime', () => {
	const A = local(2014, 7, 16);
	const S = local(2014, 7, 18);
	const B = local(2014, 7, 20);
	it('handles booleans and empty values', () => {
		for (const v of [true, null, undefined, '']) expect(a.accessibleTime(v)).toEqual(a.ALWAYS);
		expect(a.isNeverAccessible(a.accessibleTime(false))).toBe(true);
		expect(a.isOpen(a.accessibleTime(false))).toBe(false);
		expect(a.isOpen(a.accessibleTime(true))).toBe(true);
	});
	it('parses the string forms', () => {
		expect(a.accessibleTime('2014-07-16')).toEqual({ start: A, end: Infinity, softEnd: Infinity });
		expect(a.accessibleTime('/ 2014-07-20')).toEqual({ start: -Infinity, end: B, softEnd: B });
		expect(a.accessibleTime('2014-07-16 /')).toEqual({
			start: A,
			end: Infinity,
			softEnd: Infinity
		});
		expect(a.accessibleTime('2014-07-16 / 2014-07-20')).toEqual({ start: A, end: B, softEnd: B });
		expect(a.accessibleTime('2014-07-16 / 2014-07-18 / 2014-07-20 / ignored')).toEqual({
			start: A,
			end: B,
			softEnd: S
		});
		// soft end after the hard end is clamped
		expect(a.accessibleTime('2014-07-16 / 2014-07-21 / 2014-07-20').softEnd).toBe(B);
		expect(a.accessibleTime('//')).toEqual(a.ALWAYS);
	});
	it('rejects invalid values', () => {
		expect(() => a.accessibleTime('notadate')).toThrow('Unknown format for notadate');
		expect(() => a.accessibleTime(3)).toThrow('Unknown format for 3');
	});
	it('evaluates predicates with inclusive bounds', () => {
		const p = a.accessibleTime('2014-07-16 / 2014-07-18 / 2014-07-20');
		expect(a.afterStart(p, A - 1)).toBe(false);
		expect(a.afterStart(p, A)).toBe(true);
		expect(a.isOpen(p, A)).toBe(true);
		expect(a.isOpen(p, B)).toBe(true);
		expect(a.isOpen(p, B + 1)).toBe(false);
		expect(a.isOpenWithSoftDeadline(p, S)).toBe(true);
		expect(a.isOpenWithSoftDeadline(p, S + 1)).toBe(false);
		expect(a.isOpenWithSoftDeadline(p, A - 1)).toBe(false);
		expect(a.afterStart(a.ALWAYS)).toBe(true);
	});
});
