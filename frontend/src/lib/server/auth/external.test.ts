/**
 * Tests of the external authentication flow (AUTH-12, AUTH-14), of the profile
 * (AUTH-09/10/11) and of the static pages (AUTH-01/02).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setupAuth, fakeEvent, run, type AuthEnv } from '../testing/auth.js';
import { hashPassword } from './passwords.js';
import {
	authMethods,
	bindUser,
	endAuth,
	finishAuth,
	methodList,
	requireMethod,
	revokeBinding,
	startAuth,
	type AuthMethod
} from './external.js';
import { requireSession, saveProfile, sessionAccount } from './profile.js';
import { staticPage, tosLinks } from './static-pages.js';

let env: AuthEnv;
const uid = () => `u${randomBytes(4).toString('hex')}`;
const users = () => env.database.c.users;

/** Inserts a user and returns it. */
async function user(fields: Record<string, unknown> = {}) {
	const name = uid();
	const doc = {
		username: name,
		realname: 'Real',
		email: `${name}@x.org`,
		password: await hashPassword('secret123'),
		bindings: {},
		language: 'en',
		...fields
	};
	await users().insertOne({ ...doc } as never);
	return doc;
}

/** A logged-in session of a user. */
function sessionOf(u: { username: string; email: string }) {
	const session = env.sessions.create();
	Object.assign(session.doc, { loggedin: true, username: u.username, email: u.email });
	return session;
}

/** A fake auth method whose callback returns `result`. */
function fake(id: string, result: unknown): AuthMethod {
	const method: AuthMethod = {
		id,
		name: id.toUpperCase(),
		authLink: async (storage) => ((storage.state = 's'), `https://idp.example/${id}`),
		callback: vi.fn(async () => {
			if (result instanceof Error) throw result;
			return result as never;
		})
	};
	authMethods.set(id, method);
	return method;
}

beforeAll(async () => {
	env = await setupAuth();
});
afterAll(() => env.drop());

describe('bindUser (legacy bind_user cases)', () => {
	it('creates an account without username for a new identity', async () => {
		const session = env.sessions.create();
		session.doc.language = 'fr';
		const email = `${uid()}@X.org`;
		expect(await bindUser(session, 'ext', { id: 'p1', realname: 'New', email })).toBeNull();
		const doc = (await users().findOne({ 'bindings.ext.0': 'p1' }))!;
		expect(doc).toMatchObject({
			username: '',
			realname: 'New',
			email: email.replace('X.org', 'x.org'),
			language: 'fr',
			tos_accepted: false,
			bindings: { ext: ['p1', {}] }
		});
		expect(session.doc).toMatchObject({ loggedin: true, username: '' });
	});

	it('signs in a bound identity, refreshes or ignores it when logged in', async () => {
		const u = await user({ bindings: { ext: ['p2', {}] } });
		const anonymous = env.sessions.create();
		expect(await bindUser(anonymous, 'ext', { id: 'p2', realname: 'X', email: 'other@x.org' })).toBeNull();
		expect(anonymous.doc.username).toBe(u.username);
		expect(
			await bindUser(sessionOf(u), 'ext', { id: 'p2', realname: 'X', email: u.email, additional: { a: 1 } })
		).toBeNull();
		expect((await users().findOne({ username: u.username }))!.bindings.ext).toEqual(['p2', { a: 1 }]);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const other = await user();
		expect(await bindUser(sessionOf(other), 'ext', { id: 'p2', realname: 'X', email: other.email })).toBeNull();
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
		expect((await users().findOne({ username: other.username }))!.bindings).toEqual({});
	});

	it('binds a new identity to the logged-in user (by account, also without username)', async () => {
		const u = await user();
		expect(await bindUser(sessionOf(u), 'ext', { id: 'p3', realname: 'X', email: 'whatever@x.org' })).toBeNull();
		expect((await users().findOne({ username: u.username }))!.bindings).toEqual({ ext: ['p3', {}] });
		const [a, b] = [await user({ username: '' }), await user({ username: '' })];
		expect(await bindUser(sessionOf(a), 'ext', { id: 'p4', realname: 'X', email: 'w@x.org' })).toBeNull();
		expect((await users().findOne({ email: a.email }))!.bindings).toEqual({ ext: ['p4', {}] });
		expect((await users().findOne({ email: b.email }))!.bindings).toEqual({});
		const unknown = env.sessions.create();
		unknown.doc.loggedin = true;
		expect(await bindUser(unknown, 'ext', { id: 'p6', realname: 'X', email: 'w@x.org' })).toBe('Incorrect email.');
	});

	it('refuses unusable identities and unbound existing addresses', async () => {
		const u = await user();
		const bind = (identity: { id: string; realname: string; email: string }) =>
			bindUser(env.sessions.create(), 'ext', identity);
		expect(await bind({ id: 'p5', realname: 'X', email: 'bad' })).toContain("Couldn't fetch");
		expect(await bind({ id: '', realname: 'X', email: 'a@x.org' })).toContain("Couldn't fetch");
		expect(await bind({ id: 'p5', realname: ' ', email: `${uid()}@x.org` })).toContain("Couldn't fetch");
		expect(await bind({ id: 'p5', realname: 'X', email: u.email })).toContain('already exists');
	});
});

