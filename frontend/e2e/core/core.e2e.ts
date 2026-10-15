/**
 * Integration tests of the cross-cutting features: layout & navigation (CORE-01),
 * error pages (CORE-02), static assets (CORE-09) and the Content-Security-Policy
 * (CORE-04 security headers) on the heaviest pages.
 */
import { test, expect, installCourse, withDb } from '../fixtures.js';
import { useApp } from '../auth/helpers.js';

/** Course used by these tests (the showcase course of the task area). */
const COURSE = 'e2e_core_showcase';

test.beforeAll(async () => {
	installCourse('task_showcase', COURSE);
	await withDb((db) =>
		db
			.collection('courses')
			.updateOne({ _id: COURSE as never }, { $addToSet: { students: 'e2e_student1' } }, { upsert: true })
	);
});

test('CORE-01 anonymous visitors get the public navigation, language menu and footer', async ({ page }) => {
	await page.goto('/courselist');
	const nav = page.getByRole('navigation').first();
	await expect(nav.getByRole('link', { name: 'Course list' })).toBeVisible();
	await expect(page.getByRole('link', { name: /sign in/i }).first()).toBeVisible();
	await expect(page.getByRole('contentinfo')).toContainText('AGPL');
	await expect(page.getByRole('button', { name: 'Language' })).toBeVisible();
});

test('CORE-01 the user menu shows the identity and superadmin links', async ({ loginAs }) => {
	const page = await loginAs('superadmin');
	await page.goto('/mycourses');
	await page.getByRole('button', { name: 'User menu' }).click();
	await expect(page.getByRole('menu')).toContainText('INGInious superadmin');
	await expect(page.getByRole('menuitem', { name: 'Administration' })).toBeVisible();
	await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
});

test('CORE-01 right-to-left languages switch the page direction', async ({ page }) => {
	await page.goto('/courselist');
	await page.getByRole('button', { name: 'Language' }).click();
	await page.getByRole('menuitem', { name: /עִבְרִית/ }).click();
	await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
	await expect(page.locator('html')).toHaveAttribute('lang', 'he');
});

test('CORE-02 unknown pages answer a friendly 404 and forbidden pages a 403', async ({ page, loginAs }) => {
	const missing = await page.goto('/this/page/does/not/exist');
	expect(missing?.status()).toBe(404);
	await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
	const student = await loginAs('e2e_student1');
	const forbidden = await student.goto(`/admin/${COURSE}/settings`);
	expect(forbidden?.status()).toBe(403);
	const unknownCourse = await student.goto('/course/no_such_course_e2e');
	expect(unknownCourse?.status()).toBe(404);
});

test('CORE-09 hashed static assets are served with long-term caching', async ({ page, request }) => {
	await page.goto('/courselist');
	const script =
		(await page.locator('link[rel=modulepreload], script[src]').first().getAttribute('href')) ??
		(await page.locator('script[src]').first().getAttribute('src'));
	expect(script).toContain('/_app/immutable/');
	const response = await request.get(script!);
	expect(response.status()).toBe(200);
	expect(response.headers()['cache-control']).toContain('immutable');
});

test('CORE-04 pages send a CSP and render without any CSP violation', async ({ loginAs }) => {
	const page = await loginAs('superadmin');
	const violations: string[] = [];
	page.on('console', (msg) => {
		if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
	});
	const response = await page.goto(`/course/${COURSE}/code_python`);
	expect(response?.headers()['content-security-policy']).toMatch(/script-src 'self' 'nonce-/);
	await expect(page.locator('.cm-editor').first()).toBeVisible();
	await page.goto(`/admin/${COURSE}/edit/task/code_python`);
	await expect(page.getByRole('heading').first()).toBeVisible();
	await page.goto(`/admin/${COURSE}/stats`);
	await page.waitForLoadState('networkidle');
	expect(violations).toEqual([]);
});

test.describe('Sentry', () => {
	// CORE-06 needs a server whose configuration defines `sentry_io_url`.
	useApp(7, { sentry_io_url: 'https://publickey@sentry.invalid/1' });

	test('CORE-06 the Sentry browser SDK is initialised when configured', async ({ page }) => {
		await page.goto('/courselist');
		await expect
			.poll(() => page.evaluate(() => typeof (window as unknown as { __SENTRY__?: unknown }).__SENTRY__))
			.toBe('object');
	});
});

test('CORE-06 the Sentry SDK is not loaded without configuration', async ({ page }) => {
	await page.goto('/courselist');
	await page.waitForLoadState('networkidle');
	expect(await page.evaluate(() => typeof (window as unknown as { __SENTRY__?: unknown }).__SENTRY__)).toBe(
		'undefined'
	);
});
