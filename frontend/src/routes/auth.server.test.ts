/**
 * Tests of the server side of the authentication routes (AUTH-01/02/05/06/07/08,
 * AUTH-11/12/13/14/16/17): loads, form actions and endpoints, with a real
 * session store and throw-away database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setupAuth, fakeEvent, run, type AuthEnv, type EventOptions } from '#lib/server/testing/auth.js';
import { hashPassword } from '#lib/server/auth/passwords.js';
import { authMethods, type AuthMethod } from '#lib/server/auth/external.js';
import * as home from './+page.server.js';
import * as pages from './pages/[pageid]/+page.server.js';
import * as signin from './signin/+page.server.js';
import * as logout from './logout/+page.server.js';
import * as registerPage from './register/+page.server.js';
import * as prefsLayout from './preferences/+layout.server.js';
import * as prefs from './preferences/+page.server.js';
import * as profile from './preferences/profile/+page.server.js';
import * as bindings from './preferences/bindings/+page.server.js';
import * as deletion from './preferences/delete/+page.server.js';
import * as start from './auth/signin/[authid]/+server.js';
import * as callback from './auth/callback/[authid]/+page.server.js';
import * as formPage from './auth/page/[authid]/+page.server.js';
import * as metadata from './auth/[authid]/metadata/+server.js';

let env: AuthEnv;
const uid = () => `u${randomBytes(4).toString('hex')}`;
/** A fake event (typed loosely for the route functions). */
const ev = (o: EventOptions = {}) => fakeEvent(env.sessions, o) as ReturnType<typeof fakeEvent> & never;
/** Calls a route function with a fake event. */
const call = (fn: unknown, o: EventOptions = {}) => {
	const event = ev(o);
	return run(() => (fn as (e: unknown) => unknown)(event));
};

/** Inserts a user and returns it with a logged-in session. */
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
	await env.database.c.users.insertOne({ ...doc } as never);
	const session = env.sessions.create();
	Object.assign(session.doc, { loggedin: true, username: doc.username, email: doc.email });
	return { ...doc, session };
}

/** A fake auth method. */
function method(id: string, extra: Partial<AuthMethod> = {}, result: unknown = null): AuthMethod {
	const m: AuthMethod = {
		id,
		name: id,
		authLink: async () => `https://idp.example/${id}`,
		callback: async () => result as never,
		...extra
	};
	authMethods.set(id, m);
	return m;
}

beforeAll(async () => {
	env = await setupAuth();
});
afterAll(() => env.drop());

describe('home and static pages', () => {
	it('redirects to the course list or shows the welcome page', async () => {
		expect(await call(home.load)).toMatchObject({ status: 302, location: '/courselist' });
		const dir = mkdtempSync(join(tmpdir(), 'auth-pages-'));
		writeFileSync(join(dir, 'w.yaml'), 'title: W\ncontent: Hi\n');
		env.configure({ static_directory: dir, welcome_page: 'w' });
		expect(await call(home.load)).toMatchObject({ title: 'W' });
		expect(await call(pages.load, { params: { pageid: 'w' } })).toMatchObject({ title: 'W' });
		expect(await call(pages.load, { params: { pageid: 'nope' } })).toMatchObject({ status: 404 });
		env.configure({ static_directory: dir, welcome_page: 'missing' });
		expect(await call(home.load)).toMatchObject({ status: 404 });
		env.configure();
	});
});

