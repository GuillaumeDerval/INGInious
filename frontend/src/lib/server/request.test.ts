/**
 * Unit tests of the request pipeline (session, language, maintenance, headers).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { ResolveOptions } from '@sveltejs/kit/hooks';
import { createTestDatabase, type TestDatabase } from './testing/db.js';
import { setServices, type Services } from './app.js';
import { SessionStore } from './auth/session.js';
import { buildConfig } from './config.js';
import {
	handleRequest,
	currentUser,
	resolveLanguage,
	withLanguage,
	maintenanceResponse,
	isCrossSiteForbidden,
	completeCsp
} from './request.js';
import { t } from '#lib/i18n/index.js';

let t0: TestDatabase;
let services: Services;

beforeAll(async () => {
	t0 = await createTestDatabase();
	const config = buildConfig({ backend: 'tcp://x:1', session_parameters: { secret_key: 'k' }, superadmins: ['root'] });
	services = {
		config,
		db: t0.database,
		sessions: new SessionStore(t0.database, config.session),
		backend: {} as Services['backend']
	};
	setServices(services);
});
afterAll(async () => {
	setServices(null);
	await t0.drop();
});

/** Builds a minimal RequestEvent. */
function event(path: string, headers: Record<string, string> = {}, cookie?: string): RequestEvent {
	return {
		url: new URL(`http://localhost${path}`),
		request: new Request(`http://localhost${path}`, { headers }),
		cookies: { get: (name: string) => (name === 'inginious_session_id' ? cookie : undefined) },
		locals: {}
	} as unknown as RequestEvent;
}

