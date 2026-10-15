/**
 * Integration tests needing a configured instance (AUTH-01, 02, 09, 12, 14-17):
 * welcome page, static pages, terms of service and the bundled auth plugins.
 * External providers cannot be reached: the tests stop at the redirection to
 * the provider and check the error paths.
 */
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { ObjectId } from 'mongodb';
import { test, expect, withDb } from '../fixtures.js';
import { E2E_ID } from '../setup-data.js';
import { createUser, sessionCookie, uid, useApp } from './helpers.js';
import { idpCert, samlResponse } from './saml-idp.js';

/** Copy of the static pages fixture (modified by a test). */
const STATIC = `e2e/.generated/auth-static-${E2E_ID}`;
mkdirSync(STATIC, { recursive: true });
cpSync('e2e/fixtures/auth-static', STATIC, { recursive: true });

useApp(1, {
	static_directory: STATIC,
	welcome_page: 'auth_welcome',
	terms_page: 'auth_terms',
	privacy_page: 'auth_privacy',
	plugins: [
		{
			plugin_module: 'inginious.frontend.plugins.auth.github_auth',
			id: 'github',
			client_id: 'dummyid',
			client_secret: 's'
		},
		{
			plugin_module: 'inginious.frontend.plugins.auth.google_auth',
			id: 'google',
			client_id: 'gid',
			client_secret: 's',
			domain: 'uclouvain.be'
		},
		{
			plugin_module: 'inginious.frontend.plugins.auth.ldap_auth',
			id: 'ldap',
			name: 'Campus LDAP',
			host: '127.0.0.1',
			port: 1,
			base_dn: 'o=test'
		},
		{
			plugin_module: 'inginious.frontend.plugins.auth.saml2_auth',
			id: 'saml',
			name: 'University SSO',
			sp: { entityId: 'inginious-e2e' },
			idp: { singleSignOnService: { url: 'https://idp.example/sso' }, x509cert: idpCert },
			attributes: { uid: 'uid', cn: 'cn', email: 'mail' },
			additional: { studentid: 'studentid' }
		}
	]
});

/** Session of a user who accepted the terms (the instance requires them). */
async function login(
	context: import('@playwright/test').BrowserContext,
	baseURL: string,
	fields: Record<string, unknown> = {}
) {
	const user = await createUser(fields);
	await context.addCookies([await sessionCookie(user, baseURL)]);
	return user;
}

test('AUTH-01 the home page shows the welcome page in the visitor language', async ({ page, browser, baseURL }) => {
	await page.goto('/');
	await expect(page).toHaveTitle(/Welcome AUTH/);
	await expect(page.locator('strong', { hasText: 'world' })).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: 'Section' })).toBeVisible();
	const french = await browser.newContext({
		locale: 'fr-FR',
		baseURL,
		extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
	});
	const fr = await french.newPage();
	await fr.goto('/');
	await expect(fr.getByText('Bonjour')).toBeVisible();
	await french.close();
});

test('AUTH-02 static pages: languages, Markdown, missing pages, traversal and live edits', async ({
	page,
	browser,
	baseURL
}) => {
	await page.goto('/pages/auth_terms');
	await expect(page.getByText('These are the terms.')).toBeVisible();
	await page.goto('/pages/auth_md');
	await expect(page.getByRole('heading', { name: 'Markdown title' })).toBeVisible();
	for (const path of ['/pages/missing', '/pages/auth_fronly', '/pages/..%2Fconfiguration']) {
		expect((await page.request.get(path)).status()).toBe(404);
	}
	const french = await browser.newContext({
		locale: 'fr-FR',
		baseURL,
		extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
	});
	const fr = await french.newPage();
	await fr.goto('/pages/auth_fronly');
	await expect(fr.getByText('Contenu français.')).toBeVisible();
	await french.close();
	writeFileSync(`${STATIC}/auth_terms.yaml`, 'title: Terms\ncontent: Updated terms.\n');
	await page.goto('/pages/auth_terms');
	await expect(page.getByText('Updated terms.')).toBeVisible();
	// Footer link to the privacy page.
	await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/pages/auth_privacy');
});

