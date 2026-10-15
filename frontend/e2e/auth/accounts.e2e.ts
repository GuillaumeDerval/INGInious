/**
 * Integration tests of the local accounts (AUTH-04..08, AUTH-10..13, AUTH-18)
 * on the main e2e server (registration allowed, Mailpit SMTP, no auth plugin).
Tests are serial: some read the last mail of an address or count sessions.
 */
import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { test, expect, withDb } from '../fixtures.js';
import { createUser, lastMail, sessionCookie, uid } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** Fills and submits the sign-in form. */
async function signin(page: import('@playwright/test').Page, login: string, password = 'superadmin', path = '/signin') {
	await page.goto(path);
	await page.getByLabel('Username').fill(login);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** The stored user document. */
const userDoc = (username: string) => withDb((db) => db.collection('users').findOne({ username }));

test('AUTH-05 wrong credentials, unknown and pending accounts are refused with one message', async ({ page }) => {
	const pending = await createUser({ activate: 'x' });
	for (const [login, password] of [
		[pending.username, 'superadmin'],
		['e2e_student1', 'wrong'],
		['nobody_' + uid(), 'x']
	]) {
		await signin(page, login, password);
		await expect(page.getByText('Invalid login/password')).toBeVisible();
		await expect(page).toHaveURL(/\/signin/);
	}
});

test('AUTH-05 sign-in goes to the requested page and upgrades legacy SHA-512 hashes', async ({ page }) => {
	const sha = createHash('sha512').update('secret123').digest('hex');
	for (const password of [`sha512-${sha}`, sha]) {
		const user = await createUser({ password });
		await page.context().clearCookies();
		await page.goto('/preferences/bindings');
		await expect(page).toHaveURL(/\/signin\?redirect=%2Fpreferences%2Fbindings/);
		await page.getByLabel('Username').fill(`  ${user.username} `);
		await page.getByLabel('Password').fill('secret123');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page).toHaveURL(/\/preferences\/bindings$/);
		expect((await userDoc(user.username))!.password).toMatch(/^argon2id-\$argon2id\$/);
	}
	// Logged-in visitors of /signin go to the target directly; external redirects are ignored.
	const response = await page.request.get('/signin?redirect=//evil.example', { maxRedirects: 0 });
	expect(response.headers().location).toBe('/mycourses');
});

test('AUTH-04 the session id is rotated at login and the session dropped at logout', async ({ page, context }) => {
	await page.goto('/signin');
	await context.addCookies([{ name: 'inginious_session_id', value: 'forged.value', url: page.url() }]);
	const user = await createUser();
	await signin(page, user.username);
	await expect(page).toHaveURL(/\/mycourses/);
	const cookie = (await context.cookies()).find((c) => c.name === 'inginious_session_id')!;
	const session = await withDb((db) =>
		db.collection('sessions').findOne({ _id: new ObjectId(cookie.value.split('.')[0]) })
	);
	expect(session).toMatchObject({ loggedin: true, username: user.username, tos_signed: true });
	expect(session!.expiration.getTime()).toBeGreaterThan(Date.now());
	expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
});

test('AUTH-06 logging out is a POST that destroys the session', async ({ page, context, loginAs, baseURL }) => {
	await loginAs('e2e_student2');
	await page.goto('/logout');
	await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
	const before = (await context.cookies()).find((c) => c.name === 'inginious_session_id')!.value;
	await page.getByRole('button', { name: 'Log out' }).click();
	await expect(page).toHaveURL(/\/courselist/);
	// The old cookie is not valid anymore.
	await context.addCookies([{ name: 'inginious_session_id', value: before, url: baseURL! }]);
	await page.goto('/preferences/profile');
	await expect(page).toHaveURL(/\/signin/);
	// Anonymous GET /logout goes to the sign-in page.
	await page.goto('/logout');
	await expect(page).toHaveURL(/\/signin$/);
});

test('AUTH-18 the header shows sign-in/registration links or the user menu', async ({ page, loginAs }) => {
	await page.goto('/signin');
	await expect(page.getByRole('link', { name: 'Register' }).first()).toBeVisible();
	await expect(page.getByRole('link', { name: 'Lost password?' })).toBeVisible();
	await loginAs('e2e_student3');
	await page.goto('/preferences/profile');
	await page.getByRole('button', { name: 'User menu' }).click();
	await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
	await page.getByRole('menuitem', { name: 'Log out' }).click();
	await expect(page).toHaveURL(/\/courselist/);
});

