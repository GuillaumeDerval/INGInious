/**
 * Test support of the LTI area: a temporary tasks directory with a copy of
 * the lti_test sample course (LTI course) and a plain (non-LTI) course, a throw-away
 * database, real session store, fake backend, mock LMS and fake request events.
 */
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { services } from '../../../src/lib/server/app.js';
import { SessionStore, type Session } from '../../../src/lib/server/auth/session.js';
import { setupCourses, SAMPLE_COURSES, type CoursesEnv } from '../courses/setup.js';
import { FakeBackend } from '../task/setup.js';
import { startMockLms, type MockLms } from '../../../e2e/lti/mock/platform.js';

/** Environment of the LTI unit tests. */
export interface LtiEnv extends CoursesEnv {
	backend: FakeBackend;
	mock: MockLms;
	sessions: SessionStore;
}

/** Installs `lti_test` (+ course `plain`, not LTI) with services and a mock LMS. */
export async function setupLti(): Promise<LtiEnv> {
	const dir = mkdtempSync(join(tmpdir(), 'inginious-lti-'));
	cpSync(join(SAMPLE_COURSES, 'lti_test'), join(dir, 'lti_test'), { recursive: true });
	cpSync(join(SAMPLE_COURSES, 'lti_test'), join(dir, 'plain'), { recursive: true });
	writeFileSync(
		join(dir, 'plain', 'course.yaml'),
		'name: Plain\nadmins: [superadmin]\naccessible: true\nregistration: true\n'
	);
	const env = await setupCourses({ withDb: true, tasksDirectory: dir });
	const backend = new FakeBackend();
	const session = {
		secretKey: 'unit-secret',
		timeout: 3600,
		cookieName: 'sid',
		cookiePath: '/',
		sameSite: 'lax',
		httpOnly: true,
		secure: false
	} as const;
	const sessions = new SessionStore(env.db, session);
	Object.assign(services(), { backend, sessions });
	Object.assign(services().config, {
		session,
		ltiConfig: {},
		// The mock LMS listens on http://localhost.
		raw: { lti_allow_private_urls: true },
		allowedFileExtensions: ['.txt'],
		maxFileSize: 1024,
		superadmins: ['superadmin']
	});
	const mock = await startMockLms();
	return { ...env, backend, mock, sessions, cleanup: async () => (await mock.close(), await env.cleanup()) };
}

/** A fake request event; `session` defaults to a new anonymous session. */
export function ltiEvent(
	url: string,
	opts: {
		session?: Session;
		form?: Record<string, string>;
		method?: string;
		headers?: Record<string, string>;
		params?: Record<string, string>;
	} = {}
) {
	const body = opts.form ? new URLSearchParams(opts.form) : undefined;
	const jar = new Map<string, string>();
	const session = opts.session ?? services().sessions.create();
	const d = session.doc;
	const user =
		d.loggedin && d.username
			? {
					username: d.username,
					realname: d.realname ?? '',
					email: d.email ?? '',
					language: 'en',
					timezone: 'UTC',
					codeIndentation: '4',
					superadmin: d.username === 'superadmin'
				}
			: null;
	return {
		url: new URL(url),
		params: opts.params ?? {},
		request: new Request(url, { method: opts.method ?? (body ? 'POST' : 'GET'), body, headers: opts.headers }),
		locals: { session, user, lang: 'en' },
		cookies: {
			jar,
			get: (k: string) => jar.get(k),
			set: (k: string, v: string, o: Record<string, unknown>) =>
				jar.set(k, v) && jar.set(`${k}:opts`, JSON.stringify(o)),
			delete: (k: string) => jar.delete(k)
		},
		getClientAddress: () => '1.2.3.4'
	} as unknown as RequestEvent & { cookies: { jar: Map<string, string> } };
}

/** Runs `fn` and returns the thrown SvelteKit redirect location / error status, or the value. */
export async function settle<T>(
	fn: () => T | Promise<T>
): Promise<{ value?: T; status?: number; location?: string; message?: string }> {
	try {
		return { value: await fn() };
	} catch (e) {
		const x = e as { status?: number; location?: string; body?: { message: string } };
		if (x.status === undefined) throw e;
		return { status: x.status, location: x.location, message: x.body?.message };
	}
}

/** Waits for pending callbacks. */
export const flush = (ms = 50) => new Promise((r) => setTimeout(r, ms));
