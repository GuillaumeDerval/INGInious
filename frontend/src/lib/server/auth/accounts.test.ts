/**
 * Tests of the local accounts module (AUTH-04/05/07/08/13/19) against a
 * throw-away database and the Mailpit SMTP catcher of the Colima stack.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { MongoServerError, ObjectId } from 'mongodb';
import { z } from 'zod';
import { setupAuth, type AuthEnv } from '../testing/auth.js';
import { hashPassword } from './passwords.js';
import { clientAddress, RateLimiter } from './rate-limit.js';
import { parseForm } from '../forms.js';
import * as accounts from './accounts.js';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
let env: AuthEnv;
const url = new URL('http://localhost:5173/register');
const users = () => env.database.c.users;
/** A unique name. */
const uid = () => `u${randomBytes(4).toString('hex')}`;

/** Waits for a mail to `address` and returns its text. */
async function mailTo(address: string): Promise<string> {
	for (let i = 0; i < 50; i++) {
		const search = await (
			await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)
		).json();
		if (search.messages?.length)
			return (await (await fetch(`${MAILPIT}/api/v1/message/${search.messages[0].ID}`)).json()).Text;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error('no mail');
}

/** A valid registration form. */
const newForm = (name: string) => ({
	username: name,
	realname: 'R',
	passwd: 'secret1234',
	passwd2: 'secret1234',
	tos: true
});

/** Inserts a user. */
async function user(fields: Record<string, unknown> = {}) {
	const name = uid();
	const doc = {
		username: name,
		realname: 'Real',
		email: `${name}@x.org`,
		password: await hashPassword('secret123'),
		bindings: {},
		language: 'fr',
		...fields
	};
	await users().insertOne({ ...doc } as never);
	return doc;
}

beforeAll(async () => {
	env = await setupAuth();
});
afterAll(() => env.drop());