test('AUTH-09 users must accept the terms of service, on GET and POST', async ({ page, context, baseURL }) => {
	const user = await login(context, baseURL!, { tos_accepted: false });
	const response = await page.request.get('/mycourses', { maxRedirects: 0 });
	expect(response.headers().location).toBe('/preferences/profile');
	await page.goto('/preferences/profile');
	await expect(page.getByText('Please accept the Terms of Service and Data Privacy')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', '/pages/auth_terms');
	await page.getByRole('button', { name: 'Save my profile' }).click();
	await expect(page.getByText('Profile updated.')).toBeVisible();
	expect((await page.request.get('/mycourses', { maxRedirects: 0 })).status()).toBe(302);
	await page.getByRole('checkbox').check();
	await page.getByRole('button', { name: 'Save my profile' }).click();
	await expect(page.getByText('Profile updated.').last()).toBeVisible();
	expect((await withDb((db) => db.collection('users').findOne({ username: user.username })))!.tos_accepted).toBe(true);
	expect((await page.request.get('/mycourses', { maxRedirects: 0 })).headers().location).not.toBe(
		'/preferences/profile'
	);
	// Registration requires the checkbox.
	await context.clearCookies();
	await page.goto('/register');
	const form = page.locator('form[action="?/register"]');
	await form.getByLabel(/Username/).fill('auth_tos_user');
	await form.getByLabel(/Complete name/).fill('T');
	await form.getByLabel(/Email address/).fill('auth_tos_user@inginious.local');
	await form.getByLabel(/^Password/).fill('secret123');
	await form.getByLabel(/Confirm password/).fill('secret123');
	await form.getByRole('button', { name: 'Sign up' }).click();
	await expect(page.getByText('Please accept the Terms of Service and Data Privacy')).toBeVisible();
});

test('AUTH-15 OAuth sign-in redirects to the provider and rejects a forged callback', async ({ page }) => {
	await page.goto('/signin?redirect=/pages/auth_terms');
	await expect(page.getByRole('button', { name: 'Sign in with Github' })).toBeVisible();
	const github = await page.request.post('/auth/signin/github', {
		form: { redirect: '/pages/auth_terms' },
		maxRedirects: 0,
		headers: { origin: new URL(page.url()).origin }
	});
	const location = new URL(github.headers().location);
	expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
	expect(location.searchParams.get('client_id')).toBe('dummyid');
	expect(location.searchParams.get('redirect_uri')).toBe(`${new URL(page.url()).origin}/auth/callback/github`);
	expect(location.searchParams.get('scope')).toBe('user:email');
	const google = await page.request.post('/auth/signin/google', {
		form: {},
		maxRedirects: 0,
		headers: { origin: new URL(page.url()).origin }
	});
	expect(new URL(google.headers().location).searchParams.get('hd')).toBe('uclouvain.be');
	await page.goto(`/auth/callback/github?code=x&state=forged`);
	await expect(page).toHaveURL(/\/signin$/);
	await expect(page.getByText("Couldn't fetch the required information from the service.")).toBeVisible();
});

test('AUTH-14 unknown methods are 404, GET cannot start a flow, external return targets are ignored', async ({
	page,
	baseURL
}) => {
	expect((await page.request.get('/auth/signin/nope')).status()).toBe(405);
	expect((await page.request.post('/auth/signin/nope', { form: {}, headers: { origin: baseURL! } })).status()).toBe(
		404
	);
	expect((await page.request.get('/auth/callback/nope')).status()).toBe(404);
	const response = await page.request.post('/auth/signin/ldap', {
		form: { redirect: 'https://evil.example/x' },
		maxRedirects: 0,
		headers: { origin: baseURL! }
	});
	expect(response.headers().location).toBe('/auth/page/ldap');
	const cookie = (await page.context().cookies()).find((c) => c.name === 'inginious_session_id')!;
	const session = await withDb((db) =>
		db.collection('sessions').findOne({ _id: new ObjectId(cookie.value.split('.')[0]) })
	);
	expect(session!.auth_storage.ldap.redir_url).toBe('/');
});

test('AUTH-14 a new external identity creates an account without username', async ({ page, context, baseURL }) => {
	// The identity provider is simulated by binding through the LDAP form being unreachable:
	// account creation itself is covered by unit tests; here the incomplete account is gated.
	const user = await createUser({
		username: '',
		password: undefined,
		tos_accepted: false,
		bindings: { ldap: ['someone', {}] }
	});
	await context.addCookies([await sessionCookie(user, baseURL!)]);
	await page.goto('/signin');
	await expect(page).toHaveURL(/\/preferences\/profile$/);
	await expect(page.getByText('Please set a new username')).toBeVisible();
});

test('AUTH-16 the LDAP form reports errors', async ({ page }) => {
	await page.goto('/signin');
	await page.getByRole('button', { name: 'Sign in with Campus LDAP' }).click();
	await expect(page).toHaveURL(/\/auth\/page\/ldap$/);
	await page.getByLabel('Username').fill('alice');
	await page.getByLabel('Password').fill(' ');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByText('Authentication failed: Empty password')).toBeVisible();
	await page.getByLabel('Password').fill('secret');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByText('Authentication failed: Cannot contact host')).toBeVisible();
	expect((await page.request.get('/auth/page/github')).status()).toBe(404);
});

