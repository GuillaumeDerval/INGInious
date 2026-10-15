/**
 * CSV helpers of the people & results administration (CSTU-01/04/06/09/12/16):
 * legacy `make_csv` format (Excel dialect, CRLF, `id` + sorted keys, sub-dicts
 * flattened as `key[sub]`, Python-like reprs) with formula neutralisation
 * (CSTU-18): text cells starting with a formula character are
 * prefixed with a quote. Also a small RFC 4180 parser (audience upload) and
 * the CSV download response.
 */
import { Readable } from 'node:stream';
import { download } from '../forms.js';

/** Python `str()` of a value (`True`, `['a', 'b']`), dates in ISO format. */
function repr(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'boolean') return v ? 'True' : 'False';
	if (v instanceof Date) return v.toISOString();
	if (Array.isArray(v)) return `[${v.map((x) => (typeof x === 'string' ? `'${x}'` : repr(x))).join(', ')}]`;
	return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** One CSV cell: formula prefixes neutralised (CSTU-18), quoted when needed. */
function cell(v: unknown): string {
	let s = repr(v);
	if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Serialises rows (Excel dialect, CRLF line endings). */
export function toCsv(rows: unknown[][]): string {
	return rows.map((r) => r.map(cell).join(',') + '\r\n').join('');
}

/** A `dictCsv` row with its plain-object values flattened as `key[sub]` (the column `key` removed). */
function flatten(row: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row))
		if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date))
			for (const [sub, x] of Object.entries(v)) out[`${k}[${sub}]`] = x;
		else out[k] = v;
	return out;
}

/**
 * Legacy `make_csv(dict)`: one row per entry, first column `id` (the key), then
 * every key sorted, plain-object values flattened as `key[sub]` (the column `key` removed).
 */
export function dictCsv(data: Record<string, Record<string, unknown>>): string {
	const flat = Object.entries(data).map(([id, row]) => [id, flatten(row)] as const);
	const keys = [...new Set(flat.flatMap(([, r]) => Object.keys(r)))].sort();
	return toCsv([['id', ...keys], ...flat.map(([id, r]) => [id, ...keys.map((k) => r[k])])]);
}

/** Rows per chunk of `dictCsvStream`. */
const CHUNK_ROWS = 1000;

/**
 * `dictCsv` written while the rows are read (e.g. from a database cursor), for large exports.
 * @param keys every flattened key of the rows (`key[sub]` for plain-object values): the sorted header.
 * @param rows [id, row] pairs.
 */
export function dictCsvStream(keys: string[], rows: AsyncIterable<[string, Record<string, unknown>]>): ReadableStream {
	const header = [...keys].sort();
	return Readable.toWeb(
		Readable.from(
			(async function* () {
				let lines: unknown[][] = [['id', ...header]];
				for await (const [id, row] of rows) {
					const flat = flatten(row);
					lines.push([id, ...header.map((k) => flat[k])]);
					// Written in chunks of CHUNK_ROWS rows (fewer, larger stream chunks).
					if (lines.length >= CHUNK_ROWS) {
						yield Buffer.from(toCsv(lines));
						lines = [];
					}
				}
				yield Buffer.from(toCsv(lines));
			})()
		)
	) as ReadableStream;
}

/** Parses CSV text (quoted fields, `""` escapes, CRLF/LF); blank lines are skipped. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let value = '';
	let quoted = false;
	const end = () => (row.push(value), (value = ''));
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c !== '"') value += c;
			else if (text[i + 1] === '"') value += text[i++];
			else quoted = false;
		} else if (c === '"') quoted = true;
		else if (c === ',') end();
		else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			end();
			rows.push(row);
			row = [];
		} else value += c;
	}
	if (value || row.length) {
		end();
		rows.push(row);
	}
	return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** CSV attachment response (legacy file name `export.csv` by default). */
export const csvDownload = (text: string | ReadableStream, name = 'export.csv'): Response =>
	download(text, name, 'text/csv; charset=utf-8');
