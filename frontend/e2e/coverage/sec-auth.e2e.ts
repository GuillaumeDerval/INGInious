/**
 * Integration tests of the account protections (AUTH-04/05/07/08/11, SITE-22):
 * password length policy, generic answer for taken usernames, session lifetime,
 * "Log out other sessions", session id renewal on password change, throttled
 * old-password checks, per-address limit of lost-password mails, preference
 * actions of anonymous visitors and other users, and WebDAV over plain http.
 * They run on their own server behind a "reverse proxy" (`X-Forwarded-For` trusted),
 * so that each test uses its own client addresses for the rate limits.
 */
import { createHmac } from 'node:crypto';
import { ObjectId } from 'mongodb';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { test, expect, installCourse, withDb } from '../fixtures.js';
import { E2E } from '../setup-data.js';
import { createUser, mailCount, sessionCookie, uid, useApp } from '../auth/helpers.js';

useApp(18, { 'reverse-proxy-config': { enable: true } });

/** A client address of its own (rate limits are counted per address). */
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;

/** Posts a form action the way `use:enhance` does; returns its status and `message`. */
async function action(request: APIRequestContext, url: string, form: Record<string, string>, origin: string) {
	const response = await request.post(url, {
		form,
		headers: { origin, accept: 'application/json', 'x-sveltekit-action': 'true', 'x-forwarded-for': ip() }
	});
	const body = await response.json();
	const data = body.data ? (JSON.parse(body.data) as unknown[]) : [];
	return { type: body.type as string, status: body.status as number, message: data[1] as string | undefined };
}

/** Signs a session id like the server (cookie value). */
const signed = (id: ObjectId) =>
	`${id.toHexString()}.${createHmac('sha256', E2E.secretKey).update(id.toHexString()).digest('base64url')}`;

/** Logs a new user in `context`; returns the user and its session cookie. */
async function login(context: BrowserContext, baseURL: string, fields: Record<string, unknown> = {}) {
	const user = await createUser(fields);
	const cookie = await sessionCookie(user, baseURL);
	await context.addCookies([cookie]);
	return { user, cookie };
}

/** True when a session cookie still opens the pages of a logged-in user. */
async function loggedIn(request: APIRequestContext, value: string) {
	const response = await request.get('/mycourses', {
		maxRedirects: 0,
		headers: { cookie: `inginious_session_id=${value}` }
	});
	return response.status() === 200;
}

test('AUTH-07 new passwords need 10 characters and a taken username gets a generic answer', async ({ page }) => {
	await page.goto('/register');
	const form = page.locator('form[action="?/register"]');
	await expect(form.getByText('Password (min. 10 characters) :')).toBeVisible();
	const fill = async (username: string, password: string) => {
		await form.getByLabel(/Username/).fill(username);
		await form.getByLabel(/Complete name/).fill('Sec');
		await form.getByLabel(/Email address/).fill(`sec_${uid()}@inginious.local`);
		await form.getByLabel(/^Password/).fill(password);
		await form.getByLabel(/Confirm password/).fill(password);
		await form.getByRole('button', { name: 'Sign up' }).click();
	};
	await fill(`sec_${uid()}`, '123456789');
	await expect(page.getByText('Password too short.')).toBeVisible();
	await fill('e2e_student1', '1234567890');
	await expect(page.getByText('This username is not available. Please choose another one.')).toBeVisible();
});

test('AUTH-05 an over-long password is refused at sign-in', async ({ request, baseURL }) => {
	const user = await createUser();
	const result = await action(
		request,
		'/signin',
		{ login: user.username, password: 'superadmin'.repeat(103) },
		baseURL!
	);
	expect(result).toMatchObject({ status: 400, message: 'Invalid login/password' });
	expect(await action(request, '/signin', { login: user.username, password: 'superadmin' }, baseURL!)).toMatchObject({
		type: 'redirect'
	});
});

test('AUTH-04 "Log out other sessions" ends the other sessions of the account only', async ({
	page,
	context,
	request,
	baseURL
}) => {
	const { user } = await login(context, baseURL!);
	const other = await sessionCookie(user, baseURL!);
	const stranger = await sessionCookie(await createUser(), baseURL!);
	await page.goto('/preferences/profile');
	await page.getByRole('link', { name: 'Security' }).click();
	await expect(page).toHaveURL(/\/preferences\/security$/);
	await page.getByRole('button', { name: 'Log out other sessions' }).click();
	await expect(page.getByText('Your other sessions have been logged out.')).toBeVisible();
	expect(await loggedIn(request, other.value)).toBe(false);
	expect(await loggedIn(request, stranger.value)).toBe(true);
	await page.goto('/mycourses');
	await expect(page).toHaveURL(/\/mycourses$/);
});

