/**
 * One-shot "flash" messages (CORE-01): an action stores a message before
 * redirecting, the root layout load reads and clears it, and the shell shows it
 * as a toast. The legacy frontend had no such mechanism (feedback was passed as
 * template variables), which a POST-redirect-GET flow needs.
 *
 * The message lives in a short-lived httpOnly cookie, so it never needs a
 * database write and is never readable by page scripts. Its content is only
 * ever rendered as text.
 */
import type { Cookies } from '@sveltejs/kit';
import type { ToastKind } from '#lib/components/layout/toaster.js';

/** A message shown once, on the next page. */
export interface Flash {
	kind: ToastKind;
	message: string;
}

/** Name of the flash cookie. */
const COOKIE = 'inginious_flash';
const KINDS: readonly string[] = ['info', 'success', 'warning', 'error'];
/** Cookie options: valid for the whole site, one minute at most. */
const OPTIONS = { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 } as const;

/** Stores a message to show on the next rendered page (call before `redirect`). */
export function setFlash(cookies: Cookies, kind: ToastKind, message: string): void {
	// Cookies are limited to ~4 KB: keep messages short.
	cookies.set(COOKIE, JSON.stringify({ kind, message: message.slice(0, 1000) }), OPTIONS);
}

/** Returns the pending message, if any, and deletes it. Malformed values are ignored. */
export function takeFlash(cookies: Cookies): Flash | null {
	const raw = cookies.get(COOKIE);
	if (raw === undefined) return null;
	cookies.delete(COOKIE, { path: '/' });
	try {
		const value = JSON.parse(raw) as Partial<Flash>;
		if (KINDS.includes(value.kind as string) && typeof value.message === 'string') {
			return { kind: value.kind as ToastKind, message: value.message };
		}
	} catch {
		// Tampered or truncated cookie: ignore it.
	}
	return null;
}