describe('validation helpers', () => {
	it('sanitizes e-mail addresses like legacy', () => {
		expect(accounts.sanitizeEmail('Auth_R@X.Org')).toBe('Auth_R@x.org');
		expect(accounts.sanitizeEmail('"a!b"@X.org')).toBe('"a!b"@x.org');
		for (const bad of ['bad', 'a@b', 'a@b.c', 'a@@b.org']) expect(accounts.sanitizeEmail(bad)).toBeNull();
	});

	it('checks new passwords: configurable minimum length (10 by default), maximum 1024', () => {
		expect(accounts.passwordError('123456789', '123456789')).toBe('Password too short.');
		expect(accounts.passwordError('1234567890', '12345678901')).toBe("Passwords don't match !");
		expect(accounts.passwordError('1234567890', '1234567890')).toBeNull();
		const long = 'x'.repeat(1025);
		expect(accounts.passwordError(long, long)).toBe('Password too long.');
		expect(accounts.passwordError('x'.repeat(1024), 'x'.repeat(1024))).toBeNull();
		env.configure({ password_min_length: 6 });
		expect(accounts.passwordError('123456', '123456')).toBeNull();
		env.configure();
	});

	it('parses forms with zod and answers 400 otherwise', async () => {
		const request = (body: string) => new Request('http://x/', { method: 'POST', body: new URLSearchParams(body) });
		expect(await parseForm(request('a=1'), z.object({ a: z.string() }))).toEqual({ a: '1' });
		await expect(parseForm(request('b=1'), z.object({ a: z.string() }))).rejects.toMatchObject({
			status: 400
		});
	});

	it('applies one policy and the same defaults to every new account', async () => {
		const f = { username: 'jdoe', realname: ' John ', email: 'J@X.Org' };
		expect(await accounts.newUserDoc({ ...f, username: 'ab' })).toBe('Invalid username format.');
		expect(await accounts.newUserDoc({ ...f, username: '' })).toBe('Invalid username format.');
		expect(await accounts.newUserDoc({ ...f, realname: ' ' })).toBe('Name is too short.');
		expect(await accounts.newUserDoc({ ...f, email: 'bad' })).toBe('Invalid email format.');
		expect(await accounts.newUserDoc({ ...f, password: '123456789' })).toBe('Password too short.');
		expect(await accounts.newUserDoc({ ...f, password: 'x'.repeat(1025) })).toBe('Password too long.');
		expect(await accounts.newUserDoc({ ...f, tos: true })).toEqual({
			username: 'jdoe',
			realname: 'John',
			email: 'J@x.org',
			language: 'en',
			code_indentation: '4',
			bindings: {},
			ltibindings: {},
			tos_accepted: false,
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			pinned_courses: []
		});
		const external = { ...f, username: '', bindings: { gh: ['1', {}] }, language: 'fr', timezone: 'UTC' };
		expect(await accounts.newUserDoc(external)).toMatchObject({ username: '', language: 'fr', timezone: 'UTC' });
		env.configure({ terms_page: 't', privacy_page: 'p' });
		expect(await accounts.newUserDoc({ ...f, tos: true, password: 'secret1234' })).toMatchObject({
			tos_accepted: true,
			password: expect.stringMatching(/^argon2id-/)
		});
		expect(await accounts.newUserDoc(f)).toMatchObject({ tos_accepted: false });
		env.configure();
	});

	it('rate limits per key and window', () => {
		vi.useFakeTimers();
		const limiter = new RateLimiter(2, 1000, 3);
		expect([limiter.hit('k'), limiter.hit('k'), limiter.hit('k')]).toEqual([true, true, false]);
		expect(limiter.blocked('k')).toBe(true);
		expect(limiter.blocked('other')).toBe(false);
		vi.advanceTimersByTime(1001);
		expect(limiter.blocked('k')).toBe(false);
		// The memory bound evicts expired then least recently hit keys, never every counter.
		limiter.hit('k');
		limiter.hit('k');
		vi.advanceTimersByTime(500);
		for (const k of ['a', 'b']) limiter.hit(k);
		limiter.hit('c'); // full: 'k' (least recently hit) is evicted
		expect(limiter.blocked('k')).toBe(false);
		for (const k of ['b', 'b']) limiter.hit(k);
		expect(limiter.blocked('b')).toBe(true); // the other counters were kept
		vi.advanceTimersByTime(1001); // all expired: purged before evicting anything
		for (const k of ['d', 'd', 'e']) limiter.hit(k);
		expect([limiter.blocked('d'), limiter.blocked('e')]).toEqual([true, false]);
		vi.useRealTimers();
	});

	it('reads the client address from X-Forwarded-For only behind a configured reverse proxy', () => {
		const ev = (xff: string) => ({
			request: new Request('http://x/', { headers: { 'x-forwarded-for': xff } }),
			getClientAddress: () => '10.0.0.1'
		});
		expect(clientAddress(ev('1.1.1.1'))).toBe('10.0.0.1');
		env.configure({ 'reverse-proxy-config': { enable: true } });
		expect(clientAddress(ev('6.6.6.6, 1.1.1.1'))).toBe('1.1.1.1');
		env.configure({ 'reverse-proxy-config': { enable: true, x_for: 2 } });
		expect(clientAddress(ev('6.6.6.6, 1.1.1.1'))).toBe('6.6.6.6');
		expect(clientAddress(ev(''))).toBe('10.0.0.1');
		env.configure();
	});
});