test('AUTH-04 a session ends after its absolute lifetime (7 days), even when active', async ({ request }) => {
	const user = await createUser();
	const id = ObjectId.createFromTime(Math.floor(Date.now() / 1000) - 8 * 86400);
	await withDb((db) =>
		db.collection('sessions').insertOne({
			_id: id,
			permanent: true,
			is_lti: false,
			loggedin: true,
			auth_storage: {},
			expiration: new Date(Date.now() + 3600_000),
			email: user.email,
			username: user.username,
			realname: user.realname,
			tos_signed: true
		})
	);
	expect(await loggedIn(request, signed(id))).toBe(false);
	expect(await withDb((db) => db.collection('sessions').findOne({ _id: id }))).toBeNull();
});

test('AUTH-11 a password change renews the session id and ends the other sessions', async ({
	page,
	context,
	request,
	baseURL
}) => {
	const { user, cookie } = await login(context, baseURL!);
	const other = await sessionCookie(user, baseURL!);
	await page.goto('/preferences/profile');
	await expect(page.getByText('New password (min. 10 characters) :')).toBeVisible();
	await page.getByLabel('Old password :').fill('superadmin');
	await page.getByLabel(/New password/).fill('newpass1234');
	await page.getByLabel(/Confirm new password/).fill('newpass1234');
	await page.getByRole('button', { name: 'Save my profile' }).click();
	await expect(page.getByText('Profile updated.')).toBeVisible();
	const current = (await context.cookies()).find((c) => c.name === 'inginious_session_id')!.value;
	expect(current).not.toBe(cookie.value);
	expect(await loggedIn(request, cookie.value)).toBe(false);
	expect(await loggedIn(request, other.value)).toBe(false);
	await page.goto('/mycourses');
	await expect(page).toHaveURL(/\/mycourses$/);
});

test('AUTH-11 old-password checks are throttled per account, like sign-in', async ({ context, page, baseURL }) => {
	const { user } = await login(context, baseURL!);
	const change = (oldpasswd: string) =>
		action(
			page.request,
			'/preferences/profile',
			{
				realname: 'R',
				language: 'en',
				timezone: 'UTC',
				code_indentation: '4',
				oldpasswd,
				passwd: 'newpass1234',
				passwd2: 'newpass1234'
			},
			baseURL!
		);
	for (let i = 0; i < 20; i++) expect((await change('wrong')).message).toBe('Incorrect old password.');
	expect((await change('superadmin')).message).toBe('Too many requests, please retry later.');
	const doc = await withDb((db) => db.collection('users').findOne({ username: user.username }));
	expect(doc!.password).toBe(user.password);
});

test('AUTH-08 lost-password mails are limited per address, whatever the client', async ({ request, baseURL }) => {
	const user = await createUser();
	const ask = () => action(request, '/register?/lostpasswd', { recovery_email: user.email }, baseURL!);
	for (let i = 0; i < 3; i++)
		expect((await ask()).message).toBe('An email has been sent to you to reset your password.');
	expect((await ask()).message).toBe('Too many requests, please retry later.');
	await expect.poll(() => mailCount(user.email)).toBe(3);
});

test('AUTH-11 AUTH-12 AUTH-13 preference actions refuse anonymous visitors and never touch other accounts', async ({
	request,
	page,
	context,
	baseURL
}) => {
	const victim = await createUser({ bindings: { github: ['7', {}] } });
	const victimSession = await sessionCookie(victim, baseURL!);
	const posts: [string, Record<string, string>][] = [
		['/preferences/profile', { realname: 'Hacked', language: 'en', timezone: 'UTC', code_indentation: '4' }],
		['/preferences/bindings?/revoke', { revoke_auth_binding: 'github' }],
		['/preferences/delete', { delete_email: victim.email }],
		['/preferences/security', {}]
	];
	for (const [url, form] of posts) {
		const result = await action(request, url, form, baseURL!);
		expect(result.type, url).toBe('redirect');
	}
	// Another user: their own account only.
	await login(context, baseURL!);
	for (const [url, form] of posts) await action(page.request, url, form, baseURL!);
	const doc = await withDb((db) => db.collection('users').findOne({ username: victim.username }));
	expect(doc).toMatchObject({ realname: victim.realname, bindings: { github: ['7', {}] } });
	expect(await loggedIn(request, victimSession.value)).toBe(true);
});

test('SITE-22 WebDAV refuses Basic credentials over plain http outside localhost', async ({ request }) => {
	const course = installCourse('task_showcase', `e2e_secdav_${uid()}`);
	// The public host as forwarded by the proxy (not a development host).
	const headers = { 'x-forwarded-host': 'dav.example', authorization: `Basic ${btoa('superadmin:wrong')}` };
	const plain = await request.get(`/dav/${course}/`, { headers });
	expect(plain.status()).toBe(403);
	expect(await plain.text()).toContain('WebDAV requires HTTPS');
	// Behind the proxy, an https request reaches the credential check.
	const https = await request.get(`/dav/${course}/`, { headers: { ...headers, 'x-forwarded-proto': 'https' } });
	expect(https.status()).toBe(401);
});
