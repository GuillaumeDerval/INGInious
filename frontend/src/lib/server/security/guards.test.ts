/**
 * Unit tests of the authorization guards.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { ObjectId } from 'mongodb';
import { setServices, type Services } from '../app.js';
import { buildConfig } from '../config.js';
import {
	safeRedirectTarget,
	signinUrl,
	requireUser,
	requireSuperadmin,
	forbidLti,
	isLtiPath,
	type GuardEvent
} from './guards.js';

/** Captures what a guard throws. */
function thrown(fn: () => unknown): unknown {
	try {
		fn();
	} catch (e) {
		return e;
	}
	return undefined;
}

let config = buildConfig({ backend: 'tcp://x:1', session_parameters: { secret_key: 'k' } });
beforeEach(() => {
	config = buildConfig({ backend: 'tcp://x:1', session_parameters: { secret_key: 'k' } });
	setServices({ config } as Services);
});
afterAll(() => setServices(null));

/** Builds a guard event for an optional user. */
function ev(user: Partial<App.Locals['user']> | null, sessionExtra: Record<string, unknown> = {}): GuardEvent {
	return {
		url: new URL('http://localhost/course/c?x=1'),
		locals: {
			lang: 'en',
			user: user ? ({ username: 'u', superadmin: false, ...user } as App.Locals['user']) : null,
			session: {
				doc: { _id: new ObjectId(), is_lti: false, tos_signed: true, ...sessionExtra },
				stored: true,
				dirty: false
			}
		} as unknown as App.Locals
	};
}

describe('safeRedirectTarget', () => {
	it('keeps same-site paths and rejects anything else', () => {
		expect(safeRedirectTarget('/course/a?b=1')).toBe('/course/a?b=1');
		for (const bad of [
			'//evil.com',
			'/\\evil.com',
			'/\t/evil.com', // control characters
			'/a\\b',
			'https://evil.com',
			'javascript:alert(1)',
			'',
			null,
			undefined
		]) {
			expect(safeRedirectTarget(bad)).toBe('/mycourses');
		}
		expect(safeRedirectTarget(null, '/')).toBe('/');
	});

	it('builds sign-in URLs coming back to the current page', () => {
		expect(signinUrl(new URL('http://h/course/c?x=1'))).toBe('/signin?redirect=%2Fcourse%2Fc%3Fx%3D1');
	});
});

describe('requireUser', () => {
	it('redirects anonymous users to the sign-in page', () => {
		const e = thrown(() => requireUser(ev(null)));
		expect(isRedirect(e) && e.location).toBe('/signin?redirect=%2Fcourse%2Fc%3Fx%3D1');
	});

	it('returns logged-in users', () => {
		expect(requireUser(ev({ username: 'bob' })).username).toBe('bob');
	});

	it('enforces terms of service when they are defined', () => {
		config.isTosDefined = true;
		const e = thrown(() => requireUser(ev({}, { tos_signed: false })));
		expect(isRedirect(e) && e.location).toBe('/preferences/profile');
		expect(requireUser(ev({}, { tos_signed: true })).username).toBe('u');
	});
});

describe('requireSuperadmin / forbidLti', () => {
	it('answers 403 to non superadmins', () => {
		const e = thrown(() => requireSuperadmin(ev({})));
		expect(isHttpError(e) && e.status).toBe(403);
		expect(requireSuperadmin(ev({ superadmin: true })).superadmin).toBe(true);
	});

	it('rejects LTI sessions on normal pages', () => {
		const e = thrown(() => forbidLti(ev({}, { is_lti: true })));
		expect(isHttpError(e) && e.status).toBe(403);
		expect(thrown(() => forbidLti(ev({})))).toBeUndefined();
	});

	it('requireUser and requireSuperadmin refuse LTI sessions outside the LTI paths', () => {
		const lti = ev({ superadmin: true }, { is_lti: true });
		for (const guard of [requireUser, requireSuperadmin]) {
			const e = thrown(() => guard(lti));
			expect(isHttpError(e) && e.status).toBe(403);
		}
		lti.url = new URL('http://localhost/lti1.3/task');
		expect(requireSuperadmin(lti).username).toBe('u');
		expect(['/lti', '/lti/x', '/lti1.3/x', '/ltix', '/x/lti'].map(isLtiPath)).toEqual([true, true, true, false, false]);
	});
});
