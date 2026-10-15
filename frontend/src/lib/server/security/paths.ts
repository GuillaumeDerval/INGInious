/**
 * Safe filesystem path handling.
 *
 * Every path built from user-controlled input (course/task ids, task file
 * names, WebDAV paths, archive entries) MUST go through these helpers: they
 * reject traversal (`..`), absolute paths, NUL bytes and symbolic links below
 * the base directory (dangling ones included).
 */
import { lstatSync } from 'node:fs';
import { resolve, join, normalize, isAbsolute } from 'node:path';

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
 * the result stays inside the base directory. The base itself is trusted (it may
 * be a symlink, e.g. a mounted tasks directory), but no existing component below
 * it may be a symbolic link: a link (even one pointing inside the base, or a
 * dangling one that a later write would follow) is refused, so the lexical
 * result is also the real location.
 * @param base trusted base directory.
 * @param path untrusted relative path.
 * @returns the absolute resolved path.
 */
export function safeJoin(base: string, ...path: string[]): string {
	const root = resolve(base);
	// cleanRelativePath guarantees that the lexical result stays inside root.
	const relative = cleanRelativePath(path.join('/'));
	let probe = root;
	for (const part of relative ? relative.split('/') : []) {
		probe = join(probe, part);
		const stat = lstatSync(probe, { throwIfNoEntry: false });
		if (stat?.isSymbolicLink()) throw new UnsafePathError(path.join('/'));
		// Nothing exists below a missing component or a file (hence no link either).
		if (!stat?.isDirectory()) break;
	}
	return resolve(root, relative);
}