describe('revokeBinding', () => {
	it('removes bindings but never the last one of a passwordless account', async () => {
		const u = await user({ bindings: { a: ['1', {}], b: ['2', {}] } });
		const doc = async () => users().findOne({ username: u.username });
		expect(await revokeBinding(await doc(), 'zz')).toBe('Incorrect authentication binding.');
		expect(await revokeBinding(null, 'a')).toBe('Incorrect authentication binding.');
		expect(await revokeBinding(await doc(), 'a')).toBeNull();
		expect(await revokeBinding(await doc(), 'b')).toBeNull();
		expect((await doc())!.bindings).toEqual({});
		const external = await user({ password: undefined, bindings: { a: ['1', {}] } });
		expect(await revokeBinding(await users().findOne({ username: external.username }), 'a')).toBe(
			'You must set a password before removing all bindings.'
		);
	});
});

describe('flow', () => {
	it('lists methods and requires known ones outside LTI', async () => {
		fake('listed', null);
		expect(methodList()).toContainEqual({ id: 'listed', name: 'LISTED', imlink: null });
		const event = fakeEvent(env.sessions);
		expect(requireMethod('listed', event).id).toBe('listed');
		expect(await run(() => requireMethod('nope', event))).toMatchObject({ status: 404 });
		event.locals.session.doc.is_lti = true;
		expect(await run(() => requireMethod('listed', event))).toMatchObject({ status: 403 });
	});

	it('starts with a safe return path and finishes by signing in', async () => {
		const email = `${uid()}@x.org`;
		const method = fake('ok', { id: uid(), realname: 'R', email });
		const session = env.sessions.create();
		expect(await startAuth(session, method, '//evil.example', new URL('http://x/'))).toBe('https://idp.example/ok');
		expect(session.doc.auth_storage.ok).toEqual({ redir_url: '/', state: 's' });
		await startAuth(session, method, '/course/x', new URL('http://x/'));
		expect(await finishAuth(session, method, { url: new URL('http://x/'), form: null })).toEqual({
			location: '/course/x'
		});
		expect(session.doc.loggedin).toBe(true);
	});

	it('reports provider failures, form errors and binding errors', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const input = { url: new URL('http://x/'), form: null };
		expect(await finishAuth(env.sessions.create(), fake('broken', new Error('x')), input)).toMatchObject({
			location: '/signin',
			error: expect.stringContaining("Couldn't fetch")
		});
		expect(errors).toHaveBeenCalled();
		errors.mockRestore();
		expect(await finishAuth(env.sessions.create(), fake('form', 'Unknown user'), input)).toEqual({
			error: 'Unknown user'
		});
		const u = await user();
		expect(
			await finishAuth(env.sessions.create(), fake('dup', { id: uid(), realname: 'R', email: u.email }), input)
		).toMatchObject({ location: '/signin', error: expect.stringContaining('already exists') });
		const logged = sessionOf(u);
		logged.doc.auth_storage = { none: { redir_url: '/preferences/bindings' } };
		expect(await finishAuth(logged, fake('none', null), input)).toMatchObject({ location: '/preferences/bindings' });
	});

	it('ends a flow with a flash message and a redirect', async () => {
		const event = fakeEvent(env.sessions);
		expect(await run(() => endAuth(event.cookies as never, { location: '/x', error: 'oops' }))).toMatchObject({
			status: 303,
			location: '/x'
		});
		expect(event.jar.get('inginious_flash')).toContain('oops');
		expect(await run(() => endAuth(event.cookies as never, {}))).toMatchObject({ location: '/signin' });
	});
});

