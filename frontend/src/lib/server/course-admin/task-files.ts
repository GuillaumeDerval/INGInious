/**
 * Task files management (CADM-14): listing, creation, upload, edition,
 * rename/move, deletion and download of the files of a task folder.
 * Every user path is normalised (`/./task.yaml` is `task.yaml`) and resolved
 * through `safeJoin` (no traversal, no symlink escape); the root folder and
 * the root `task.yaml` can never be modified.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { zipSync } from 'fflate';
import { t } from '#lib/i18n/index.js';
import { coursePath } from '../courses/files.js';
import { cleanRelativePath, safeJoin } from '../security/paths.js';
import { attempt } from '../attempt.js';

/** An entry of the task folder (`path` starts with `/`, folders end with `/`). */
export interface FileEntry {
	path: string;
	name: string;
	dir: boolean;
	depth: number;
}

/** Error with a message meant for the user. */
export class FileError extends Error {}

/** Recursive listing: per level files then folders, sorted by name; the root task.yaml is hidden. */
export function listFiles(dir: string, prefix = '/'): FileEntry[] {
	const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => prefix !== '/' || e.name !== 'task.yaml');
	const depth = prefix.split('/').length - 2;
	const sorted = entries.sort(
		(a, b) => Number(a.isDirectory()) - Number(b.isDirectory()) || a.name.localeCompare(b.name)
	);
	return sorted.flatMap((e) =>
		e.isDirectory()
			? [
					{ path: `${prefix}${e.name}/`, name: e.name, dir: true, depth },
					...listFiles(join(dir, e.name), `${prefix}${e.name}/`)
				]
			: [{ path: prefix + e.name, name: e.name, dir: false, depth }]
	);
}

/**
 * Resolves a user path inside a task folder.
 * @param mustExist true/false: the path must (not) exist; undefined: no check.
 * @param root allows the task folder itself (download only).
 * @throws FileError("Invalid path") for unsafe, protected or (non-)existing paths.
 */
export function taskFile(courseid: string, taskid: string, path: string, mustExist?: boolean, root = false): string {
	const invalid = () => {
		throw new FileError(t('Invalid path: {}', path));
	};
	const rel = attempt(() => cleanRelativePath(path.trim().replace(/^\/+/, '')), invalid);
	const abs =
		(rel === '' && !root) || rel === 'task.yaml'
			? invalid()
			: attempt(() => safeJoin(coursePath(courseid, taskid), rel), invalid);
	return mustExist !== undefined && existsSync(abs) !== mustExist ? invalid() : abs;
}

/** Creates an empty file, or a folder when the path ends with `/`. */
export function createFile(c: string, task: string, path: string, data: Uint8Array = new Uint8Array()): void {
	const abs = taskFile(c, task, path, false);
	if (path.trim().endsWith('/')) return void mkdirSync(abs, { recursive: true });
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, data);
}

/** Text content of a file, or null when it is not valid UTF-8 ("INGInious can't read this file."). */
export function readText(c: string, task: string, path: string): string | null {
	const abs = taskFile(c, task, path, true);
	return attempt(
		() => new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(abs)),
		() => null
	);
}

/** Overwrites an existing file (edit). */
export function saveText(c: string, task: string, path: string, content: string): void {
	const abs = taskFile(c, task, path, true);
	if (statSync(abs).isDirectory()) throw new FileError(t('Invalid path: {}', path));
	writeFileSync(abs, content);
}

/** Moves a file or folder to a new path (parents created). */
export function renameFile(c: string, task: string, from: string, to: string): void {
	const src = taskFile(c, task, from, true);
	const dst = taskFile(c, task, to, false);
	if (dst.startsWith(src + '/')) throw new FileError(t('Invalid path: {}', to));
	mkdirSync(dirname(dst), { recursive: true });
	renameSync(src, dst);
}

/** Deletes a file or a folder (recursively). */
export function deleteFile(c: string, task: string, path: string): void {
	rmSync(taskFile(c, task, path, true), { recursive: true, force: true });
}

/** Download: `{name, data}` of a file, or a zip of a folder (`/` = whole task, task.yaml included). */
export function download(c: string, task: string, path: string): { name: string; data: Uint8Array } {
	const abs = taskFile(c, task, path, true, true);
	if (!statSync(abs).isDirectory()) return { name: abs.split('/').pop()!, data: readFileSync(abs) };
	const files: Record<string, Uint8Array> = {};
	const walk = (dir: string, prefix: string): void =>
		readdirSync(dir, { withFileTypes: true }).forEach((e) =>
			e.isDirectory()
				? walk(join(dir, e.name), `${prefix}${e.name}/`)
				: e.isFile() && (files[prefix + e.name] = readFileSync(join(dir, e.name)))
		);
	walk(abs, '');
	return { name: `${abs === coursePath(c, task) ? task : abs.split('/').pop()}.zip`, data: zipSync(files) };
}
