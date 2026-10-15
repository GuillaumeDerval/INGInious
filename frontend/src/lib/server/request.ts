/**
 * Request pipeline used by hooks.server.ts: session loading, current user,
 * UI language (AUTH-10), maintenance mode (AUTH-03) and security headers,
 * including the run-time part of the Content-Security-Policy (`completeCsp`).
 * Kept out of the hooks file so that it can be unit tested.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestEvent } from '@sveltejs/kit';
import type { ResolveOptions } from '@sveltejs/kit/hooks';
import { services } from './app.js';
import type { Session } from './auth/session.js';
import { isLtiPath } from './security/guards.js';
import { ltiOrigins, originOf } from './lti/common.js';
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

/** Headers added to every response (CSP: vite.config.ts, completed by `completeCsp`). */
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

/** Static page served for every URL in maintenance mode (AUTH-03), with HTTP 503 (no script, inline styles only). */
export function maintenanceResponse(lang: string): Response {
	const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(t('Maintenance'))} | INGInious</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f6fb"><main style="max-width:32rem;padding:2rem;border-radius:1rem;background:#fff;box-shadow:0 1px 4px #0002;text-align:center"><h1 style="margin-top:0">INGInious</h1><p>${t('<b>This INGInious instance is currently under maintenance.</b> Please come back in a few minutes!')}</p></main></body></html>`;
	return new Response(html, {
		status: 503,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Retry-After': '300',
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
		}
	});
}

/** LTI pages opened in a new tab, never framed (account binding). */
const UNFRAMED_LTI = /^\/lti(1\.3)?\/bind$/;
/** Pages whose sign-in forms post to /auth/signin, which redirects to external identity providers. */
const SIGNIN_PAGES = /^\/(signin|auth\/page\/[^/]+|preferences\/bindings)$/;

/**
 * Completes a Content-Security-Policy with the sources only known at run time
 * (configuration.yaml is read when the server starts, after the build):
 * `extra` sources are appended to the directives the policy already has, unless they
 * are `'none'` (a missing directive is never added: it could loosen a `default-src 'none'`), and
 * `frame-ancestors` is replaced by `ancestors`.
 */
export function completeCsp(policy: string, extra: Record<string, (string | null)[]>, ancestors: string[]): string {
	const directives = policy
		.split(';')
		.map((d) => d.trim())
		.filter((d) => d && !d.startsWith('frame-ancestors'))
		.map((d) => (d.includes("'none'") ? d : [d, ...(extra[d.split(/\s+/)[0]] ?? []).filter(Boolean)].join(' ')));
	return [...directives, `frame-ancestors ${ancestors.join(' ')}`].join('; ');
}

/**
 * Run-time CSP sources of a request (CORE-03, CORE-06, LTI pages):
 *  - `connect-src`: the Sentry ingest host (`sentry_io_url`), `frame-src`: the `webterm`;
 *  - LTI pages may be framed by, and post their deep-linking forms to, the LMS
 *    (`ltiOrigins`), except the bind page; every other page only by itself;
 *  - sign-in pages post forms redirected to the identity providers: any https target.
 */
function cspSources(event: RequestEvent) {
	const { config } = services();
	const path = event.url.pathname;
	const lms = isLtiPath(path) && !UNFRAMED_LTI.test(path) ? ltiOrigins(event.locals.session.doc.lti, path) : [];
	const extra = {
		'connect-src': [originOf(config.sentryIoUrl)],
		'frame-src': [originOf(config.webterm)],
		'form-action': [...lms, ...(SIGNIN_PAGES.test(path) ? ['https:'] : [])]
	};
	return { extra, ancestors: ["'self'", ...lms] };
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

	const setCookie = await sessions.commit(session, event.url.protocol === 'https:');
	const headers = new Headers(response.headers);
	if (setCookie) headers.append('Set-Cookie', setCookie);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
	const csp = headers.get('content-security-policy');
	if (csp) {
		const { extra, ancestors } = cspSources(event);
		headers.set('Content-Security-Policy', completeCsp(csp, extra, ancestors));
	}
	// LTI tool pages are displayed inside the LMS iframes.
	if (!lti) headers.set('X-Frame-Options', 'DENY');
	// HTTPS deployments ask browsers never to downgrade.
	if (event.url.protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
