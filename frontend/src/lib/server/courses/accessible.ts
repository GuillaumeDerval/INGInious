/**
 * Accessibility periods: port of legacy `frontend/accessible_time.py`
 * (docs/reference/course-model.md §3, NAV-05, NAV-14).
 *
 * Used for the course `accessible` / `registration` keys and the per-task
 * `accessibility` dispenser setting. Accepted values: `true`/`null`/`""`
 * (always), `false` (never), `"start"`, `"start / end"` and
 * `"start / soft end / end"` (an empty part is unbounded). Dates are ISO 8601
 * (`2014-07-16`, `2014-07-16 11:24:00`, `2014-07-16T11:24:00+02:00`, ...) or
 * the legacy `16/07/2014 11:24` form; dates without offset are interpreted in the **server local timezone**, like
 * Python's `datetime.fromisoformat(s).astimezone()`.
 *
 * Instants are epoch milliseconds; the legacy `datetime.min`/`datetime.max`
 * sentinels are `-Infinity`/`+Infinity`, so every comparison is tz-aware (the
 * legacy code compared naive and aware datetimes in some plugins).
 */

import { parseDate as parseLegacyDate } from '../text/dates.js';

/** A period during which a course, a registration or a task is open. */
export interface AccessibleTime {
	/** Opening instant (epoch ms, -Infinity = since always, +Infinity = never). */
	start: number;
	/** Hard deadline (epoch ms, +Infinity = no deadline). */
	end: number;
	/** Soft deadline (never after `end`), displayed to students. */
	softEnd: number;
}

/** Always accessible period. */
export const ALWAYS: AccessibleTime = Object.freeze({
	start: -Infinity,
	end: Infinity,
	softEnd: Infinity
});
/** Never accessible period. */
export const NEVER: AccessibleTime = Object.freeze({
	start: Infinity,
	end: Infinity,
	softEnd: Infinity
});

/**
 * Parses a date like legacy `parse_date`: ISO 8601 or `dd/mm/YYYY[ HH[:MM[:SS]]]`,
 * naive dates in server local time, impossible dates rejected (shared with the
 * `hidden-until` directive parser).
 * @returns the instant in epoch milliseconds.
 * @throws Error("Unknown format for <text>") when the date is invalid.
 */
export function parseDate(text: string): number {
	const date = parseLegacyDate(text);
	if (!date) throw new Error(`Unknown format for ${text}`);
	return date.getTime();
}

/**
 * Builds the period described by a course.yaml / dispenser value.
 * @throws Error("Unknown format for ...") for invalid values (the caller makes
 *         the course unloadable, like legacy).
 */
export function accessibleTime(value: unknown): AccessibleTime {
	if (value === null || value === undefined || value === '' || value === true) return ALWAYS;
	if (value === false) return NEVER;
	if (typeof value !== 'string') throw new Error(`Unknown format for ${String(value)}`);
	const parts = value.split('/').map((p) => p.trim());
	const part = (p: string, fallback: number) => (p === '' ? fallback : parseDate(p));
	const start = part(parts[0], -Infinity);
	// "A / S / B": the hard end is the 3rd part, the soft end the 2nd one (extra parts ignored).
	const end = parts.length === 1 ? Infinity : part(parts[Math.min(parts.length - 1, 2)], Infinity);
	const softEnd = parts.length >= 3 ? part(parts[1], Infinity) : end;
	return { start, end, softEnd: Math.min(softEnd, end) };
}

/** True when the period started (it may be over): visibility rule of tasks. */
export function afterStart(a: AccessibleTime, now = Date.now()): boolean {
	return a.start <= now;
}

/** True when `now` is within [start, hard end] (inclusive). */
export function isOpen(a: AccessibleTime, now = Date.now()): boolean {
	return a.start <= now && now <= a.end;
}

/** True when `now` is within [start, soft end] (inclusive). */
export function isOpenWithSoftDeadline(a: AccessibleTime, now = Date.now()): boolean {
	return a.start <= now && now <= a.softEnd;
}

/** True for the "never" period (the only one starting at +Infinity: parsed dates are finite). */
export function isNeverAccessible(a: AccessibleTime): boolean {
	return a.start === Infinity;
}
