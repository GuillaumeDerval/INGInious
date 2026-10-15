/**
 * Helpers of the authentication integration tests: extra app servers started
 * with configuration overrides (welcome page, terms of service, auth plugins,
 * registration disabled...), Mailpit access and account seeding.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { ObjectId } from 'mongodb';
import { E2E, E2E_ID } from '../setup-data.js';
import { test, withDb } from '../fixtures.js';

/** An extra server of the build under test. */
export interface App {
	url: string;
	stop: () => Promise<void>;
}

/**
 * Starts the built app on its own port with the e2e configuration merged with
 * `overrides` (same database, coverage collected like the main server).
 * @param index small number distinguishing the servers of this run.
 * @param env extra environment variables of the server process.
 */
export async function startApp(
	index: number,
	overrides: Record<string, unknown>,
	env: Record<string, string> = {}
): Promise<App> {
	const base = parse(readFileSync(`e2e/.generated/config-${E2E_ID}.yaml`, 'utf8')) as Record<string, unknown>;
	mkdirSync('e2e/.generated', { recursive: true });
	const file = `e2e/.generated/config-${E2E_ID}-auth${index}.yaml`;
	writeFileSync(file, stringify({ ...base, ...overrides }));
	const url = appUrl(index);
	// Same protocol detection as the main e2e server (playwright.config.ts).
	const child: ChildProcess = spawn('node', [E2E.buildDir], {
		env: {
			...process.env,
			PORT: new URL(url).port,
			PROTOCOL_HEADER: 'x-forwarded-proto',
			INGINIOUS_CONFIG: file,
			NODE_V8_COVERAGE: `${E2E.coverageDir}/server-raw`,
			...env
		},
		stdio: 'inherit'
	});
	for (let i = 0; i < 100; i++) {
		try {
			await fetch(url, { redirect: 'manual' });
			break;
		} catch {
			await new Promise((r) => setTimeout(r, 200));
		}
	}
	return { url, stop: () => new Promise((resolve) => (child.once('exit', () => resolve()), child.kill('SIGTERM'))) };
}

/**
 * URL of the extra server number `index` (0–19) of this run (distinct ports per run).
 * Each test file uses its own index: files run in parallel.
 */
export const appUrl = (index: number) => `http://localhost:${20000 + (E2E.port - 4173) * 20 + index}`;

/**
 * Runs the tests of the current file serially against an extra server started
 * with `overrides` (index distinguishes the servers of the run).
 */
export function useApp(index: number, overrides: Record<string, unknown> = {}): void {
	let app: App | undefined;
	test.describe.configure({ mode: 'serial' });
	test.use({ baseURL: appUrl(index) });
	test.beforeAll(async () => void (app = await startApp(index, overrides)));
	test.afterAll(async () => app?.stop());
}

/** A unique suffix for test data. */
export const uid = () => randomBytes(4).toString('hex');

/** Waits for the last mail sent to `address` and returns its plain-text body. */
export async function lastMail(address: string): Promise<{ subject: string; text: string }> {
	for (let i = 0; i < 50; i++) {
		const search = await (
			await fetch(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)
		).json();
		if (search.messages?.length) {
			const message = await (await fetch(`http://localhost:8025/api/v1/message/${search.messages[0].ID}`)).json();
			return { subject: message.Subject, text: message.Text };
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(`No mail for ${address}`);
}

/** Number of mails sent to `address`. */
export async function mailCount(address: string): Promise<number> {
	const search = await (
		await fetch(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)
	).json();
	return search.messages_count ?? search.messages?.length ?? 0;
}

/** Inserts a user (password "superadmin" unless given) and returns it. */
export async function createUser(fields: Record<string, unknown> = {}) {
	const name = `auth_${uid()}`;
	const user = {
		username: name,
		realname: `Real ${name}`,
		email: `${name}@inginious.local`,
		password: E2E.passwordHash,
		bindings: {},
		language: 'en',
		code_indentation: '4',
		tos_accepted: true,
		...fields
	};
	await withDb((db) => db.collection('users').insertOne({ ...user }));
	return user;
}

/** Creates a logged-in session for any user document (even without username) and returns the cookie. */
export async function sessionCookie(
	user: { username: string; email: string; realname: string; tos_accepted?: boolean },
	url: string
) {
	const id = new ObjectId();
	await withDb((db) =>
		db.collection('sessions').insertOne({
			_id: id,
			permanent: true,
			is_lti: false,
			loggedin: true,
			auth_storage: {},
			expiration: new Date(Date.now() + 3600_000),
			code_indentation: '4',
			email: user.email,
			language: 'en',
			realname: user.realname,
			token: null,
			tos_signed: user.tos_accepted ?? false,
			username: user.username,
			timezone: 'UTC'
		})
	);
	const value = `${id.toHexString()}.${createHmac('sha256', E2E.secretKey).update(id.toHexString()).digest('base64url')}`;
	return { name: 'inginious_session_id', value, url };
}
