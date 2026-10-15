/**
 * Test support of the NAV area: copies the NAV course fixtures
 * (e2e/fixtures/courses/nav_*) into a temporary tasks directory, installs
 * services with a throw-away database and seeds the NAV users.
 */
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setServices, type Services } from '../../../src/lib/server/app.js';
import { createTestDatabase } from '../../../src/lib/server/testing/db.js';
import type { Database } from '../../../src/lib/server/db/index.js';
import { resetPlugins } from '../../../src/lib/server/plugins/index.js';

const COURSES = join(import.meta.dirname, '../../../e2e/fixtures/courses');

/** NAV users (nav_carol has an @ok.org address, nav_dave a github binding). */
export const NAV_USERS = [
	'nav_alice',
	'nav_bob',
	'nav_carol',
	'nav_dave',
	'nav_tutor',
	'nav_admin',
	'nav_eve',
	'superadmin'
].map((username) => ({
	username,
	realname: username.replace('nav_', '').replace(/^./, (c) => c.toUpperCase()) + ' Nav',
	email: username === 'nav_carol' ? 'nav_carol@ok.org' : username === 'nav_bob' ? 'nav_bob@x.org' : `${username}@x.org`,
	password: 'x',
	bindings: username === 'nav_dave' ? { github: ['1', {}] } : {},
	language: 'en'
}));

/** A prepared environment. */
export interface NavEnv {
	dir: string;
	db: Database;
	services: Services;
	cleanup: () => Promise<void>;
}

/** Installs the NAV environment; `backend` and `raw` config can be overridden. */
export async function setupNav(extra: Partial<Services> = {}, raw: Record<string, unknown> = {}): Promise<NavEnv> {
	const dir = mkdtempSync(join(tmpdir(), 'inginious-nav-'));
	for (const name of readdirSync(COURSES).filter((n) => n.startsWith('nav_')))
		cpSync(join(COURSES, name), join(dir, name), { recursive: true });
	const tdb = await createTestDatabase();
	await tdb.database.c.users.insertMany(NAV_USERS.map((u) => ({ ...u })) as never);
	const services = {
		config: { tasksDirectory: dir, superadmins: ['superadmin'], isTosDefined: false, raw },
		db: tdb.database,
		...extra
	} as unknown as Services;
	setServices(services);
	resetPlugins();
	return {
		dir,
		db: tdb.database,
		services,
		cleanup: async () => {
			await tdb.drop();
			rmSync(dir, { recursive: true, force: true });
			setServices(null);
		}
	};
}

/** Builds a fake request event for route loads/actions (POST when `fields` are given). */
export function navEvent(
	username: string | null,
	opts: { params?: Record<string, string>; fields?: Record<string, string>; url?: string; lti?: boolean } = {}
) {
	const url = new URL(opts.url ?? 'http://localhost/page');
	return {
		locals: {
			user: username
				? {
						username,
						realname: username,
						email: '',
						language: 'en',
						timezone: 'UTC',
						codeIndentation: '4',
						superadmin: username === 'superadmin'
					}
				: null,
			lang: 'en',
			session: { doc: { is_lti: !!opts.lti } }
		},
		params: opts.params ?? {},
		url,
		cookies: { get: () => undefined, set: () => {}, delete: () => {} },
		request: new Request(url, opts.fields ? { method: 'POST', body: new URLSearchParams(opts.fields) } : {})
	} as never;
}

/** Runs a load/action and returns its value, or `{ status, location }` / `{ status, message }` for redirects and errors. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loads of different routes: callers read their own fields
export async function outcome(fn: () => unknown): Promise<any> {
	try {
		return await fn();
	} catch (e) {
		const x = e as { status?: number; location?: string; body?: { message: string } };
		if (x.status)
			return x.location ? { status: x.status, location: x.location } : { status: x.status, message: x.body?.message };
		throw e;
	}
}
