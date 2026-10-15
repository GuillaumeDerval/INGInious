/**
 * Request pipeline used by hooks.server.ts: session loading, current user,
 * UI language (AUTH-10), maintenance mode (AUTH-03) and security headers.
 * Kept out of the hooks file so that it can be unit tested.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestEvent } from '@sveltejs/kit';
import type { ResolveOptions } from '@sveltejs/kit/hooks';
import { services } from './app.js';
import type { Session } from './auth/session.js';
import { isLtiPath } from './security/guards.js';
import {
	loadCatalog,
	setCatalogGetter,
	negotiateLanguage,
	isRtl,
	LANGUAGES,
	t,
	type Catalog
} from '#lib/i18n/index.js';
import { escapeHtml } from '#lib/utils/escape.js';
import type { CurrentUser } from '../../app.d.ts';

/** Catalog of the request being processed (server-side `t()`). */
const requestCatalog = new AsyncLocalStorage<Catalog>();
setCatalogGetter(() => requestCatalog.getStore() ?? {});

/** Runs `fn` with the translations of `lang` active for `t()`. */
export async function withLanguage<T>(lang: string, fn: () => Promise<T>): Promise<T> {
	return requestCatalog.run(await loadCatalog(lang), fn);
}

/** Builds the current user from a logged-in session (language already resolved by `resolveLanguage`), null otherwise. */
export function currentUser(session: Session): CurrentUser | null {
	const d = session.doc;
	if (!d.loggedin || !d.username) return null;
	return {
		username: d.username,
		realname: d.realname ?? '',
		email: d.email ?? '',
		language: d.language!,
		timezone: d.timezone ?? 'UTC',
		codeIndentation: d.code_indentation ?? '4',
		superadmin: services().config.superadmins.includes(d.username)
	};
}

/**
 * Chooses the UI language: the session language, or the best match of the
 * Accept-Language header on the first visit (stored in the session).
 */
export function resolveLanguage(session: Session, acceptLanguage: string | null): string {
	if (session.doc.language && session.doc.language in LANGUAGES) return session.doc.language;
	session.doc.language = negotiateLanguage(acceptLanguage);
	return session.doc.language;
}

/** Headers added to every response (CSP itself is configured in vite.config.ts). */
export const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
	'Cross-Origin-Opener-Policy': 'same-origin'
};

/**
 * Endpoints that legitimately receive cross-site form POSTs and authenticate them
 * by other means: LTI 1.1 launches (OAuth1 signature), LTI 1.3 OIDC logins and
 * launches (signed JWT), external sign-in callbacks (signed SAML response), the
 * simple_grader endpoint (shared API key) and WebDAV (HTTP Basic auth only, no
 * cookie session, so not exposed to CSRF).
 */
const CROSS_SITE_ALLOWED =
	/^\/(lti\/[^/]+\/[^/]+|lti1\.3\/(oidc_login|launch|deeplaunch)(\/.*)?|auth\/callback\/[^/]+|external|dav(\/.*)?)$/;

/** Content types a browser form can send cross-site without a CORS preflight. */
const FORM_TYPES = /^(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)/i;

/**
 * CSRF protection, equivalent to SvelteKit's built-in origin check
 * (which is disabled with `trustedOrigins: ['*']` in vite.config.ts because it
 * cannot exempt single routes): a mutating form request whose Origin header is
 * missing or foreign is refused, except on the endpoints above.
 */
export function isCrossSiteForbidden(request: Request, url: URL): boolean {
	if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return false;
	const type = request.headers.get('content-type');
	if (type && !FORM_TYPES.test(type)) return false;
	return request.headers.get('origin') !== url.origin && !CROSS_SITE_ALLOWED.test(url.pathname);
}

/** Static page served for every URL in maintenance mode (AUTH-03), with HTTP 503. */
export function maintenanceResponse(lang: string): Response {
	const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(t('Maintenance'))} | INGInious</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f6fb"><main style="max-width:32rem;padding:2rem;border-radius:1rem;background:#fff;box-shadow:0 1px 4px #0002;text-align:center"><h1 style="margin-top:0">INGInious</h1><p>${t('<b>This INGInious instance is currently under maintenance.</b> Please come back in a few minutes!')}</p></main></body></html>`;
	return new Response(html, {
		status: 503,
		headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '300' }
	});
}

/**
 * The whole request pipeline: load the session, compute locals, render inside
 * the language context, then persist the session and add security headers.
 */
export async function handleRequest(
	event: RequestEvent,
	resolve: (event: RequestEvent, opts?: ResolveOptions) => Promise<Response>
): Promise<Response> {
	const { config, sessions } = services();
	if (isCrossSiteForbidden(event.request, event.url)) {
		return new Response(`Cross-site ${event.request.method} form submissions are forbidden`, { status: 403 });
	}
	// The LTI `?session_id=` token is only honoured on LTI paths; LTI sessions never have a cookie.
	const lti = isLtiPath(event.url.pathname);
	const session = await sessions.load(
		event.cookies.get(config.session.cookieName),
		lti ? event.url.searchParams.get('session_id') : null
	);
	const hadLanguage = !!session.doc.language;
	const lang = resolveLanguage(session, event.request.headers.get('accept-language'));
	if (!hadLanguage && session.stored) sessions.markDirty(session);
	event.locals.session = session;
	event.locals.user = currentUser(session);
	event.locals.lang = lang;

	const response = await withLanguage(lang, async () => {
		if (config.maintenance) return maintenanceResponse(lang);
		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html.replace('%lang%', lang.replace('_', '-')).replace('%dir%', isRtl(lang) ? 'rtl' : 'ltr')
		});
	});

	const setCookie = await sessions.commit(session);
	const headers = new Headers(response.headers);
	if (setCookie) headers.append('Set-Cookie', setCookie);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
	// LTI tool pages are displayed inside the LMS iframes.
	if (!lti) headers.set('X-Frame-Options', 'DENY');
	// HTTPS deployments ask browsers never to downgrade.
	if (event.url.protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