test('AUTH-17 SAML: redirection to the IdP with an opaque RelayState, metadata, invalid responses', async ({
	page,
	baseURL
}) => {
	const response = await page.request.post('/auth/signin/saml', {
		form: { redirect: '/pages/auth_terms' },
		maxRedirects: 0,
		headers: { origin: baseURL! }
	});
	const location = new URL(response.headers().location);
	expect(location.origin + location.pathname).toBe('https://idp.example/sso');
	expect(location.searchParams.get('RelayState')).toMatch(/^[0-9a-f]{32}$/);
	const metadata = await page.request.get('/auth/saml/metadata');
	expect(metadata.headers()['content-type']).toContain('text/xml');
	expect(await metadata.text()).toContain(`${baseURL}/auth/callback/saml`);
	expect((await page.request.get('/auth/github/metadata')).status()).toBe(404);
	// First POST (as from the IdP): the page re-posts the response with the session cookie.
	await page.goto('/pages/auth_terms');
	await page.evaluate(() => {
		const form = Object.assign(document.createElement('form'), { method: 'POST', action: '/auth/callback/saml' });
		for (const [name, value] of [
			['SAMLResponse', 'bogus'],
			['RelayState', 'bogus']
		])
			form.append(Object.assign(document.createElement('input'), { type: 'hidden', name, value }));
		document.body.append(form);
		form.submit();
	});
	await expect(page).toHaveURL(/\/signin$/);
	await expect(page.getByText("Couldn't fetch the required information from the service.")).toBeVisible();
});

test('AUTH-12 a configured method can be bound from the sign-in methods tab', async ({ page, context, baseURL }) => {
	await login(context, baseURL!);
	await page.goto('/preferences/bindings');
	await page.getByRole('combobox').selectOption('github');
	const [request] = await Promise.all([
		page.waitForRequest((r) => r.url().startsWith('https://github.com/')),
		page.getByRole('button', { name: 'Add new binding' }).click()
	]);
	expect(new URL(request.url()).searchParams.get('state')).toBeTruthy();
	const wrong = await page.request.post('/preferences/bindings?/add', {
		form: { auth_binding: 'nope' },
		headers: { origin: baseURL! }
	});
	expect(await wrong.text()).toContain('Incorrect authentication binding.');
});

