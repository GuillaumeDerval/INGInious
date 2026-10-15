/**
 * Integration tests of the user administration (SITE-01..05).
 */
import { test, expect, withDb } from '../fixtures.js';
import { E2E } from '../setup-data.js';

const user = (username: string, extra = {}) => ({
	username,
	realname: `Site ${username}`,
	email: `${username}@site.org`,
	password: E2E.passwordHash,
	language: 'en',
	bindings: {},
	...extra
});

test.beforeAll(() =>
	withDb(async (db) => {
		await db.collection('users').deleteMany({ username: /^siteadm_/ });
		await db
			.collection('users')
			.insertMany([
				user('siteadm_pending', { activate: 'hash' }),
				user('siteadm_bound', { bindings: { github: ['gh-77', {}], google: ['g@x', {}] } }),
				user('siteadm_victim', { realname: '<b>Victim</b>' })
			]);
	})
);

test('SITE-01 superadmins list and search users; others are refused', async ({ loginAs, page }) => {
	await loginAs('superadmin');
	await page.goto('/administrator/users');
	await expect(page.getByRole('heading', { name: 'Users Administration' })).toBeVisible();
	await page.getByRole('textbox', { name: 'Search' }).fill('siteadm_');
	await page.getByRole('button', { name: 'Search' }).click();
	await expect(page.getByText('<b>Victim</b>')).toBeVisible();
	await expect(page.locator('tbody tr')).toHaveCount(3);
	await page.goto('/administrator/users?page=999');
	await expect(page.getByText(/^\d+ \/ \d+$/)).toBeVisible();
	await page.context().clearCookies();
	await loginAs('e2e_student1');
	expect((await page.goto('/administrator/users'))!.status()).toBe(403);
});

test('SITE-02 a superadmin creates a validated account', async ({ loginAs, page }) => {
	await withDb((db) => db.collection('users').deleteMany({ username: 'siteadm_new' }));
	await loginAs('superadmin');
	await page.goto('/administrator/users');
	await page.getByText('Add user').click();
	const form = page.locator('form[action="?/add"]');
	await form.getByLabel(/Username/).fill('siteadm_new');
	await form.getByLabel(/Complete name/).fill('New One');
	await form.getByLabel(/Email address/).fill('siteadm_new@site.org');
	await form.getByLabel(/Password/).fill('123');
	await form.getByRole('button', { name: 'Add' }).click();
	// Same validation policy as every account creation (newUserDoc).
	await expect(page.getByText('Password too short.').first()).toBeVisible();
	await form.getByLabel(/Password/).fill('longpassword');
	await form.getByRole('button', { name: 'Add' }).click();
	await expect(page.getByText('User created.').first()).toBeVisible();
	expect(await withDb((db) => db.collection('users').findOne({ username: 'siteadm_new' }))).toMatchObject({
		email: 'siteadm_new@site.org'
	});
	// Same e-mail address again (the form was reset after the success).
	for (const [label, value] of [
		[/Username/, 'siteadm_new2'],
		[/Complete name/, 'Dup'],
		[/Email address/, 'siteadm_new@site.org'],
		[/Password/, 'longpassword']
	] as const)
		await form.getByLabel(label).fill(value);
	await form.getByRole('button', { name: 'Add' }).click();
	await expect(page.getByText('User could not be created.').first()).toBeVisible();
});

test('SITE-03 deleting a user removes the account after confirmation', async ({ loginAs, page }) => {
	await loginAs('superadmin');
	await page.goto('/administrator/users?q=siteadm_victim');
	await page.getByRole('button', { name: 'Delete' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
	await expect(page.getByText('User deleted.')).toBeVisible();
	expect(await withDb((db) => db.collection('users').findOne({ username: 'siteadm_victim' }))).toBeNull();
});

test('SITE-03 a superadmin cannot delete his own account, even with a forged form', async ({ loginAs, page }) => {
	await loginAs('superadmin');
	await page.goto('/administrator/users?q=superadmin');
	// The button is hidden for the own row; the server refuses the action anyway.
	await page.evaluate(() => {
		const form = Object.assign(document.createElement('form'), { method: 'POST', action: '?/delete' });
		form.append(Object.assign(document.createElement('input'), { name: 'username', value: 'superadmin' }));
		document.body.append(form);
		form.submit();
	});
	await expect(page.getByText('You cannot delete your own account here.')).toBeVisible();
	expect(await withDb((db) => db.collection('users').findOne({ username: 'superadmin' }))).not.toBeNull();
});

test('SITE-04 activating a pending account', async ({ loginAs, page }) => {
	await loginAs('superadmin');
	await page.goto('/administrator/users?q=siteadm_pending');
	await page.getByRole('button', { name: 'Activate' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Activate' }).click();
	await expect(page.getByText('User activated.')).toBeVisible();
	expect(
		(await withDb((db) => db.collection('users').findOne({ username: 'siteadm_pending' })))?.activate
	).toBeUndefined();
});

test('SITE-05 bindings are shown and can be revoked', async ({ loginAs, page }) => {
	await loginAs('superadmin');
	await page.goto('/administrator/users?q=siteadm_bound');
	await expect(page.getByText('gh-77')).toBeVisible();
	await page.getByRole('button', { name: 'Revoke access' }).first().click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
	await expect(page.getByText('Binding revoked.')).toBeVisible();
	expect(
		Object.keys((await withDb((db) => db.collection('users').findOne({ username: 'siteadm_bound' })))!.bindings)
	).toHaveLength(1);
});
