/**
 * `attempt()`: compact try/catch shared by the whole server (course
 * administration, site, API, WebDAV, bundled plugins).
 */

/**
 * Returns `fn()`, or `fallback(error)` when `fn` throws (e.g. "load or answer
 * 404" patterns; `fallback` may itself throw, or ignore the error).
 */
export function attempt<T, F = T>(fn: () => T, fallback: (e: Error) => F): T | F {
	try {
		return fn();
	} catch (e) {
		return fallback(e as Error);
	}
}