describe('authenticate / connectUser', () => {
	it('accepts the three hash formats and upgrades legacy ones', async () => {
		const sha = createHash('sha512').update('secret123').digest('hex');
		for (const password of [undefined, `sha512-${sha}`, sha]) {
			const u = await user(password ? { password } : {});
			expect(await accounts.authenticate(` ${u.username} `, 'secret123')).toMatchObject({ username: u.username });
			expect((await users().findOne({ username: u.username }))!.password).toMatch(/^argon2id-/);
			expect(await accounts.authenticate(u.username, 'wrong')).toBeNull();
		}
	});

	it('refuses over-long passwords without hashing them, as failures', async () => {
		const u = await user();
		const verify = vi.spyOn(await import('./passwords.js'), 'verifyPassword');
		const client = uid();
		expect(await accounts.authenticate(u.username, 'x'.repeat(1025), client)).toBeNull();
		expect(verify).not.toHaveBeenCalled();
		verify.mockRestore();
		for (let i = 0; i < 99; i++) await accounts.authenticate(`long${i}`, 'x'.repeat(1025), client);
		expect(await accounts.authenticate((await user()).username, 'secret123', client)).toBeNull();
	});

	it('refuses pending accounts, passwordless accounts and unknown users', async () => {
		const pending = await user({ activate: 'x' });
		const external = await user({ password: undefined });
		expect(await accounts.authenticate(pending.username, 'secret123')).toBeNull();
		expect(await accounts.authenticate(external.username, 'secret123')).toBeNull();
		expect(await accounts.authenticate('nobody', 'x')).toBeNull();
	});

	it('throttles failures per account (any client) and per client (any account)', async () => {
		const u = await user();
		for (let i = 0; i < 20; i++) await accounts.authenticate(u.username, 'wrong', `ip${i}`);
		expect(await accounts.authenticate(u.username, 'secret123', 'good')).toBeNull();
		const v = await user();
		for (let i = 0; i < 100; i++) await accounts.authenticate(`spray${i}`, 'x', 'sprayer');
		expect(await accounts.authenticate(v.username, 'secret123', 'sprayer')).toBeNull();
		expect(await accounts.authenticate(v.username, 'secret123', 'good')).not.toBeNull();
	}, 60_000);

	it('rotates the session and copies the preferences', async () => {
		const session = env.sessions.create();
		await env.sessions.commit(session);
		const oldId = session.doc._id;
		const u = await user({ timezone: 'Europe/Brussels', tos_accepted: true, code_indentation: 'tabs' });
		await accounts.connectUser(session, u as never);
		expect(session.doc._id.equals(oldId)).toBe(false);
		expect(session.doc).toMatchObject({
			loggedin: true,
			username: u.username,
			language: 'fr',
			timezone: 'Europe/Brussels',
			code_indentation: 'tabs',
			tos_signed: true
		});
		await accounts.connectUser(session, {
			...u,
			language: '',
			timezone: undefined,
			code_indentation: undefined,
			tos_accepted: undefined
		} as never);
		expect(session.doc).toMatchObject({ language: 'fr', code_indentation: '4', tos_signed: false });
		session.doc.language = '';
		await accounts.connectUser(session, { ...u, language: '' } as never);
		expect(session.doc.language).toBe('en');
	});
});