test('AUTH-07 CORE-05 a visitor registers, activates the account by mail and signs in', async ({ page }) => {
	const name = `auth_r${uid()}`;
	const email = `${name}@X.Org`;
	await page.goto('/register');
	const form = page.locator('form[action="?/register"]');
	const fill = async (username: string, mail: string, p1 = 'secret1234', p2 = p1) => {
		await form.getByLabel(/Username/).fill(username);
		await form.getByLabel(/Complete name/).fill('Auth Reg');
		await form.getByLabel(/Email address/).fill(mail);
		await form.getByLabel(/^Password/).fill(p1);
		await form.getByLabel(/Confirm password/).fill(p2);
		await form.getByRole('button', { name: 'Sign up' }).click();
	};
	await fill('ab!', email);
	await expect(page.getByText('Invalid username format.')).toBeVisible();
	await fill(name, email, 'secret1234', 'other123');
	await expect(page.getByText("Passwords don't match !").last()).toBeVisible();
	await fill('e2e_student1', email);
	await expect(page.getByText('This username is not available. Please choose another one.')).toBeVisible();
	await fill(name, email);
	await expect(page.getByText('You are succesfully registered.')).toBeVisible();
	const user = (await userDoc(name))!;
	// No terms of service are defined in the e2e configuration: they are not recorded as accepted.
	expect(user).toMatchObject({ email: `${name}@x.org`, tos_accepted: false, realname: 'Auth Reg' });
	expect(user.activate).toMatch(/^[0-9a-f]{64}\.\d+$/);
	const mail = await lastMail(`${name}@x.org`);
	expect(mail.subject).toBe('Welcome on INGInious');
	const link = /http\S+register\?activate=\S+/.exec(mail.text)![0];
	expect(link).toContain(user.activate);
	await signin(page, name, 'secret1234');
	await expect(page.getByText('Invalid login/password')).toBeVisible();
	await page.goto(link);
	await page.getByRole('button', { name: 'Activate my account' }).click();
	await expect(page.getByText('User successfully activated.')).toBeVisible();
	await page.goto(link);
	await page.getByRole('button', { name: 'Activate my account' }).click();
	await expect(page.getByText('Invalid activation hash.')).toBeVisible();
	await signin(page, name, 'secret1234');
	await expect(page).toHaveURL(/\/mycourses/);
	// Logged-in users cannot register.
	expect((await page.request.get('/register')).status()).toBe(403);
});

test('AUTH-07 an e-mail address already in use is not revealed', async ({ page }) => {
	const existing = await createUser();
	await page.goto('/register');
	const form = page.locator('form[action="?/register"]');
	await form.getByLabel(/Username/).fill(`auth_n${uid()}`);
	await form.getByLabel(/Complete name/).fill('Someone');
	await form.getByLabel(/Email address/).fill(existing.email);
	await form.getByLabel(/^Password/).fill('secret1234');
	await form.getByLabel(/Confirm password/).fill('secret1234');
	await form.getByRole('button', { name: 'Sign up' }).click();
	await expect(page.getByText('You are succesfully registered.')).toBeVisible();
	expect((await lastMail(existing.email)).text).toContain('/register#lostpasswd');
});

test('AUTH-08 a user resets a lost password through the mailed link', async ({ page }) => {
	const user = await createUser({ activate: 'legacy-pending' });
	const unknown = `nobody_${uid()}@inginious.local`;
	await page.goto('/signin');
	await page.getByRole('link', { name: 'Lost password?' }).click();
	const form = page.locator('form[action="?/lostpasswd"]');
	for (const address of [unknown, user.email]) {
		await form.getByLabel('Email address :').fill(address);
		await form.getByRole('button', { name: 'Reset my password' }).click();
		await expect(page.getByText('An email has been sent to you to reset your password.').last()).toBeVisible();
	}
	const reset = (await userDoc(user.username))!.reset as string;
	const link = /http\S+register\?reset=\S+/.exec((await lastMail(user.email)).text)![0];
	expect(link).toContain(reset);
	await page.goto('/register?reset=bogus');
	await expect(page.getByText('Invalid reset hash.')).toBeVisible();
	await page.goto(link);
	await expect(page.getByText(`Set new password for ${user.realname} [${user.username}]`)).toBeVisible();
	await page.getByLabel(/^Password/).fill('12345');
	await page.getByLabel(/Confirm password/).fill('12345');
	await page.getByRole('button', { name: 'Set new password' }).click();
	await expect(page.getByText('Password too short.')).toBeVisible();
	await page.getByLabel(/^Password/).fill('newpass123');
	await page.getByLabel(/Confirm password/).fill('newpass123');
	await page.getByRole('button', { name: 'Set new password' }).click();
	await expect(page.getByText('Your password has been successfully changed.')).toBeVisible();
	const doc = (await userDoc(user.username))!;
	expect(doc.reset).toBeUndefined();
	expect(doc.activate).toBeUndefined();
	await signin(page, user.username, 'newpass123');
	await expect(page).toHaveURL(/\/mycourses/);
});

