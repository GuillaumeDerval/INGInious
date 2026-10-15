/**
 * Integration tests of the loading feedback of the application shell (CORE-01):
 * when the server is slow, a click never stays without visible feedback — the
 * loading bar during client-side navigations, and a busy submit button (plus the
 * bar) during form submissions, which also ignores a second submission.
 * Server responses are held back with Playwright request interception.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures.js';

/**
 * Holds back the requests matching `url` (and `method`, if given) until `release()`.
 * @returns the release function and the number of held requests so far.
 */
async function holdRequests(page: Page, url: string, method?: string) {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const held = { count: 0, release };
	await page.route(url, async (route) => {
		if (method && route.request().method() !== method) return route.continue();
		held.count++;
		await gate;
		await route.continue();
	});
	return held;
}

test('CORE-01 a slow navigation shows the loading bar until the page arrives', async ({ loginAs }) => {
	const page = await loginAs('e2e_student1');
	await page.goto('/preferences/profile');
	const held = await holdRequests(page, '**/__data.json*');
	await page.getByRole('complementary').getByRole('link', { name: 'Course list' }).click();
	const bar = page.getByRole('progressbar', { name: 'Loading...' });
	await expect(bar).toBeVisible();
	await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'true');
	held.release();
	await expect(page).toHaveURL(/\/courselist$/);
	await expect(bar).toBeHidden();
	await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'false');
});

test('CORE-01 a slow form submission shows a busy button and ignores a second submission', async ({ loginAs }) => {
	const page = await loginAs('e2e_student1');
	await page.goto('/preferences/profile');
	const held = await holdRequests(page, '**/preferences/profile', 'POST');
	const save = page.getByRole('button', { name: 'Save my profile' });
	await save.click();
	await expect(save).toHaveAttribute('aria-busy', 'true');
	await expect(page.getByRole('progressbar', { name: 'Loading...' })).toBeVisible();
	// Enter in a field submits the form again: ignored while the first submission is pending.
	await page.getByLabel('Complete name :').press('Enter');
	held.release();
	await expect(save).not.toHaveAttribute('aria-busy');
	await expect(page.getByRole('progressbar')).toBeHidden();
	expect(held.count).toBe(1);
});
