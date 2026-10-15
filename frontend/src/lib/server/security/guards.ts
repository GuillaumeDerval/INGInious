/**
 * Centralised authorization guards (architecture rule §4.1).
 *
 * Every load function, form action and endpoint calls one of these before doing
 * anything. Denials use real status codes: anonymous users are redirected to the
 * sign-in page (302) and authenticated users without rights get 403.
 * Course-level guards live in #lib/server/courses/access.ts.
 */
import { error, redirect } from '@sveltejs/kit';
import type { CurrentUser } from '../../../app.d.ts';
import { services } from '../app.js';
import { t } from '#lib/i18n/index.js';

/** Minimal view of a request needed by the guards. */
export interface GuardEvent {
	locals: App.Locals;
	url: URL;
}

/**
 * Returns a safe local redirect target: only same-site absolute paths are kept
 * (prevents open redirects); anything else becomes `fallback`.
 */
export function safeRedirectTarget(target: string | null | undefined, fallback = '/mycourses'): string {
	// Control characters and backslashes are refused too (e.g. `/%09/evil.com`).
	// eslint-disable-next-line no-control-regex -- control characters are what is refused here.
	if (!target || !/^\/(?![/\\])[^\x00-\x1f\x7f\\]*$/.test(target)) return fallback;
	return target;
}

/** URL of the sign-in page that comes back to the current page after login. */
export function signinUrl(url: URL): string {
	return `/signin?redirect=${encodeURIComponent(url.pathname + url.search)}`;
}

/** True for the paths of the LTI flow (`/lti/...`, `/lti1.3/...`, incl. LTI assets), the only ones open to LTI sessions. */
export const isLtiPath = (pathname: string) => /^\/lti(1\.3)?(\/|$)/.test(pathname);

/**
 * Requires a logged-in user who accepted the terms of service (when defined).
 * LTI sessions are refused outside the LTI paths (an LTI `?session_id=` token
 * only opens the LTI pages), so every guard built on this one refuses them too.
 * @throws redirect to /signin for anonymous users, to the profile page when the terms are not accepted.
 */
export function requireUser(event: GuardEvent): CurrentUser {
	if (!isLtiPath(event.url.pathname)) forbidLti(event);
	const user = event.locals.user;
	if (!user) redirect(302, signinUrl(event.url));
	if (services().config.isTosDefined && !event.locals.session.doc.tos_signed) redirect(302, '/preferences/profile');
	return user;
}

/** Requires a superadmin (configuration `superadmins`). */
export function requireSuperadmin(event: GuardEvent): CurrentUser {
	const user = requireUser(event);
	if (!user.superadmin) error(403, t('You are not allowed to access this page.'));
	return user;
}

/**
 * Rejects LTI sessions on pages that are not part of the LTI flow: an LTI
 * session cannot browse the normal UI (legacy `INGIniousAuthPage`).
 */
export function forbidLti(event: GuardEvent): void {
	if (event.locals.session.doc.is_lti) error(403, t('This page is not available from your LMS.'));
}
