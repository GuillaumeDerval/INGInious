/**
 * Tests of the bundled auth plugins (AUTH-15/16/17) with mocked providers:
 * `fetch` is stubbed for the OAuth endpoints, the LDAP client is faked and the
 * SAML response validation is stubbed (the request-id cache and the assertion
 * replay record are real, on a throw-away database).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { SAML, type CacheProvider } from '@node-saml/node-saml';
import { setServices, type Services } from '../app.js';
import { buildConfig, type PluginConfig } from '../config.js';
import { createTestDatabase, type TestDatabase } from '../testing/db.js';
import { PluginRegistry } from '../plugins/index.js';
import { authMethods, type AuthStorage } from './external.js';
import { getJson } from './oauth.js';
import * as github from '../plugins/bundled/inginious.frontend.plugins.auth.github_auth.js';
import * as google from '../plugins/bundled/inginious.frontend.plugins.auth.google_auth.js';
import * as facebook from '../plugins/bundled/inginious.frontend.plugins.auth.facebook_auth.js';
import * as linkedin from '../plugins/bundled/inginious.frontend.plugins.auth.linkedin_auth.js';
import * as ldap from '../plugins/bundled/inginious.frontend.plugins.auth.ldap_auth.js';
import * as saml from '../plugins/bundled/inginious.frontend.plugins.auth.saml2_auth.js';

/** Behaviour of the fake LDAP server. */
const ldapServer = {
	connect: true,
	entries: [] as Record<string, unknown>[],
	password: 'right',
	binds: [] as string[],
	tls: 0
};
vi.mock('ldapts', async (original) => ({
	...(await original<typeof import('ldapts')>()),
	Client: class {
		constructor(readonly options: { url: string }) {}
		async startTLS() {
			ldapServer.tls++;
		}
		async bind(dn: string, password: string) {
			ldapServer.binds.push(dn);
			if (!ldapServer.connect) throw new Error('down');
			if (dn.startsWith('uid=') && password !== ldapServer.password) throw new Error('invalid');
		}
		async search(_base: string, { filter }: { filter: string }) {
			if (!ldapServer.connect) throw new Error('down');
			ldapServer.binds.push(filter);
			return { searchEntries: ldapServer.entries };
		}
		async unbind() {
			throw new Error('ignored');
		}
	}
}));

const url = new URL('https://inginious.example/auth/callback/x');
const registry = new PluginRegistry();

/** Stubs fetch: `routes` maps URL prefixes to JSON bodies (or HTTP status numbers). */
function stubFetch(routes: Record<string, unknown>) {
	vi.stubGlobal('fetch', async (input: string | URL | Request) => {
		const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const key = Object.keys(routes).find((prefix) => target.startsWith(prefix));
		const body = key ? routes[key] : 404;
		return typeof body === 'number' ? new Response('no', { status: body }) : Response.json(body);
	});
}
const TOKEN = { access_token: 'tok', token_type: 'bearer', expires_in: 3600 };