describe('/signin and /logout', () => {
	it('shows the form, or redirects logged-in visitors', async () => {
		method('btn', { imlink: '/i.png' });
		expect(await call(signin.load, { url: 'http://x/signin?redirect=/course/a' })).toMatchObject({
			redirect: '/course/a',
			passwordForm: true,
			methods: expect.arrayContaining([{ id: 'btn', name: 'btn', imlink: '/i.png' }])
		});
		const u = await user();
		expect(await call(signin.load, { session: u.session, url: 'http://x/signin?redirect=https://evil' })).toMatchObject(
			{ status: 303, location: '/mycourses' }
		);
		u.session.doc.username = '';
		expect(await call(signin.load, { session: u.session })).toMatchObject({ location: '/preferences/profile' });
	});

	it('signs in with the right password only', async () => {
		const u = await user();
		expect(await call(signin.actions.default, { form: { login: u.username, password: 'bad' } })).toMatchObject({
			status: 400,
			data: { message: 'Invalid login/password', login: u.username }
		});
		const session = env.sessions.create();
		expect(
			await call(signin.actions.default, {
				session,
				form: { login: u.username, password: 'secret123', redirect: '/course/a' }
			})
		).toMatchObject({ status: 303, location: '/course/a' });
		expect(session.doc).toMatchObject({ loggedin: true, username: u.username });
	});

	it('logs out with POST only', async () => {
		expect(await call(logout.load)).toMatchObject({ location: '/signin' });
		const u = await user();
		expect(await call(logout.load, { session: u.session })).toBeUndefined();
		expect(await call(logout.actions.default, { session: u.session })).toMatchObject({
			status: 303,
			location: '/courselist'
		});
		expect(u.session.destroyed).toBe(true);
	});
});

describe('/register', () => {
	const reg = registerPage.actions;

	it('is forbidden to logged-in users and when registration is disabled', async () => {
		const u = await user();
		expect(await call(registerPage.load, { session: u.session })).toMatchObject({ status: 403 });
		env.configure({ allow_registration: false });
		expect(await call(reg.lostpasswd, { form: { recovery_email: 'a@x.org' } })).toMatchObject({ status: 403 });
		env.configure();
	});

	it('shows the activation button, the reset form or the forms', async () => {
		expect(await call(registerPage.load, { url: 'http://x/register?activate=t' })).toMatchObject({
			activate: 't',
			reset: null,
			invalidReset: false,
			tos: null
		});
		expect(await call(registerPage.load, { url: 'http://x/register?reset=bogus' })).toMatchObject({
			reset: null,
			invalidReset: true
		});
		const token = `${'b'.repeat(64)}.${Date.now() + 60_000}`;
		const u = await user({ reset: token });
		expect(await call(registerPage.load, { url: `http://x/register?reset=${token}` })).toMatchObject({
			reset: { token, username: u.username, realname: 'Real' }
		});
	});

	it('registers, requests resets and activates', async () => {
		const name = uid();
		const form = {
			username: name,
			realname: 'R',
			email: `${name}@x.org`,
			passwd: 'secret123',
			passwd2: 'secret123',
			term_policy_check: 'on'
		};
		expect(await call(reg.register, { form })).toMatchObject({ message: expect.stringContaining('registered') });
		expect(await call(reg.register, { form: { username: 'x' } })).toMatchObject({ status: 400 });
		expect(await call(reg.lostpasswd, { form: { recovery_email: 'nobody@x.org' } })).toMatchObject({
			message: expect.any(String)
		});
		const { activate } = (await env.database.c.users.findOne({ username: name }))!;
		expect(await call(reg.activate, { form: { activate: 'bad' } })).toMatchObject({ status: 400 });
		const event = fakeEvent(env.sessions, { form: { activate: activate! } });
		expect(await run(() => reg.activate(event as never))).toMatchObject({ status: 303, location: '/signin' });
		expect(event.jar.get('inginious_flash')).toContain('activated');
	});

	it('resets the password', async () => {
		const token = `${'c'.repeat(64)}.${Date.now() + 60_000}`;
		await user({ reset: token });
		expect(await call(reg.resetpasswd, { form: { reset: token, passwd: '1', passwd2: '1' } })).toMatchObject({
			status: 400,
			data: { reset: { token } }
		});
		expect(
			await call(reg.resetpasswd, { form: { reset: token, passwd: 'newpass1', passwd2: 'newpass1' } })
		).toMatchObject({ status: 303, location: '/signin' });
	});
});

