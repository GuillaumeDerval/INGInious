/**
 * Integration tests of the request pipeline (CORE-01, AUTH-04, AUTH-10).
 */
import { test, expect } from '../fixtures.js';

test('AUTH-10 the UI language is negotiated from Accept-Language', async ({ browser, baseURL }) => {
	const context = await browser.newContext({ locale: 'fr-BE', baseURL });
	const page = await context.newPage();
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
	await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
	await context.close();
});

test('CORE-04 security headers are sent on every page', async ({ request }) => {
	const response = await request.get('/');
	expect(response.headers()['x-content-type-options']).toBe('nosniff');
	expect(response.headers()['x-frame-options']).toBe('DENY');
	expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
});

test('AUTH-04 a forged session cookie gives an anonymous session', async ({ context, page, baseURL }) => {
	await context.addCookies([{ name: 'inginious_session_id', value: '0123456789abcdef01234567.forged', url: baseURL! }]);
	const response = await page.goto('/');
	expect(response?.status()).toBe(200);
});