describe('handleRequest', () => {
	it('negotiates the language, renders inside it and adds security headers', async () => {
		const e = event('/courselist', { 'accept-language': 'fr' });
		let translated = '';
		const resolve = vi.fn(async (_e: RequestEvent, opts?: ResolveOptions) => {
			translated = t('Sign in');
			const html = (await opts!.transformPageChunk!({
				html: '<html lang="%lang%" dir="%dir%">',
				done: true
			})) as string;
			return new Response(html, { headers: { 'Content-Type': 'text/html' } });
		});
		const response = await handleRequest(e, resolve);
		expect(await response.text()).toBe('<html lang="fr" dir="ltr">');
		expect(translated).not.toBe('Sign in');
		expect(e.locals.lang).toBe('fr');
		expect(e.locals.user).toBeNull();
		expect(response.headers.get('x-frame-options')).toBe('DENY');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		// Anonymous session with only a negotiated language: not stored, no cookie.
		expect(response.headers.get('set-cookie')).toBeNull();
	});

	it('lets LTI pages be framed and persists dirty sessions with a cookie', async () => {
		const resolve = async (e: RequestEvent) => {
			services.sessions.markDirty(e.locals.session);
			return new Response('ok');
		};
		const response = await handleRequest(event('/lti/task', { 'accept-language': 'nb-NO' }), resolve);
		expect(response.headers.get('x-frame-options')).toBeNull();
		expect(response.headers.get('strict-transport-security')).toBeNull();
		const https = { ...event('/x'), url: new URL('https://localhost/x') } as RequestEvent;
		expect((await handleRequest(https, resolve)).headers.get('strict-transport-security')).toBe('max-age=31536000');
		expect(response.headers.get('set-cookie')).toMatch(/^inginious_session_id=/);
	});

	it('marks stored sessions without language as dirty', async () => {
		const s = services.sessions.create();
		s.doc.loggedin = true;
		s.doc.username = 'root';
		services.sessions.markDirty(s);
		await services.sessions.commit(s);
		await t0.database.c.sessions.updateOne({ _id: s.doc._id }, { $set: { language: '' } });
		const e = event('/', { 'accept-language': 'de' }, services.sessions.sign(s.doc._id));
		const response = await handleRequest(e, async () => new Response('ok'));
		expect(e.locals.user?.superadmin).toBe(true);
		expect(response.headers.get('set-cookie')).toMatch(/^inginious_session_id=/);
		expect((await t0.database.c.sessions.findOne({ _id: s.doc._id }))?.language).toBe('de');
	});

	it('honours the LTI session_id token on LTI paths only', async () => {
		const s = services.sessions.create(true);
		Object.assign(s.doc, { loggedin: true, username: 'root' });
		await services.sessions.commit(s);
		const token = services.sessions.sign(s.doc._id);
		for (const [path, user] of [
			['/lti/task', 'root'],
			['/lti1.3/task', 'root'],
			['/lti/asset/x.png', 'root'],
			['/administrator/users', undefined],
			['/admin/c/settings', undefined],
			['/api/v0/courses', undefined],
			['/ltix', undefined]
		] as const) {
			const e = event(`${path}?session_id=${token}`);
			await handleRequest(e, async () => new Response('ok'));
			expect(e.locals.user?.username, path).toBe(user);
		}
	});

	it('CORE-03 completes the page CSP with the configured hosts and the allowed frame ancestors', async () => {
		const base = "default-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'self'; frame-ancestors 'self'";
		const page = async (path: string, session?: string) => {
			const e = event(path);
			if (session) e.url.searchParams.set('session_id', session);
			const resolve = async () => new Response('<html>', { headers: { 'Content-Security-Policy': base } });
			return (await handleRequest(e, resolve)).headers.get('content-security-policy');
		};
		expect(await page('/courselist')).toBe(base);
		Object.assign(services.config, {
			sentryIoUrl: 'https://key@o1.ingest.sentry.io/42',
			webterm: 'https://term.example:8080/xterm',
			ltiConfig: { 'https://lms.example': [{ auth_login_url: 'https://auth.lms.example/login' }] }
		});
		try {
			expect(await page('/courselist')).toBe(
				"default-src 'self'; connect-src 'self' https://o1.ingest.sentry.io; frame-src 'self' https://term.example:8080; form-action 'self'; frame-ancestors 'self'"
			);
			// Sign-in forms are redirected to the identity providers.
			expect(await page('/signin')).toContain("form-action 'self' https:;");
			expect(await page('/preferences/bindings')).toContain("form-action 'self' https:;");
			// LTI pages: framed by (and posting to) the LMS, except the bind page.
			const lms = 'https://lms.example https://auth.lms.example';
			expect(await page('/lti1.3/deeplink')).toContain(`form-action 'self' ${lms}; frame-ancestors 'self' ${lms}`);
			expect(await page('/lti/bind')).toContain("form-action 'self'; frame-ancestors 'self'");
			const s = services.sessions.create(true);
			s.doc.lti = { version: '1.1', tool_url: 'https://moodle.example/' } as never;
			await services.sessions.commit(s);
			expect(await page('/lti/task', services.sessions.sign(s.doc._id))).toMatch(
				new RegExp(`frame-ancestors 'self' ${lms} https://moodle.example$`)
			);
			// Responses without a CSP are left alone.
			expect(
				(await handleRequest(event('/x'), async () => new Response('x'))).headers.has('content-security-policy')
			).toBe(false);
		} finally {
			Object.assign(services.config, { sentryIoUrl: undefined, webterm: undefined, ltiConfig: {} });
		}
	});

	it('serves the maintenance page for every URL', async () => {
		services.config.maintenance = true;
		try {
			const resolve = vi.fn();
			const response = await handleRequest(event('/anything'), resolve);
			expect(response.status).toBe(503);
			expect(response.headers.get('retry-after')).toBe('300');
			expect(await response.text()).toContain('under maintenance');
			expect(response.headers.get('content-security-policy')).toBe(
				"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
			);
			expect(resolve).not.toHaveBeenCalled();
		} finally {
			services.config.maintenance = false;
		}
	});
});