/** Runs a full OAuth round trip with the stubbed provider. */
async function oauth(id: string, routes: Record<string, unknown>) {
	const method = authMethods.get(id)!;
	const storage: AuthStorage = {};
	const link = new URL(await method.authLink(storage, url));
	stubFetch(routes);
	const callback = new URL(`https://inginious.example/auth/callback/${id}?code=c&state=${storage.oauth_state}`);
	return { link, result: await method.callback(storage, { url: callback, form: null }), storage, method };
}

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
	setServices({
		config: buildConfig({
			backend: 'tcp://x:1',
			session_parameters: { secret_key: 'k' },
			base_url: 'https://inginious.example'
		}),
		db: t.database
	} as Services);
	const plugin = (module: { init: (r: PluginRegistry, o: PluginConfig) => void }, options: Record<string, unknown>) =>
		module.init(registry, { plugin_module: 'x', ...options });
	plugin(github, { id: 'gh', client_id: 'cid', client_secret: 's' });
	plugin(google, { id: 'go', client_id: 'cid', client_secret: 's', domain: 'uni.be' });
	plugin(google, { id: 'go2', name: 'Gmail', client_id: 'cid', client_secret: 's' });
	plugin(facebook, { id: 'fb', client_id: 'cid', client_secret: 's' });
	plugin(linkedin, { id: 'li', client_id: 'cid', client_secret: 's', imlink: '/li.png' });
	plugin(ldap, {
		id: 'ldap',
		host: 'ldap.test',
		port: 389,
		base_dn: 'o=test',
		request: '(uid={})',
		bind_dn: 'uid={},o=test'
	});
	plugin(ldap, {
		id: 'ldaps',
		name: 'Campus',
		host: 'ldap.test',
		encryption: 'ssl',
		base_dn: 'o=test',
		cn: 'displayName',
		mail: 'email'
	});
	plugin(ldap, { id: 'ldaptls', host: 'ldap.test', encryption: 'tls', base_dn: 'o=test' });
	const samlOptions = {
		sp: { entityId: 'sp-id', x509cert: 'MIIBsp' },
		idp: {
			singleSignOnService: { url: 'https://idp.example/sso' },
			x509cert: 'MIIBidp',
			additionalX509certs: ['MIIBother']
		},
		attributes: { uid: 'urn:uid', cn: 'urn:cn', email: 'urn:mail' },
		additional: { studentid: 'urn:sid', missing: 'urn:none' }
	};
	plugin(saml, { id: 'saml', ...samlOptions });
	plugin(saml, { id: 'saml3' });
	plugin(saml, {
		id: 'saml2',
		name: 'SSO',
		...samlOptions,
		attributes: undefined,
		security: { wantAssertionsSigned: false, wantMessagesSigned: true }
	});
});
afterAll(() => t.drop());
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('OAuth providers', () => {
	it('GitHub: authorize URL, primary verified e-mail', async () => {
		const routes = {
			'https://github.com/login/oauth/access_token': TOKEN,
			'https://api.github.com/user/emails': [
				{ email: 'old@x.org', primary: false, verified: true },
				{ email: 'me@x.org', primary: true, verified: true }
			],
			'https://api.github.com/user': { id: 7, name: null, login: 'octo' }
		};
		const { link, result, method } = await oauth('gh', routes);
		expect(method.name).toBe('Github');
		expect(link.origin + link.pathname).toBe('https://github.com/login/oauth/authorize');
		expect(link.searchParams.get('redirect_uri')).toBe('https://inginious.example/auth/callback/gh');
		expect(link.searchParams.get('scope')).toBe('user:email');
		expect(result).toEqual({ id: '7', realname: 'octo', email: 'me@x.org' });
		const unverified = await oauth('gh', {
			...routes,
			'https://api.github.com/user/emails': [{ email: 'me@x.org', primary: true, verified: false }]
		});
		expect(unverified.result).toBeNull();
	});

	it('Google: hd hint enforced, unverified addresses refused', async () => {
		const info = { sub: 's1', name: 'G', email: 'g@uni.be', email_verified: true, hd: 'uni.be' };
		const routes = (body: object) => ({
			'https://oauth2.googleapis.com/token': TOKEN,
			'https://openidconnect.googleapis.com/v1/userinfo': body
		});
		const ok = await oauth('go', routes(info));
		expect(ok.link.searchParams.get('hd')).toBe('uni.be');
		expect(ok.link.searchParams.get('code_challenge')).toBeTruthy();
		expect(ok.result).toEqual({ id: 's1', realname: 'G', email: 'g@uni.be' });
		expect((await oauth('go', routes({ ...info, hd: 'other.be' }))).result).toBeNull();
		expect((await oauth('go2', routes({ ...info, email_verified: false }))).result).toBeNull();
		const other = await oauth('go2', routes({ ...info, hd: undefined }));
		expect(other.link.searchParams.has('hd')).toBe(false);
		expect(other.result).toMatchObject({ id: 's1' });
		expect(other.method.name).toBe('Gmail');
	});

	it('Facebook and LinkedIn read their profile endpoints and report unverified addresses', async () => {
		const fb = await oauth('fb', {
			'https://graph.facebook.com/v': TOKEN,
			'https://graph.facebook.com/me': { id: 'f1', name: 'F', email: 'f@x.org' }
		});
		// The Graph API never reports whether the address is verified.
		expect(fb.result).toEqual({ id: 'f1', realname: 'F', email: 'f@x.org', emailVerified: false });
		expect(fb.link.searchParams.get('scope')).toBe('public_profile email');
		const linkedin = (info: object) =>
			oauth('li', {
				'https://www.linkedin.com/oauth/v2/accessToken': TOKEN,
				'https://api.linkedin.com/v2/userinfo': { sub: 'l1', name: 'L', email: 'l@x.org', ...info }
			});
		const li = await linkedin({ email_verified: true });
		expect(li.result).toEqual({ id: 'l1', realname: 'L', email: 'l@x.org', emailVerified: true });
		expect(li.method.imlink).toBe('/li.png');
		expect((await linkedin({ email_verified: false })).result).toMatchObject({ emailVerified: false });
		expect((await linkedin({})).result).toMatchObject({ emailVerified: false });
	});

	it('rejects callbacks without code or with a forged state, and HTTP errors', async () => {
		const method = authMethods.get('gh')!;
		const storage: AuthStorage = {};
		await method.authLink(storage, url);
		const callback = (query: string) => method.callback(storage, { url: new URL(`https://x/cb?${query}`), form: null });
		expect(await callback(`state=${storage.oauth_state}`)).toBeNull();
		expect(await callback('code=c&state=forged')).toBeNull();
		expect(await method.callback({}, { url: new URL('https://x/cb?code=c&state=s'), form: null })).toBeNull();
		stubFetch({ 'https://api': 500 });
		await expect(getJson('https://api/x', 't')).rejects.toThrow('HTTP 500');
	});
});

