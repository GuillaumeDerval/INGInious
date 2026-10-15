/**
 * Integration tests of an instance without self-registration nor account
 * deletion (AUTH-05, AUTH-07, AUTH-13, AUTH-18).
 */
import { test, expect } from '../fixtures.js';
import { createUser, sessionCookie, useApp } from './helpers.js';

useApp(2, { allow_registration: false, allow_deletion: false });

test('AUTH-07 registration is refused when disabled and no link is shown', async ({ page }) => {
	expect((await page.request.get('/register')).status()).toBe(403);
	await page.goto('/signin');
	await expect(page.getByRole('link', { name: 'Register' })).toHaveCount(0);
	// AUTH-05: without registration, the sign-in page has no password form.
	await expect(page.getByLabel('Password')).toHaveCount(0);
});

test('AUTH-13 deletion is refused when disabled', async ({ page, context, baseURL }) => {
	const user = await createUser();
	await context.addCookies([await sessionCookie(user, baseURL!)]);
	await page.goto('/preferences/profile');
	await expect(page.getByRole('link', { name: 'Delete my account' })).toHaveCount(0);
	// AUTH-11: no password change either.
	await expect(page.getByLabel('Old password :')).toHaveCount(0);
	expect((await page.request.get('/preferences/delete')).status()).toBe(403);
});