/** Signs in through the test SAML IdP; returns once the browser posted the response. */
async function samlLogin(
	page: import('@playwright/test').Page,
	baseURL: string,
	attributes: Record<string, string>,
	redirect = '/preferences/bindings'
) {
	await page.goto('/pages/auth_terms');
	const start = await page.request.post('/auth/signin/saml', {
		form: { redirect },
		maxRedirects: 0,
		headers: { origin: baseURL }
	});
	const relay = new URL(start.headers().location).searchParams.get('RelayState')!;
	const response = samlResponse(`${baseURL}/auth/callback/saml`, 'inginious-e2e', attributes);
	// The IdP posts the response: the page re-posts it with the session cookie.
	await page.evaluate(
		([SAMLResponse, RelayState]) => {
			const form = Object.assign(document.createElement('form'), { method: 'POST', action: '/auth/callback/saml' });
			for (const [name, value] of Object.entries({ SAMLResponse, RelayState }))
				form.append(Object.assign(document.createElement('input'), { type: 'hidden', name, value }));
			document.body.append(form);
			form.submit();
		},
		[response, relay]
	);
}

test('AUTH-17 a signed SAML assertion creates, then signs in, the bound account', async ({
	page,
	context,
	baseURL
}) => {
	const id = `saml_${uid()}`;
	const attributes = { uid: id, cn: 'Saml User', mail: `${id}@inginious.local`, studentid: '42' };
	await samlLogin(page, baseURL!, attributes);
	await expect(page).toHaveURL(/\/preferences\/bindings$/);
	await expect(page.getByText('saml.studentid')).toBeVisible();
	const created = await withDb((db) => db.collection('users').findOne({ email: attributes.mail }));
	expect(created).toMatchObject({
		username: '',
		realname: 'Saml User',
		bindings: { saml: [id, { studentid: '42' }] },
		tos_accepted: false
	});
	// AUTH-14: the new account must choose a username before using the site.
	await page.goto('/signin');
	await expect(page).toHaveURL(/\/preferences\/profile$/);
	// A later sign-in with the same identity opens the same account.
	await context.clearCookies();
	await samlLogin(page, baseURL!, attributes, '/pages/auth_terms');
	await expect(page).toHaveURL(/\/pages\/auth_terms$/);
	expect(await withDb((db) => db.collection('users').countDocuments({ email: attributes.mail }))).toBe(1);
	await page.goto('/signin');
	await expect(page).toHaveURL(/\/preferences\/profile$/);
});

test('AUTH-14 an identity whose e-mail belongs to a local account is not bound automatically', async ({
	page,
	baseURL
}) => {
	const existing = await createUser();
	await samlLogin(page, baseURL!, { uid: `saml_${uid()}`, cn: 'X', mail: existing.email });
	await expect(page).toHaveURL(/\/signin$/);
	await expect(page.getByText('An account using this email already exists')).toBeVisible();
});

test('AUTH-12 a logged-in user binds and refreshes a SAML identity', async ({ page, context, baseURL }) => {
	const user = await login(context, baseURL!);
	const id = `saml_${uid()}`;
	await samlLogin(page, baseURL!, { uid: id, cn: 'X', mail: 'other@inginious.local', studentid: '1' });
	await expect(page).toHaveURL(/\/preferences\/bindings$/);
	await samlLogin(page, baseURL!, { uid: id, cn: 'X', mail: 'other@inginious.local', studentid: '2' });
	await expect(page).toHaveURL(/\/preferences\/bindings$/);
	await expect
		.poll(
			async () => (await withDb((db) => db.collection('users').findOne({ username: user.username })))!.bindings.saml
		)
		.toEqual([id, { studentid: '2' }]);
	// The identity cannot be bound to a second account.
	const other = await createUser();
	await context.clearCookies();
	await context.addCookies([await sessionCookie(other, baseURL!)]);
	await samlLogin(page, baseURL!, { uid: id, cn: 'X', mail: 'other@inginious.local' });
	await expect(page).toHaveURL(/\/preferences\/bindings$/);
	expect((await withDb((db) => db.collection('users').findOne({ username: other.username })))!.bindings).toEqual({});
});