describe('registration and activation', () => {
	const form = (name: string, extra: Record<string, unknown> = {}) => ({
		username: name,
		realname: 'Reg',
		email: `${name}@X.org`,
		passwd: 'secret1234',
		passwd2: 'secret1234',
		tos: false,
		...extra
	});

	it('validates the form in the legacy order', async () => {
		const msg = async (extra: Record<string, unknown>) =>
			((await accounts.register(form(uid(), extra), 'en', url, uid())) as { data: { message: string } }).data.message;
		expect(await msg({ username: 'ab' })).toBe('Invalid username format.');
		expect(await msg({ email: 'bad' })).toBe('Invalid email format.');
		expect(await msg({ passwd: '123' })).toBe('Password too short.');
		env.configure({ terms_page: 't', privacy_page: 'p' });
		expect(await msg({})).toBe('Please accept the Terms of Service and Data Privacy');
		env.configure();
	});

	it('answers a taken username generically, only after the rate limit', async () => {
		const taken = await user();
		const client = uid();
		const answer = async () =>
			(
				(await accounts.register(form(taken.username, { email: `${uid()}@x.org` }), 'en', url, client)) as {
					data: { message: string };
				}
			).data.message;
		for (let i = 0; i < 10; i++)
			expect(await answer()).toBe('This username is not available. Please choose another one.');
		expect(await answer()).toBe('Too many requests, please retry later.');
	});

	it('handles accounts created concurrently with the same username or e-mail (unique indexes)', async () => {
		const taken = await user();
		expect(await accounts.insertUser({ ...taken, email: `${uid()}@x.org` } as never)).toBe(false);
		expect(await accounts.insertUser({ ...taken, username: uid() } as never)).toBe(false);
		const insert = vi
			.spyOn(users(), 'insertOne')
			.mockRejectedValueOnce(new MongoServerError({ message: 'E11000 duplicate key', code: 11000 }));
		expect(await accounts.register(form(uid()), 'en', url, uid())).toMatchObject({
			data: { message: 'This username is not available. Please choose another one.' }
		});
		insert.mockRejectedValueOnce(new Error('down'));
		await expect(accounts.insertUser({ ...taken, username: uid(), email: `${uid()}@x.org` } as never)).rejects.toThrow(
			'down'
		);
		insert.mockRestore();
	});

	it('creates the account, mails the activation link and activates once', async () => {
		const name = uid();
		expect(await accounts.register(form(name, { tos: true }), 'de', url, uid())).toEqual({
			message: expect.stringContaining('succesfully registered')
		});
		const doc = (await users().findOne({ username: name }))!;
		expect(doc).toMatchObject({ email: `${name}@x.org`, language: 'de', tos_accepted: false, code_indentation: '4' });
		expect(doc.activate).toMatch(accounts.TOKEN_RE);
		expect(await mailTo(`${name}@x.org`)).toContain(`http://localhost:5173/register?activate=${doc.activate}`);
		expect(await accounts.activate(doc.activate!)).toEqual({ message: 'User successfully activated.' });
		expect(await accounts.activate(doc.activate!)).toMatchObject({
			status: 400,
			data: { message: 'Invalid activation hash.' }
		});
		const expired = `${'a'.repeat(64)}.${Date.now() - 1}`;
		await user({ activate: expired });
		expect(await accounts.activate(expired)).toMatchObject({ status: 400 });
		expect(await accounts.activate('legacy')).toMatchObject({ status: 400 });
	});

	it('does not reveal used e-mail addresses but notifies their owner', async () => {
		const existing = await user();
		const name = uid();
		expect(await accounts.register(form(name, { email: existing.email }), 'en', url, uid())).toEqual({
			message: expect.any(String)
		});
		expect(await users().findOne({ username: name })).toBeNull();
		expect(await mailTo(existing.email)).toContain('/register#lostpasswd');
	});

	it('rolls back the account when the mail cannot be sent, and logs background failures', async () => {
		env.configure({ smtp: { host: 'localhost', port: 1 } });
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const name = uid();
		expect(await accounts.register(form(name), 'en', url, uid())).toMatchObject({
			status: 400,
			data: { message: expect.stringContaining('activation email') }
		});
		expect(await users().findOne({ username: name })).toBeNull();
		const existing = await user();
		await accounts.register(form(uid(), { email: existing.email }), 'en', url, uid());
		await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(2));
		errors.mockRestore();
		env.configure();
	});

	it('limits the number of mails per client and per address', async () => {
		const address = `${uid()}@x.org`;
		for (let i = 0; i < 3; i++) expect(await accounts.requestReset(address, url, uid())).not.toHaveProperty('status');
		// From any client, and also for registrations to that address.
		expect(await accounts.requestReset(address.toUpperCase(), url, uid())).toMatchObject({
			data: { message: 'Too many requests, please retry later.' }
		});
		expect(await accounts.register(form(uid(), { email: address }), 'en', url, uid())).toMatchObject({
			status: 400
		});
		const client = uid();
		for (let i = 0; i < 10; i++) await accounts.requestReset(`${uid()}@x.org`, url, client);
		expect(await accounts.register(form(uid()), 'en', url, client)).toMatchObject({
			data: { message: 'Too many requests, please retry later.' }
		});
		expect(await accounts.requestReset('nobody@x.org', url, client)).toMatchObject({ status: 400 });
	});
});

describe('password reset', () => {
	it('refuses to mail links when the public origin is unknown (foreign Host header)', async () => {
		const evil = new URL('http://evil.example/register');
		const u = await user();
		expect(await accounts.requestReset(u.email, evil, uid())).toMatchObject({
			data: { message: 'Something went wrong while sending you reset email. Please contact the administrator.' }
		});
		expect((await users().findOne({ username: u.username }))?.reset).toBeUndefined();
		const name = uid();
		expect(
			await accounts.register({ ...newForm(name), email: `${name}@x.org` } as never, 'en', evil, uid())
		).toMatchObject({ status: 400 });
		expect(await users().findOne({ username: name })).toBeNull();
	});
	it('answers the same for known and unknown addresses and mails a one-hour link', async () => {
		expect(await accounts.requestReset('bad', url, uid())).toMatchObject({
			data: { message: 'Invalid email format.' }
		});
		const ok = { message: 'An email has been sent to you to reset your password.' };
		expect(await accounts.requestReset('unknown@x.org', url, uid())).toEqual(ok);
		const u = await user({ activate: 'pending' });
		expect(await accounts.requestReset(u.email, url, uid())).toEqual(ok);
		const { reset } = (await users().findOne({ username: u.username }))!;
		expect(Number(reset!.split('.')[1]) - Date.now()).toBeLessThanOrEqual(3600_000);
		expect(await mailTo(u.email)).toContain(`register?reset=${reset}`);
		expect(await accounts.resetUser(reset!)).toMatchObject({ username: u.username });
		expect(await accounts.resetUser('bogus')).toBeNull();

		expect(await accounts.resetPassword('bogus', 'newpass123', 'newpass123')).toMatchObject({
			data: { message: 'Invalid reset hash.', reset: null }
		});
		expect(await accounts.resetPassword(reset!, '123', '123')).toMatchObject({
			data: { message: 'Password too short.', reset: { token: reset, username: u.username } }
		});
		await env.database.c.sessions.insertOne({ _id: new ObjectId(), username: u.username } as never);
		expect(await accounts.resetPassword(reset!, 'newpass123', 'newpass123')).toEqual({
			message: 'Your password has been successfully changed.'
		});
		const doc = (await users().findOne({ username: u.username }))!;
		expect(doc.reset).toBeUndefined();
		expect(doc.activate).toBeUndefined();
		expect(await env.database.c.sessions.countDocuments({ username: u.username })).toBe(0);
		expect(await accounts.authenticate(u.username, 'newpass123')).not.toBeNull();
	});
});