test('AUTH-08 reset links are never built from a foreign Host header', async ({ request, baseURL }) => {
	const user = await createUser();
	const res = await request.post(`${baseURL}/register?/lostpasswd`, {
		headers: { host: 'evil.example', origin: 'http://evil.example' },
		form: { recovery_email: user.email }
	});
	expect(await res.text()).toContain('Something went wrong while sending you reset email.');
	expect((await userDoc(user.username))!.reset).toBeUndefined();
});

test('AUTH-05 repeated failures lock the account from every client for a while', async ({ page, request, baseURL }) => {
	const user = await createUser();
	const form = { login: user.username, password: 'wrong' };
	for (let i = 0; i < 20; i++) await request.post(`${baseURL}/signin`, { headers: { origin: baseURL! }, form });
	await signin(page, user.username);
	await expect(page.getByText('Invalid login/password')).toBeVisible();
});

test('AUTH-11 a user edits the profile and changes the password', async ({ page, context, baseURL }) => {
	const user = await createUser();
	await context.addCookies([await sessionCookie(user, baseURL!)]);
	await page.goto('/preferences');
	await expect(page).toHaveURL(/\/preferences\/profile$/);
	await expect(page.getByLabel('Username :')).toBeDisabled();
	await page.getByLabel('Old password :').fill('wrong');
	await page.getByLabel(/New password/).fill('newpass123');
	await page.getByLabel(/Confirm new password/).fill('newpass123');
	await page.getByRole('button', { name: 'Save my profile' }).click();
	await expect(page.getByText('Incorrect old password.')).toBeVisible();
	await page.getByLabel('Old password :').fill('superadmin');
	await page.getByLabel(/New password/).fill('newpass123');
	await page.getByLabel(/Confirm new password/).fill('newpass1234');
	await page.getByRole('button', { name: 'Save my profile' }).click();
	await expect(page.getByText("Passwords don't match !").last()).toBeVisible();
	await page.getByLabel('Old password :').fill('superadmin');
	await page.getByLabel(/New password/).fill('newpass123');
	await page.getByLabel(/Confirm new password/).fill('newpass123');
	await page.getByLabel('Complete name :').fill('New Name');
	await page.getByLabel('Timezone :').selectOption('Europe/Brussels');
	await page.getByLabel('Code indentation :').selectOption('tabs');
	await page.getByRole('button', { name: 'Save my profile' }).click();
	await expect(page.getByText('Profile updated.')).toBeVisible();
	const doc = (await userDoc(user.username))!;
	expect(doc).toMatchObject({ realname: 'New Name', timezone: 'Europe/Brussels', code_indentation: 'tabs' });
	expect(doc.password).not.toBe(user.password);
});

test('AUTH-10 the profile language changes the interface language', async ({ page, context, baseURL }) => {
	const user = await createUser();
	await context.addCookies([await sessionCookie(user, baseURL!)]);
	await page.goto('/preferences/profile');
	await page.getByLabel('Language :').selectOption('fr');
	await page.getByRole('button', { name: 'Save my profile' }).click();
	await expect(page.getByText('Profile updated.')).toBeVisible();
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
	await expect(page.getByRole('button', { name: 'Sauvegarder mon profil' })).toBeVisible();
	expect((await userDoc(user.username))!.language).toBe('fr');
});

test('AUTH-11 an external account chooses its username (and a password) first', async ({ page, context, baseURL }) => {
	const user = await createUser({ username: '', password: undefined, bindings: { github: ['42', {}] } });
	await context.addCookies([await sessionCookie(user, baseURL!)]);
	await page.goto('/signin');
	await expect(page).toHaveURL(/\/preferences\/profile$/);
	await expect(page.getByText('Please set a new username')).toBeVisible();
	await page.getByLabel('Username :').fill('ab');
	await page.getByRole('button', { name: 'Save my profile' }).click();
	await expect(page.getByText('Invalid username format.')).toBeVisible();
	await page.getByLabel('Username :').fill('e2e_student1');
	await page.getByRole('button', { name: 'Save my profile' }).click();
	await expect(page.getByText('Username already taken')).toBeVisible();
	const name = `auth_x${uid()}`;
	await page.getByLabel('Username :').fill(name);
	await page.getByLabel(/New password/).fill('secret1234');
	await page.getByLabel(/Confirm new password/).fill('secret1234');
	await page.getByRole('button', { name: 'Save my profile' }).click();
	await expect(page.getByText('Profile updated.')).toBeVisible();
	await expect(page.getByLabel('Username :')).toBeDisabled();
	expect((await userDoc(name))!.password).toMatch(/^argon2id-/);
});

