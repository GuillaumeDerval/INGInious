/** Integration test of the maintenance mode (AUTH-03). */
import { test, expect } from '../fixtures.js';
import { useApp } from './helpers.js';

useApp(4, { maintenance: true });

test('AUTH-03 CORE-03 every URL answers the maintenance page in maintenance mode', async ({ page, baseURL }) => {
	for (const path of ['/', '/courselist', '/course/x/y', '/api/v0/courses']) {
		const response = await page.request.get(path);
		expect(response.status()).toBe(503);
		expect(await response.text()).toContain('currently under maintenance');
	}
	expect(
		(
			await page.request.post('/signin', { form: { login: 'a', password: 'b' }, headers: { origin: baseURL! } })
		).status()
	).toBe(503);
});
