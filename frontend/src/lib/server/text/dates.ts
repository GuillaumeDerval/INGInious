/**
 * Date parsing for the `hidden-until` directive: a port of the legacy
 * `accessible_time.parse_date` (`datetime.fromisoformat(s).astimezone()`, then
 * the `%d/%m/%Y[ %H[:%M[:%S]]]` formats). Naive dates are interpreted in the
 * server's local timezone, like legacy.
 */

/** ISO 8601 as accepted by Python's `datetime.fromisoformat` (common subset). */
const ISO =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/** Legacy European formats: `dd/mm/YYYY`, optionally followed by `HH`, `HH:MM`, `HH:MM:SS`. */
const EUROPEAN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?)?$/;

/** Builds a date from local (or offset) components, rejecting impossible dates. */
function build(
	y: number,
	mo: number,
	d: number,
	h: number,
	mi: number,
	s: number,
	ms: number,
	offset?: string
): Date | null {
	if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
	let date: Date;
	if (offset === undefined) date = new Date(y, mo - 1, d, h, mi, s, ms);
	else {
		const sign = offset === 'Z' ? 0 : offset[0] === '-' ? -1 : 1;
		const [oh, om] =
			offset === 'Z' ? [0, 0] : [Number(offset.slice(1, 3)), Number(offset.replace(':', '').slice(3, 5) || 0)];
		date = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms) - sign * (oh * 60 + om) * 60000);
	}
	// Reject overflowing days (e.g. 31/02) the way Python does.
	const check = offset === undefined ? date.getDate() : new Date(Date.UTC(y, mo - 1, d)).getUTCDate();
	return check === d ? date : null;
}

/** Parses a `hidden-until` date, or returns null when the format is unknown. */
export function parseDate(text: string): Date | null {
	const iso = ISO.exec(text.trim());
	if (iso) {
		const [, y, mo, d, h, mi, s, f, off] = iso;
		return build(
			+y,
			+mo,
			+d,
			+(h ?? 0),
			+(mi ?? 0),
			+(s ?? 0),
			Math.floor(Number((f ?? '0').padEnd(6, '0')) / 1000),
			off
		);
	}
	const eu = EUROPEAN.exec(text.trim());
	if (eu) {
		const [, d, mo, y, h, mi, s] = eu;
		return build(+y, +mo, +d, +(h ?? 0), +(mi ?? 0), +(s ?? 0), 0);
	}
	return null;
}

/** Formats a date like Python's `astimezone().isoformat()` (server local offset). */
export function toIsoString(date: Date): string {
	const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
	const offset = -date.getTimezoneOffset();
	const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
	const tz = `${offset < 0 ? '-' : '+'}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}${tz}`;
}
