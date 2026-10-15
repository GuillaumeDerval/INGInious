/**
 * Storage helpers of the course/task model: id validation, safe paths inside
 * `tasks_directory`, YAML read/write in the legacy style, mtime-based caching
 * and per-course/per-task gettext catalogs (`$i18n/<lang>.mo`, see
 * docs/reference/i18n.md §3).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse, stringify, type ScalarTag, type Tags } from 'yaml';
import { services } from '../app.js';
import { safeJoin, isValidId } from '../security/paths.js';

/** Legacy `id_checker` (common/base.py), shared with security/paths.ts. */
export const idChecker = isValidId;

/** Absolute path of the configured `tasks_directory`. */
export function tasksDir(): string {
	return resolve(services().config.tasksDirectory);
}

/** The requested course or task does not exist (or cannot be loaded). */
export class NotFoundError extends Error {}

/** Safe absolute path of a file or folder of a course (ids must be checked first). */
export function coursePath(...parts: string[]): string {
	return safeJoin(tasksDir(), ...parts);
}

/**
 * Safe absolute path of a course folder (`[courseid]`) or task folder
 * (`[courseid, taskid]`) after checking the ids.
 * @throws NotFoundError for invalid ids.
 */
export function checkedPath(...ids: string[]): string {
	if (!ids.every((id) => idChecker(id)))
		throw new NotFoundError(`Invalid ${ids.length > 1 ? 'task' : 'course'} id: ${ids.join('/')}`);
	return coursePath(...ids);
}

/** Deletes a course or task folder with everything in it, and its cache entries. */
export function removeTree(dir: string): void {
	invalidateCache(dir);
	rmSync(dir, { recursive: true, force: true });
}

/** PyYAML's boolean words: YAML 1.1 ones without `y`/`n` (strings for PyYAML, e.g. the `n` of a JWK). */
const PY_BOOLEANS = {
	true: /^(?:[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
	false: /^(?:[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/
};

/**
 * Parses YAML like PyYAML's SafeLoader (YAML 1.1: `yes`/`on` are booleans, but
 * `y`/`n` are strings as in PyYAML), except that unquoted dates stay strings
 * (PyYAML would make them `date` objects that the legacy code then failed to use).
 */
export function parseYaml(text: string): unknown {
	return parse(text, {
		version: '1.1',
		customTags: (tags) =>
			// The tags of the YAML 1.1 schema are tag objects (never names).
			(tags as Exclude<Tags[number], string>[]).flatMap((t): Tags => {
				if (t.tag === 'tag:yaml.org,2002:timestamp') return [];
				if (t.tag === 'tag:yaml.org,2002:bool')
					return [{ ...(t as ScalarTag), test: PY_BOOLEANS[`${t.identify!(true)}`] }];
				return [t];
			})
	});
}

/** Legacy `custom_yaml` clean-up of multi-line strings (no tabs, no trailing spaces). */
function cleanStrings(value: unknown): unknown {
	if (typeof value === 'string')
		return value.includes('\n')
			? value
					.replaceAll('\t', '    ')
					.split('\n')
					.map((l) => l.trimEnd())
					.join('\n')
			: value;
	if (Array.isArray(value)) return value.map(cleanStrings);
	if (value && typeof value === 'object')
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanStrings(v)]));
	return value;
}

/**
 * Serializes a descriptor in the legacy `custom_yaml.dump` style: keys in
 * insertion order, 4-space indentation, multi-line strings as `|` blocks, and
 * YAML 1.1 quoting (so `"yes"` or `"2024-01-01"` stay strings for PyYAML).
 */
export function dumpYaml(data: unknown): string {
	return stringify(cleanStrings(data), {
		version: '1.1',
		indent: 4,
		blockQuote: 'literal',
		lineWidth: 0
	});
}

/** Cache entries: absolute path -> parsed value and the mtime it was read at. */
const cache = new Map<string, { mtime: number; value: unknown }>();

/**
 * Loads a file through `load`, reusing the previous result while the file
 * mtime is unchanged (legacy `fetch_or_cache`).
 * @throws the fs error when the file does not exist, or the loader error.
 */
export function cachedLoad<T>(path: string, load: (raw: Buffer) => T): T {
	const mtime = statSync(path).mtimeMs;
	const hit = cache.get(path);
	if (hit && hit.mtime === mtime) return hit.value as T;
	const value = load(readFileSync(path));
	cache.set(path, { mtime, value });
	return value;
}

/** Writes a file atomically (temporary file + rename) and invalidates its cache entry. */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
	writeFileSync(tmp, data);
	renameSync(tmp, path);
	cache.delete(path);
}

/** Drops every cached entry below `path` (deleted courses/tasks). */
export function invalidateCache(path: string): void {
	for (const key of cache.keys()) if (key === path || key.startsWith(path + '/')) cache.delete(key);
}

/**
 * Parses a compiled GNU gettext catalog (`.mo`, both byte orders).
 * Plural and context entries are skipped: legacy only calls `gettext(text)`.
 */
export function parseMo(buf: Buffer): Map<string, string> {
	const magic = buf.readUInt32LE(0);
	const le = magic === 0x950412de;
	if (!le && magic !== 0xde120495) throw new Error('Invalid .mo file');
	const u32 = (offset: number) => (le ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset));
	const str = (table: number, i: number) =>
		buf.toString('utf8', u32(table + 8 * i + 4), u32(table + 8 * i + 4) + u32(table + 8 * i));
	const catalog = new Map<string, string>();
	for (let i = 0; i < u32(8); i++) {
		const id = str(u32(12), i);
		if (id && !id.includes('\0') && !id.includes('\x04')) catalog.set(id, str(u32(16), i));
	}
	return catalog;
}

/** Translates a course/task string: `(language, text) => translated text`. */
export type Translate = (language: string, text: string) => string;

/**
 * Returns the translation function backed by the `<lang>.mo` files of the
 * first existing `$i18n` folder among `dirs` (looked up at each call, so new
 * folders are used at once). Empty texts give `""`; missing catalogs or
 * entries return the text unchanged (legacy `gettext`).
 */
export function translator(dirs: string[]): Translate {
	return (language, text) => {
		if (!text) return '';
		const dir = dirs.find((d) => existsSync(d));
		if (!dir || !/^[A-Za-z_]+$/.test(language)) return text;
		try {
			return cachedLoad(`${dir}/${language}.mo`, parseMo).get(text) || text;
		} catch {
			return text;
		}
	};
}
