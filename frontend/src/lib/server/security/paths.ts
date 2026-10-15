/**
 * Safe filesystem path handling.
 *
 * Every path built from user-controlled input (course/task ids, task file
 * names, WebDAV paths, archive entries) MUST go through these helpers: they
 * reject traversal (`..`), absolute paths, NUL bytes and symlinks escaping the
 * base directory.
 */
import { realpathSync, existsSync } from 'node:fs';
import { resolve, sep, normalize, isAbsolute } from 'node:path';

/** Course/task id check, shared with the browser editors. */
export { isValidId } from '#lib/utils/ids.js';

/** Error thrown when a path would escape its base directory. */
export class UnsafePathError extends Error {
	constructor(path: string) {
		super(`Unsafe path: ${path}`);
		this.name = 'UnsafePathError';
	}
}

/**
 * Normalises a user supplied relative path ("a/b/../c" -> "a/c").
 * @throws UnsafePathError for absolute paths, NUL bytes or paths leaving the root.
 */
export function cleanRelativePath(path: string): string {
	if (path.includes('\0') || isAbsolute(path) || /^[a-zA-Z]:/.test(path)) throw new UnsafePathError(path);
	const normalized = normalize(path.replaceAll('\\', '/')).replace(/^(\.\/)+/, '');
	if (normalized === '..' || normalized.startsWith('../')) throw new UnsafePathError(path);
	return normalized === '.' ? '' : normalized.replace(/\/+$/, '');
}

/**
 * Joins a base directory and a user supplied relative path, guaranteeing that
 * the result stays inside the base directory, symlinks included.
 * @param base trusted base directory.
 * @param path untrusted relative path.
 * @returns the absolute resolved path.
 */
export function safeJoin(base: string, ...path: string[]): string {
	const root = resolve(base);
	// cleanRelativePath guarantees that the lexical result stays inside root.
	const target = resolve(root, cleanRelativePath(path.join('/')));
	// Nothing inside a missing directory can be a symlink.
	if (!existsSync(root)) return target;
	// Resolve symlinks of the deepest existing ancestor to detect escapes.
	let probe = target;
	while (!existsSync(probe)) probe = resolve(probe, '..');
	const realRoot = realpathSync(root);
	const realProbe = realpathSync(probe);
	if (realProbe !== realRoot && !realProbe.startsWith(realRoot + sep)) throw new UnsafePathError(path.join('/'));
	return target;
}