describe('helpers', () => {
	it('builds the current user from logged-in sessions only', () => {
		const s = services.sessions.create();
		expect(currentUser(s)).toBeNull();
		s.doc.loggedin = true;
		s.doc.username = 'bob';
		s.doc.language = 'en';
		expect(currentUser(s)).toEqual({
			username: 'bob',
			realname: '',
			email: '',
			language: 'en',
			timezone: s.doc.timezone,
			codeIndentation: '4',
			superadmin: false
		});
		Object.assign(s.doc, {
			realname: 'Bob',
			email: 'b@x',
			language: 'fr',
			timezone: undefined,
			code_indentation: undefined
		});
		expect(currentUser(s)).toMatchObject({
			realname: 'Bob',
			email: 'b@x',
			language: 'fr',
			timezone: 'UTC',
			codeIndentation: '4'
		});
	});

	it('keeps a valid session language and replaces unknown ones', () => {
		const s = services.sessions.create();
		s.doc.language = 'es';
		expect(resolveLanguage(s, 'fr')).toBe('es');
		s.doc.language = 'xx';
		expect(resolveLanguage(s, 'fr')).toBe('fr');
	});

	it('translates the maintenance page and exposes the language context', async () => {
		const html = await withLanguage('fr', async () => (await maintenanceResponse('fr').text()) + t('Sign in'));
		expect(html).toContain('lang="fr"');
		expect(html).not.toMatch(/Sign in$/);
	});
});

describe('completeCsp', () => {
	it('CORE-03 adds sources to existing directives only and replaces the frame ancestors', () => {
		expect(
			completeCsp(
				"default-src 'none'; img-src 'self';frame-ancestors *; form-action 'none'; sandbox",
				{ 'img-src': ['https://a.example', null], 'connect-src': ['https://b.example'], 'form-action': ['https:'] },
				["'self'", 'https://lms.example']
			)
		).toBe(
			"default-src 'none'; img-src 'self' https://a.example; form-action 'none'; sandbox; frame-ancestors 'self' https://lms.example"
		);
	});
});

describe('isCrossSiteForbidden', () => {
	const url = (path: string) => new URL(`http://localhost${path}`);
	const req = (method: string, headers: Record<string, string>) =>
		new Request('http://localhost/x', { method, headers });
	const form = { 'content-type': 'application/x-www-form-urlencoded' };

	it('refuses foreign or missing origins on mutating form requests', () => {
		expect(isCrossSiteForbidden(req('POST', { ...form, origin: 'http://evil.example' }), url('/signin'))).toBe(true);
		expect(isCrossSiteForbidden(req('POST', form), url('/signin'))).toBe(true);
		expect(isCrossSiteForbidden(req('DELETE', {}), url('/x'))).toBe(true);
		expect(
			isCrossSiteForbidden(
				req('POST', { 'content-type': 'multipart/form-data; boundary=x', origin: 'http://evil.example' }),
				url('/x')
			)
		).toBe(true);
	});

	it('accepts same-origin forms, safe methods and non-form content types', () => {
		expect(isCrossSiteForbidden(req('POST', { ...form, origin: 'http://localhost' }), url('/signin'))).toBe(false);
		expect(isCrossSiteForbidden(req('GET', {}), url('/signin'))).toBe(false);
		expect(
			isCrossSiteForbidden(
				req('POST', { 'content-type': 'application/json', origin: 'http://evil.example' }),
				url('/api/v0/courses')
			)
		).toBe(false);
	});

	it('exempts the signed cross-site endpoints only', () => {
		for (const path of [
			'/lti/course/task',
			'/lti1.3/launch',
			'/lti1.3/launch/c/t',
			'/lti1.3/oidc_login',
			'/lti1.3/deeplaunch/c',
			'/auth/callback/saml2_auth',
			'/external',
			'/dav',
			'/dav/course/task.yaml'
		]) {
			expect(isCrossSiteForbidden(req('POST', { ...form, origin: 'https://lms.example' }), url(path)), path).toBe(
				false
			);
		}
		for (const path of ['/lti/bind', '/lti/task/extra/x', '/lti1.3/bind', '/lti1.3/deeplink', '/auth/signin/x']) {
			expect(isCrossSiteForbidden(req('POST', { ...form, origin: 'https://lms.example' }), url(path)), path).toBe(true);
		}
	});

	it('answers 403 in the pipeline', async () => {
		const e = event('/signin', { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example' });
		Object.defineProperty(e, 'request', {
			value: new Request('http://localhost/signin', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example' }
			})
		});
		const response = await handleRequest(e, vi.fn());
		expect(response.status).toBe(403);
	});
});