describe('profile', () => {
	const form = (extra: Record<string, unknown> = {}) => ({
		realname: 'New Name',
		language: 'fr',
		timezone: 'Europe/Brussels',
		code_indentation: 'tabs',
		tos: false,
		...extra
	});

	it('guards the preference pages', async () => {
		const event = fakeEvent(env.sessions, { url: 'http://x/preferences/profile' });
		expect(await run(() => requireSession(event))).toMatchObject({
			status: 302,
			location: '/signin?redirect=%2Fpreferences%2Fprofile'
		});
		event.locals.session.doc.loggedin = true;
		expect(requireSession(event)).toBe(event.locals.session.doc);
	});

	it('saves the preferences and updates the session', async () => {
		const u = await user();
		const session = sessionOf(u);
		expect(await saveProfile(session, form({ language: 'xx', code_indentation: 'zz' }))).toEqual({
			message: 'Profile updated.'
		});
		expect(await users().findOne({ username: u.username })).toMatchObject({
			realname: 'New Name',
			language: 'en',
			code_indentation: '4',
			timezone: 'Europe/Brussels'
		});
		expect(session.doc).toMatchObject({ realname: 'New Name', language: 'en', timezone: 'Europe/Brussels' });
		await saveProfile(session, form({ timezone: 'UTC' }));
		expect(session.doc.language).toBe('fr');
		expect(await sessionAccount(env.sessions.create())).toBeNull();
	});

	it('validates every field', async () => {
		const u = await user();
		const msg = async (extra: Record<string, unknown>, session = sessionOf(u)) =>
			((await saveProfile(session, form(extra))) as { data: { message: string } }).data.message;
		expect(await msg({ realname: ' ' })).toBe('Name is too short.');
		expect(await msg({ timezone: 'Mars/Base' })).toBe('Incorrect timezone.');
		expect(await msg({ passwd: '12345', passwd2: '12345' })).toBe('Password too short.');
		expect(await msg({ passwd: '123456', passwd2: '1234567' })).toBe("Passwords don't match !");
		expect(await msg({ passwd: '123456', passwd2: '123456', oldpasswd: 'wrong' })).toBe('Incorrect old password.');
		expect(await msg({ passwd: '123456', passwd2: '123456' })).toBe('Incorrect old password.');
		expect(await msg({}, env.sessions.create())).toBe('Incorrect email.');
	});

	it('changes the password, closes other sessions and clears reset tokens', async () => {
		const u = await user({ reset: 'tok' });
		await env.database.c.sessions.insertOne({
			_id: new (await import('mongodb')).ObjectId(),
			username: u.username
		} as never);
		const session = sessionOf(u);
		expect(
			await saveProfile(session, form({ passwd: 'newpass1', passwd2: 'newpass1', oldpasswd: 'secret123' }))
		).toEqual({ message: 'Profile updated.' });
		const doc = (await users().findOne({ username: u.username }))!;
		expect(doc.password).not.toBe(u.password);
		expect(doc.reset).toBeUndefined();
		expect(await env.database.c.sessions.countDocuments({ username: u.username })).toBe(0);
		env.configure({ allow_registration: false });
		await saveProfile(session, form({ passwd: 'ignored1', passwd2: 'ignored1' }));
		expect((await users().findOne({ username: u.username }))!.password).toBe(doc.password);
		env.configure();
	});

	it('lets an external account choose its username and a password at once', async () => {
		const u = await user({ username: '', password: undefined, email: `${uid()}@x.org` });
		const session = sessionOf(u);
		const taken = await user();
		const msg = async (username: string) =>
			((await saveProfile(session, form({ username }))) as { data: { message: string } }).data.message;
		expect(await msg('ab')).toBe('Invalid username format.');
		expect(await msg(taken.username)).toBe('Username already taken');
		const name = uid();
		expect(await saveProfile(session, form({ username: name, passwd: 'secret12', passwd2: 'secret12' }))).toEqual({
			message: 'Profile updated.'
		});
		expect((await users().findOne({ username: name }))!.password).toMatch(/^argon2id-/);
		expect(session.doc.username).toBe(name);
		await saveProfile(session, form({ username: 'ignored' }));
		expect(session.doc.username).toBe(name);
	});

	it('records the terms of service checkbox (also its revocation)', async () => {
		env.configure({ terms_page: 'terms', privacy_page: 'privacy' });
		expect(tosLinks()).toEqual({ terms: '/pages/terms', privacy: '/pages/privacy' });
		const u = await user();
		const session = sessionOf(u);
		await saveProfile(session, form({ tos: true }));
		expect(session.doc.tos_signed).toBe(true);
		await saveProfile(session, form({ tos: false }));
		expect(session.doc.tos_signed).toBe(false);
		expect((await users().findOne({ username: u.username }))!.tos_accepted).toBe(false);
		env.configure();
		expect(tosLinks()).toBeNull();
	});
});

describe('static pages', () => {
	it('loads translated YAML pages, re-reads modified files and refuses bad ids', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'auth-static-'));
		env.configure({ static_directory: dir });
		writeFileSync(join(dir, 'p.yaml'), 'title: T\ncontent: |\n  Hello **world**\n');
		writeFileSync(join(dir, 'p.fr.yaml'), 'title: TF\ncontent: Bonjour\n');
		writeFileSync(join(dir, 'md.yaml'), 'title: M\ncontent: "#MD\\n## Title"\n');
		writeFileSync(join(dir, 'empty.yaml'), '');
		expect(staticPage('p', 'en')).toMatchObject({
			title: 'T',
			html: expect.stringContaining('<strong>world</strong>')
		});
		expect(staticPage('p', 'fr')!.title).toBe('TF');
		expect(staticPage('md', 'en')!.html).toMatch(/<h\d>Title<\/h\d>/);
		expect(staticPage('empty', 'en')).toEqual({ title: '', html: '' });
		for (const id of ['missing', '..', '../etc', 'a/b']) expect(staticPage(id, 'en')).toBeNull();
		writeFileSync(join(dir, 'p.yaml'), 'title: T2\ncontent: x\n');
		utimesSync(join(dir, 'p.yaml'), new Date(), new Date(Date.now() + 5000));
		expect(staticPage('p', 'en')!.title).toBe('T2');
		env.configure();
		expect(staticPage('p', 'en')).toBeNull();
	});
});