describe('deleteUser / apiKey', () => {
	it('deletes the account, its own submissions and files, keeps group submissions', async () => {
		const u = await user();
		const other = uid();
		const input = await env.database.putFile(new Uint8Array([1, 2]));
		const base = { courseid: 'c', taskid: 't', status: 'done', submitted_on: new Date(), grade: 0 };
		const [own, shared] = [new ObjectId(), new ObjectId()];
		await env.database.c.submissions.insertMany([
			{ ...base, _id: own, username: [u.username], input, archive: null },
			{ ...base, _id: shared, username: [u.username, other], input: new ObjectId() }
		] as never);
		await env.database.c.userTasks.insertOne({ courseid: 'c', taskid: 't', username: u.username } as never);
		await env.database.c.courses.insertOne({ _id: `c${uid()}`, students: [u.username, other] });
		await env.database.c.sessions.insertOne({ _id: new ObjectId(), username: u.username } as never);
		const doc = await users().findOne({ username: u.username });
		expect(await accounts.deleteUser(doc, 'wrong@x.org')).toBe(false);
		expect(await accounts.deleteUser(doc, u.email)).toBe(true);
		expect(await env.database.c.submissions.findOne({ _id: own })).toBeNull();
		expect((await env.database.c.submissions.findOne({ _id: shared }))!.username).toEqual([other]);
		expect(await env.database.db.collection('fs.files').findOne({ _id: input })).toBeNull();
		expect(await env.database.c.userTasks.countDocuments({ username: u.username })).toBe(0);
		expect(await env.database.c.courses.countDocuments({ students: u.username })).toBe(0);
		expect(await env.database.c.sessions.countDocuments({ username: u.username })).toBe(0);
		const v = await users().findOne({ username: (await user()).username });
		expect(await accounts.deleteUser(v)).toBe(true);
		expect(await accounts.deleteUser(v)).toBe(false);
		expect(await accounts.deleteUser(null)).toBe(false);
	});

	it('deletes only its own data for an account without username (AUTH-11)', async () => {
		const [a, b] = [await user({ username: '' }), await user({ username: '' })];
		const sessions = env.database.c.sessions;
		await sessions.insertMany([a, b].map((x) => ({ _id: new ObjectId(), username: '', email: x.email })) as never);
		await env.database.c.userTasks.insertOne({ courseid: 'c', taskid: 't', username: '' } as never);
		expect(await accounts.deleteUser(await users().findOne({ email: a.email }), a.email)).toBe(true);
		expect(await users().findOne({ email: b.email })).not.toBeNull();
		expect(await sessions.countDocuments({ email: a.email })).toBe(0);
		expect(await sessions.countDocuments({ email: b.email })).toBe(1);
		expect(await env.database.c.userTasks.countDocuments({ username: '' })).toBe(1);
	});

	it('generates a stable 80-hex API key', async () => {
		const u = await user();
		const key = await accounts.apiKey(u.username);
		expect(key).toMatch(/^[0-9a-f]{80}$/);
		expect(await accounts.apiKey(u.username)).toBe(key);
		await expect(accounts.apiKey('nobody')).rejects.toThrow();
	});
});