describe('LDAP', () => {
	const login = (id: string, fields: Record<string, string>) => {
		const form = new FormData();
		for (const [k, v] of Object.entries(fields)) form.set(k, v);
		return authMethods.get(id)!.callback({}, { url, form });
	};

	it('is a form-based method', async () => {
		expect(authMethods.get('ldaps')).toMatchObject({ name: 'Campus', form: true });
		expect(await authMethods.get('ldap')!.authLink({}, url)).toBe('/auth/page/ldap');
	});

	it('signs in with escaped login and reports every error', async () => {
		Object.assign(ldapServer, {
			connect: true,
			password: 'right',
			binds: [],
			entries: [{ dn: 'uid=alice,o=test', cn: ['Alice A'], mail: 'alice@x.org' }]
		});
		expect(await login('ldap', { login: '  Alice ', password: 'right' })).toEqual({
			id: 'alice',
			realname: 'Alice A',
			email: 'alice@x.org'
		});
		expect(ldapServer.binds).toContain('(uid=alice)');
		await login('ldap', { login: 'a,b*)(', password: 'right' });
		expect(ldapServer.binds).toContain('uid=a\\,b*)(,o=test');
		expect(ldapServer.binds).toContain('(uid=a,b\\2a\\29\\28)');
		expect(await login('ldap', { login: 'alice', password: '  ' })).toBe('Empty password');
		expect(await login('ldap', { login: 'alice' })).toBe('Empty password');
		expect(await login('ldap', { login: 'alice', password: 'wrong' })).toBe('Cannot contact host');
		// Wrong password and unknown login: the same answer.
		expect(await login('ldaps', { login: 'alice', password: 'wrong' })).toBe('Invalid login/password');
		ldapServer.entries = [{ dn: 'uid=alice,o=test', displayName: 'A' }];
		expect(await login('ldaps', { login: 'alice', password: 'right' })).toBe(
			"Can't get field email from your LDAP server"
		);
		ldapServer.entries = [{ dn: 'uid=alice,o=test', email: 'a@x.org' }];
		expect(await login('ldaps', { login: 'alice', password: 'right' })).toBe(
			"Can't get field displayName from your LDAP server"
		);
		ldapServer.entries = [];
		expect(await login('ldaps', { login: 'bob', password: 'right' })).toBe('Invalid login/password');
		ldapServer.connect = false;
		expect(await login('ldaptls', { login: 'bob', password: 'right' })).toBe('Cannot contact host');
		expect(ldapServer.tls).toBe(1);
		expect(ldap.escapeDn('#a b ')).toBe('\\#a b\\ ');
		expect(await authMethods.get('ldap')!.callback({}, { url, form: null })).toBe('Empty password');
	});
});

/** A posted SAML response with a RelayState. */
const relayForm = (relay: string) => {
	const f = new FormData();
	f.set('SAMLResponse', 'xml');
	f.set('RelayState', relay);
	return f;
};

