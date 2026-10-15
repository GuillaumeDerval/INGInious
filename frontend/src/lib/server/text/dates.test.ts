/**
 * Tests of the port of legacy `accessible_time.parse_date` (hidden-until dates).
 */
import { describe, expect, it } from 'vitest';
import { parseDate, toIsoString } from './dates.js';

process.env.TZ = 'UTC';

describe('parseDate', () => {
	it('parses ISO dates, naive ones in the server timezone', () => {
		expect(parseDate('2024-01-02')?.toISOString()).toBe('2024-01-02T00:00:00.000Z');
		expect(parseDate('2024-01-02 10:11')?.toISOString()).toBe('2024-01-02T10:11:00.000Z');
		expect(parseDate('2024-01-02T10:11:12.5')?.toISOString()).toBe('2024-01-02T10:11:12.500Z');
	});

	it('honours explicit offsets', () => {
		expect(parseDate('2024-01-02T10:00:00Z')?.toISOString()).toBe('2024-01-02T10:00:00.000Z');
		expect(parseDate('2024-01-02T10:00:00+02:00')?.toISOString()).toBe('2024-01-02T08:00:00.000Z');
		expect(parseDate('2024-01-02T10:00:00-0130')?.toISOString()).toBe('2024-01-02T11:30:00.000Z');
		expect(parseDate('2024-01-02T10:00:00+05')?.toISOString()).toBe('2024-01-02T05:00:00.000Z');
	});

	it('parses the legacy dd/mm/YYYY formats', () => {
		expect(parseDate('31/12/2023')?.toISOString()).toBe('2023-12-31T00:00:00.000Z');
		expect(parseDate('31/12/2023 23')?.toISOString()).toBe('2023-12-31T23:00:00.000Z');
		expect(parseDate('1/2/2023 3:04:05')?.toISOString()).toBe('2023-02-01T03:04:05.000Z');
	});

	it('rejects unknown formats and impossible dates', () => {
		for (const bad of [
			'notadate',
			'2024-13-01',
			'2024-02-30',
			'31/02/2024',
			'2024-02-30T00:00Z',
			'01/01/2024 24:00',
			''
		]) {
			expect(parseDate(bad)).toBeNull();
		}
	});
});

describe('toIsoString', () => {
	it('formats like Python isoformat() with the local offset', () => {
		expect(toIsoString(new Date('2999-01-01T10:00:00Z'))).toBe('2999-01-01T10:00:00+00:00');
	});
});
