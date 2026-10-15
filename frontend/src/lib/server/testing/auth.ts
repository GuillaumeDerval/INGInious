/**
 * Test support of the authentication area: services backed by a throw-away
 * database (real session store, Mailpit SMTP) and fake SvelteKit request events.
 * Excluded from coverage (test support code).
 */
import { setServices, type Services } from '../app.js';
import { buildConfig } from '../config.js';
import { SessionStore, type Session } from '../auth/session.js';
import { createTestDatabase, type TestDatabase } from './db.js';

/** A test environment: database, session store and a way to change the configuration. */
export interface AuthEnv extends TestDatabase {
	sessions: SessionStore;
	/** Installs a configuration made of the defaults plus `extra` keys. */
	configure(extra?: Record<string, unknown>): void;
}

/** Creates the database and installs the services (Mailpit at localhost:1025). */
export async function setupAuth(extra: Record<string, unknown> = {}): Promise<AuthEnv> {
	const t = await createTestDatabase();
	const sessions = new SessionStore(
		t.database,
		buildConfig({ backend: 'tcp://x:1', session_parameters: { secret_key: 'k' } }).session
	);
	const configure = (more: Record<string, unknown> = {}) =>
		setServices({
			config: buildConfig({
				backend: 'tcp://x:1',
				session_parameters: { secret_key: 'k' },
				smtp: { host: 'localhost', port: 1025, sendername: 'a@inginious.local' },
				...extra,
				...more
			}),
			db: t.database,
			sessions
		} as unknown as Services);
	configure();
	return { ...t, sessions, configure };
}

/** Options of a fake request event. */
export interface EventOptions {
	session?: Session;
	/** Posted form fields (makes the request a POST). */
	form?: Record<string, string> | FormData;
	url?: string;
	params?: Record<string, string>;
	user?: App.Locals['user'];
}

/** Builds a fake request event with an in-memory cookie jar (`event.jar`). */
export function fakeEvent(sessions: SessionStore, o: EventOptions = {}) {
	const jar = new Map<string, string>();
	const url = new URL(o.url ?? 'http://localhost/');
	const body = o.form instanceof FormData ? o.form : o.form ? new URLSearchParams(o.form) : undefined;
	const session = o.session ?? sessions.create();
	return {
		url,
		params: o.params ?? {},
		request: new Request(url, body ? { method: 'POST', body } : {}),
		locals: { session, user: o.user ?? null, lang: 'en' },
		cookies: {
			get: (n: string) => jar.get(n),
			set: (n: string, v: string) => void jar.set(n, v),
			delete: (n: string) => void jar.delete(n)
		},
		getClientAddress: () => '127.0.0.1',
		jar
	};
}

/** Runs a load/action and returns its result, or the thrown redirect/error object. */
export async function run<T>(
	fn: () => T | Promise<T>
): Promise<T | { status: number; location?: string; body?: { message: string } }> {
	try {
		return await fn();
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) return e as { status: number };
		throw e;
	}
}