describe('/preferences', () => {
	it('guards the section and opens the profile', async () => {
		expect(await call(prefsLayout.load, { url: 'http://x/preferences/profile' })).toMatchObject({ status: 302 });
		const u = await user();
		expect(await call(prefsLayout.load, { session: u.session })).toEqual({ allowDeletion: true });
		expect(await call(prefs.load)).toMatchObject({ location: '/preferences/profile' });
	});

	it('loads and saves the profile', async () => {
		const u = await user({ timezone: 'Europe/Brussels', code_indentation: 'tabs' });
		expect(await call(profile.load, { session: u.session })).toMatchObject({
			profile: { username: u.username, timezone: 'Europe/Brussels', codeIndentation: 'tabs', hasPassword: true },
			passwords: true,
			tos: null,
			tosSigned: false
		});
		const external = await user({ password: undefined, language: '' });
		expect(await call(profile.load, { session: external.session })).toMatchObject({
			profile: { language: 'en', timezone: expect.any(String), codeIndentation: '4', hasPassword: false }
		});
		const ghost = env.sessions.create();
		Object.assign(ghost.doc, { loggedin: true, username: 'ghost', email: 'g@x.org' });
		expect(await call(profile.load, { session: ghost })).toMatchObject({ status: 404 });
		expect(
			await call(profile.actions.default, {
				session: u.session,
				form: { realname: 'N', language: 'fr', timezone: 'UTC', code_indentation: '2', term_policy_check: 'on' }
			})
		).toEqual({ message: 'Profile updated.' });
	});

	it('lists, adds and revokes bindings', async () => {
		method('bindable');
		const u = await user({ bindings: { bindable: ['1', { a: 'b' }], gone: ['2'] } });
		const data = (await call(bindings.load, { session: u.session })) as {
			bindings: unknown[];
			available: { id: string }[];
		};
		expect(data.bindings).toEqual([
			{ id: 'bindable', name: 'bindable', identifier: '1', additional: [['a', 'b']], configured: true },
			{ id: 'gone', name: 'gone', identifier: '2', additional: [], configured: false }
		]);
		expect(data.available.map((m) => m.id)).not.toContain('bindable');
		expect(await call(bindings.load, { session: env.sessions.create() })).toMatchObject({ status: 302 });
		const ghost = env.sessions.create();
		ghost.doc.loggedin = true;
		expect(await call(bindings.load, { session: ghost })).toMatchObject({ bindings: [] });
		expect(await call(bindings.actions.add, { session: u.session, form: { auth_binding: 'nope' } })).toMatchObject({
			status: 400
		});
		expect(await call(bindings.actions.add, { session: u.session, form: { auth_binding: 'bindable' } })).toMatchObject({
			status: 303,
			location: 'https://idp.example/bindable'
		});
		expect(await call(bindings.actions.revoke, { session: u.session, form: { revoke_auth_binding: 'gone' } })).toEqual({
			message: 'Binding removed.'
		});
		expect(
			await call(bindings.actions.revoke, { session: u.session, form: { revoke_auth_binding: 'gone' } })
		).toMatchObject({ status: 400 });
		ghost.doc.username = null;
		expect(await call(bindings.actions.revoke, { session: ghost, form: { revoke_auth_binding: 'x' } })).toMatchObject({
			status: 400
		});
		// Accounts without username: only the session's own account is changed.
		const twins = [1, 2].map(() => ({ bindings: { bindable: ['1', {}], other: ['2', {}] }, username: '' }));
		const [a, b] = [await user({ ...twins[0], email: `${uid()}@x.org` }), await user(twins[1])];
		expect(await call(bindings.actions.revoke, { session: a.session, form: { revoke_auth_binding: 'other' } })).toEqual(
			{ message: 'Binding removed.' }
		);
		expect((await env.database.c.users.findOne({ email: a.email }))!.bindings).toEqual({ bindable: ['1', {}] });
		expect((await env.database.c.users.findOne({ email: b.email }))!.bindings).toEqual(twins[1].bindings);
	});

	it('deletes the account after confirmation', async () => {
		const u = await user();
		expect(await call(deletion.load, { session: u.session })).toEqual({ email: u.email });
		expect(
			await call(deletion.actions.default, { session: u.session, form: { delete_email: 'no@x.org' } })
		).toMatchObject({ status: 400 });
		expect(await call(deletion.actions.default, { session: u.session, form: { delete_email: u.email } })).toMatchObject(
			{ status: 303, location: '/' }
		);
		expect(await env.database.c.users.findOne({ username: u.username })).toBeNull();
		const ghost = env.sessions.create();
		Object.assign(ghost.doc, { loggedin: true });
		expect(await call(deletion.load, { session: ghost })).toEqual({ email: '' });
		expect(await call(deletion.actions.default, { session: ghost, form: { delete_email: '' } })).toMatchObject({
			status: 400
		});
		const [a, b] = [await user({ username: '' }), await user({ username: '' })];
		expect(await call(deletion.actions.default, { session: a.session, form: { delete_email: a.email } })).toMatchObject(
			{ status: 303 }
		);
		expect(await env.database.c.users.findOne({ email: a.email })).toBeNull();
		expect(await env.database.c.users.findOne({ email: b.email })).not.toBeNull();
		env.configure({ allow_deletion: false });
		expect(await call(deletion.load, { session: (await user()).session })).toMatchObject({ status: 403 });
		env.configure();
	});
});

