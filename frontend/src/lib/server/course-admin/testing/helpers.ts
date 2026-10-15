/**
 * Test support of the course administration: fixture courses in a temporary
 * tasks directory (with a throw-away database) and fake request events.
 */
import { setupCourses, type CoursesEnv } from '../../../../../tests/fixtures/courses/setup.js';
import { services } from '../../app.js';

export type { CoursesEnv };

/** Prepares the fixture courses (copy of tests/fixtures/courses) with a database and a backend that announced nothing. */
export async function setup(): Promise<CoursesEnv> {
	const env = await setupCourses({ withDb: true });
	Object.assign(services().config, { ltiConfig: {}, plugins: [] });
	Object.assign(services(), { backend: { environments: {} } });
	return env;
}

/** A fake SvelteKit request event for `username` (null = anonymous). */
export function fakeEvent(
	username: string | null,
	params: Record<string, string>,
	opts: { form?: Record<string, string | Blob>; url?: string } = {}
) {
	let body: FormData | undefined;
	if (opts.form) {
		body = new FormData();
		for (const [k, v] of Object.entries(opts.form)) body.append(k, v);
	}
	const cookies = new Map<string, string>();
	return {
		params,
		url: new URL(opts.url ?? 'http://localhost/admin/fx'),
		request: new Request(opts.url ?? 'http://localhost/admin/fx', body ? { method: 'POST', body } : {}),
		locals: {
			lang: 'en',
			session: { doc: {} },
			user: username && {
				username,
				realname: username,
				email: '',
				language: 'en',
				timezone: 'UTC',
				codeIndentation: '4',
				superadmin: username === 'root'
			}
		},
		cookies: { set: (k: string, v: string) => cookies.set(k, v), get: (k: string) => cookies.get(k), delete: () => {} }
	} as never;
}

/** Runs `fn` and returns the thrown SvelteKit error/redirect (or the result). */
export async function settle<T>(fn: () => T | Promise<T>): Promise<{ value?: T; status?: number; location?: string }> {
	try {
		return { value: await fn() };
	} catch (e) {
		const x = e as { status?: number; location?: string };
		if (x.status === undefined) throw e;
		return { status: x.status, location: x.location };
	}
}
