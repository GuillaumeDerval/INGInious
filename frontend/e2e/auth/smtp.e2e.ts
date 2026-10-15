/**
 * Integration tests with an unreachable SMTP server (AUTH-07, AUTH-08) and in
 * maintenance mode (AUTH-03).
 */
import { test, expect, withDb } from '../fixtures.js';
import { createUser, uid, useApp } from './helpers.js';

useApp(3, { smtp: { host: 'localhost', port: 1, sendername: 'x@y.z' } });

test('AUTH-07 a registration whose mail cannot be sent is rolled back', async ({ page }) => {
	const name = `auth_s${uid()}`;
	await page.goto('/register');
	const form = page.locator('form[action="?/register"]');
	await form.getByLabel(/Username/).fill(name);
	await form.getByLabel(/Complete name/).fill('S');
	await form.getByLabel(/Email address/).fill(`${name}@inginious.local`);
	await form.getByLabel(/^Password/).fill('secret123');
	await form.getByLabel(/Confirm password/).fill('secret123');
	await form.getByRole('button', { name: 'Sign up' }).click();
	await expect(
		page.getByText('Something went wrong while sending you activation email.', { exact: false })
	).toBeVisible();
	expect(await withDb((db) => db.collection('users').findOne({ username: name }))).toBeNull();
});

test('AUTH-08 a reset request answers the same even when the mail fails', async ({ page }) => {
	const user = await createUser();
	await page.goto('/register#lostpasswd');
	await page.locator('form[action="?/lostpasswd"]').getByLabel('Email address :').fill(user.email);
	await page.getByRole('button', { name: 'Reset my password' }).click();
	await expect(page.getByText('An email has been sent to you to reset your password.')).toBeVisible();
});