describe('SAML', () => {
	it('redirects to the IdP with an opaque RelayState and publishes metadata', async () => {
		const storage: AuthStorage = {};
		const link = new URL(await authMethods.get('saml')!.authLink(storage, url));
		expect(link.origin + link.pathname).toBe('https://idp.example/sso');
		expect(link.searchParams.get('RelayState')).toBe(storage.relay);
		expect(authMethods.get('saml')!.metadata!(url)).toContain('https://inginious.example/auth/callback/saml');
		expect(authMethods.get('saml2')!.name).toBe('SSO');
		// Missing sections get defaults.
		expect(authMethods.get('saml3')!.metadata!(url)).toContain('/auth/callback/saml3');
	});

	it('accepts a response only for the request of the session, and each assertion once', async () => {
		const method = authMethods.get('saml')!;
		const storage: AuthStorage = {};
		const link = new URL(await method.authLink(storage, url));
		expect(link.searchParams.get('SAMLRequest')).toBeTruthy();
		const request = storage.request as { key: string; value: string };
		expect(request.key).toMatch(/^_/);
		const looked: (string | null)[] = [];
		const assertion = { Assertion: { $: { ID: `_a${Date.now()}` } } };
		vi.spyOn(SAML.prototype, 'validatePostResponseAsync').mockImplementation(async function (this: SAML) {
			// What node-saml does with ValidateInResponseTo.always: look the InResponseTo up, then forget it.
			const cache = (this as unknown as { cacheProvider: CacheProvider }).cacheProvider;
			looked.push(await cache.getAsync(request.key), await cache.getAsync('_another_request'));
			await cache.removeAsync(request.key);
			return {
				profile: { issuer: 'idp', 'urn:uid': 'u1', getAssertion: () => assertion } as never,
				loggedOut: false
			};
		});
		const form = new FormData();
		form.set('SAMLResponse', 'xml');
		form.set('RelayState', storage.relay as string);
		expect(await method.callback(storage, { url, form })).toMatchObject({ id: 'u1' });
		expect(looked).toEqual([request.value, null]);
		expect(storage.request).toBeUndefined();
		// The same assertion again (replay), or an assertion without id: refused.
		expect(await method.callback({ relay: 'r' }, { url, form: relayForm('r') })).toBeNull();
		assertion.Assertion.$.ID = '';
		expect(await method.callback({ relay: 'r' }, { url, form: relayForm('r') })).toBeNull();
		expect(await t.database.db.collection('saml_assertions').countDocuments()).toBe(1);
	});

	it('maps the assertion attributes and checks the RelayState', async () => {
		const method = authMethods.get('saml')!;
		const form = (relay: string) => {
			const f = new FormData();
			f.set('SAMLResponse', 'xml');
			f.set('RelayState', relay);
			return f;
		};
		const validate = vi.spyOn(SAML.prototype, 'validatePostResponseAsync').mockResolvedValue({
			profile: {
				getAssertion: () => ({ Assertion: { $: { ID: `_m${Date.now()}` } } }),
				issuer: 'idp',
				'urn:uid': ['u1'],
				'urn:cn': 'Name',
				attributes: { 'urn:mail': 'm@x.org', 'urn:sid': ['42'] }
			} as never,
			loggedOut: false
		});
		expect(await method.callback({ relay: 'r' }, { url, form: form('r') })).toEqual({
			id: 'u1',
			realname: 'Name',
			email: 'm@x.org',
			additional: { studentid: '42', missing: '' }
		});
		expect(await method.callback({ relay: 'r' }, { url, form: form('other') })).toBeNull();
		expect(await method.callback({}, { url, form: form('r') })).toBeNull();
		expect(await method.callback({ relay: 'r' }, { url, form: null })).toBeNull();
		expect(await authMethods.get('saml2')!.callback({ relay: 'r' }, { url, form: form('r') })).toBeNull();
		// An assertion without id cannot be recorded: refused.
		validate.mockResolvedValue({ profile: { issuer: 'idp' } as never, loggedOut: false });
		expect(await method.callback({ relay: 'r' }, { url, form: form('r') })).toBeNull();
		validate.mockResolvedValue({ profile: null, loggedOut: false });
		expect(await method.callback({ relay: 'r' }, { url, form: form('r') })).toBeNull();
	});
});