describe('/auth', () => {
	it('starts a flow with POST', async () => {
		method('flow');
		const session = env.sessions.create();
		expect(
			await call(start.POST, { session, params: { authid: 'flow' }, form: { redirect: '/course/a' } })
		).toMatchObject({ status: 303, location: 'https://idp.example/flow' });
		expect(session.doc.auth_storage.flow).toEqual({ redir_url: '/course/a' });
		const form = new FormData();
		form.set('redirect', new File(['x'], 'x'));
		await call(start.POST, { session, params: { authid: 'flow' }, form });
		expect(session.doc.auth_storage.flow).toEqual({ redir_url: '/' });
		expect(await call(start.POST, { params: { authid: 'nope' }, form: {} })).toMatchObject({ status: 404 });
	});

	it('handles GET callbacks and the SAML re-post', async () => {
		const email = `${uid()}@x.org`;
		method('cb', {}, { id: uid(), realname: 'R', email });
		expect(await call(callback.load, { params: { authid: 'cb' } })).toMatchObject({ status: 303, location: '/' });
		expect(await call(callback.load, { params: { authid: 'cb' }, form: {} })).toEqual({});
		expect(
			await call(callback.actions.default, { params: { authid: 'cb' }, form: { SAMLResponse: 'r', RelayState: 's' } })
		).toEqual({ repost: { SAMLResponse: 'r', RelayState: 's' } });
		expect(await call(callback.actions.default, { params: { authid: 'cb' }, form: {} })).toEqual({
			repost: { SAMLResponse: '', RelayState: '' }
		});
		expect(
			await call(callback.actions.default, { params: { authid: 'cb' }, form: { alreadyRedirected: 'yes' } })
		).toMatchObject({ status: 303, location: '/' });
	});

	it('serves the form of form-based methods', async () => {
		method('form', { form: true, name: 'Form', imlink: '/f.png' }, 'Unknown user');
		method('form2', { form: true }, { id: uid(), realname: 'R', email: `${uid()}@x.org` });
		expect(await call(formPage.load, { params: { authid: 'form' } })).toEqual({ name: 'Form', imlink: '/f.png' });
		expect(await call(formPage.load, { params: { authid: 'form2' } })).toEqual({ name: 'form2', imlink: null });
		expect(await call(formPage.load, { params: { authid: 'cb' } })).toMatchObject({ status: 404 });
		expect(await call(formPage.actions.default, { params: { authid: 'form' }, form: { login: 'a' } })).toMatchObject({
			status: 400,
			data: { message: 'Authentication failed: Unknown user' }
		});
		expect(await call(formPage.actions.default, { params: { authid: 'form2' }, form: { login: 'a' } })).toMatchObject({
			status: 303
		});
	});

	it('throttles failed form sign-ins per login', async () => {
		method('form3', { form: true }, 'Incorrect password');
		const post = () => call(formPage.actions.default, { params: { authid: 'form3' }, form: { login: ' Victim ' } });
		for (let i = 0; i < 20; i++) expect(await post()).toMatchObject({ status: 400 });
		expect(await post()).toMatchObject({ status: 429, data: { message: 'Too many requests, please retry later.' } });
	});

	it('publishes the SAML metadata', async () => {
		method('meta', { metadata: (url) => `<xml>${url.pathname}</xml>` });
		const response = (await call(metadata.GET, {
			params: { authid: 'meta' },
			url: 'http://x/auth/meta/metadata'
		})) as Response;
		expect(response.headers.get('content-type')).toBe('text/xml');
		expect(await response.text()).toBe('<xml>/auth/meta/metadata</xml>');
		expect(await call(metadata.GET, { params: { authid: 'cb' } })).toMatchObject({ status: 404 });
	});
});