test('AUTH-12 bindings are listed and revoked (never the last one of a passwordless account)', async ({
	page,
	context,
	baseURL
}) => {
	const user = await createUser({ bindings: { github: ['999', {}], saml: ['u1', { studentid: '123' }] } });
	await context.addCookies([await sessionCookie(user, baseURL!)]);
	await page.goto('/preferences/bindings');
	await expect(page.getByText('999')).toBeVisible();
	await expect(page.getByText('saml.studentid')).toBeVisible();
	await page.getByRole('button', { name: 'Revoke access' }).first().click();
	await expect(page.getByText('Binding removed.')).toBeVisible();
	await expect(page.getByText('999')).toHaveCount(0);
	expect((await userDoc(user.username))!.bindings).toEqual({ saml: ['u1', { studentid: '123' }] });

	const external = await createUser({ password: undefined, bindings: { github: ['1000', {}] } });
	await context.clearCookies();
	await context.addCookies([await sessionCookie(external, baseURL!)]);
	await page.goto('/preferences/bindings');
	await page.getByRole('button', { name: 'Revoke access' }).click();
	await expect(page.getByText('You must set a password before removing all bindings.')).toBeVisible();
});

test('AUTH-13 a user deletes the account and only their own data', async ({ page, context, baseURL }) => {
	const user = await createUser();
	const other = 'e2e_student1';
	const courseid = `authdel_${uid()}`;
	const [own, shared] = [new ObjectId(), new ObjectId()];
	await withDb(async (db) => {
		const base = { courseid, taskid: 't', status: 'done', submitted_on: new Date(), grade: 0, input: new ObjectId() };
		await db.collection('submissions').insertMany([
			{ ...base, _id: own, username: [user.username] },
			{ ...base, _id: shared, username: [user.username, other] }
		]);
		await db.collection('user_tasks').insertOne({
			courseid,
			taskid: 't',
			username: user.username,
			grade: 0,
			submissionid: null,
			succeeded: false,
			tried: 1,
			random: [],
			tokens: { amount: 0, date: new Date() },
			state: ''
		});
		await db.collection('courses').insertOne({ _id: courseid as never, students: [user.username, other] });
		await db
			.collection('groups')
			.insertOne({ courseid, description: 'g', size: 2, students: [user.username], audiences: [] });
	});
	await context.addCookies([await sessionCookie(user, baseURL!)]);
	await page.goto('/preferences/delete');
	await page.getByRole('button', { name: 'Delete my account' }).click();
	const dialog = page.getByRole('alertdialog');
	await dialog.getByRole('textbox').fill(user.email);
	await dialog.getByRole('button', { name: 'Delete my account' }).click();
	await expect(page).toHaveURL(/\/courselist|\/$/);
	await withDb(async (db) => {
		expect(await db.collection('users').findOne({ username: user.username })).toBeNull();
		expect(await db.collection('submissions').findOne({ _id: own })).toBeNull();
		expect((await db.collection('submissions').findOne({ _id: shared }))!.username).toEqual([other]);
		expect(await db.collection('user_tasks').countDocuments({ username: user.username })).toBe(0);
		expect((await db.collection('courses').findOne({ _id: courseid as never }))!.students).toEqual([other]);
		expect((await db.collection('groups').findOne({ courseid }))!.students).toEqual([]);
		expect(await db.collection('sessions').countDocuments({ username: user.username })).toBe(0);
	});
});

test('AUTH-13 a wrong confirmation e-mail deletes nothing', async ({ page, context, baseURL }) => {
	const user = await createUser();
	await context.addCookies([await sessionCookie(user, baseURL!)]);
	const response = await page.request.post('/preferences/delete', {
		form: { delete_email: 'wrong@x.org' },
		headers: { origin: baseURL! }
	});
	expect(response.status()).toBe(400);
	expect(await userDoc(user.username)).not.toBeNull();
});
