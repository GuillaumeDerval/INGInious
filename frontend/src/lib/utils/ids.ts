/**
 * Course, task and problem identifiers (legacy `id_checker`), shared by the
 * server (`security/paths.ts`) and the admin editors (TocEditor, SubproblemsEditor).
 */

/** Pattern of valid ids (legacy `id_checker`: `[a-z0-9\-\._]+$`, case-insensitive). */
const ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

/** True when `id` is a valid course/task/problem identifier ("." and ".." are refused). */
export function isValidId(id: unknown): id is string {
	return typeof id === 'string' && ID_PATTERN.test(id) && !/^\.+$/.test(id);
}
