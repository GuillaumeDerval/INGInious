/**
 * Integration tests of the job queue (NAV-17) and the marketplace (NAV-18/19).
 * The marketplace JSON is remote: the tests only rely on paths that never
 * need it (rights, id validation, unknown courses).
 */
import { test, expect } from '../fixtures.js';

test('NAV-17 any user sees the job queue, without kill buttons', async ({ loginAs, baseURL }) => {
	const page = await loginAs('e2e_student1');
	await page.goto('/queue');
	await expect(page.getByRole('heading', { name: 'Running jobs' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Jobs in queue' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Kill' })).toHaveCount(0);
	const res = await page.request.post('/queue?/kill', {
		form: { jobid: 'x' },
		headers: { origin: baseURL!, 'x-sveltekit-action': 'true' }
	});
	expect((await res.json()).status).toBe(403);
	expect((await page.goto('/queue'))!.status()).toBe(200);
});

test('NAV-18 the marketplace is reserved to superadmins and validates the new id', async ({ loginAs, baseURL }) => {
	const student = await loginAs('e2e_student1');
	expect((await student.goto('/marketplace'))!.status()).toBe(403);
	const admin = await loginAs('superadmin');
	await admin.goto('/marketplace');
	await expect(admin.getByRole('heading', { name: 'Marketplace', level: 1 })).toBeVisible();
	const res = await admin.request.post('/marketplace', {
		form: { courseid: 'demo-tasks', new_courseid: 'bad id' },
		headers: { origin: baseURL!, 'x-sveltekit-action': 'true' }
	});
	expect(JSON.stringify(await res.json())).toContain('Course with invalid name: bad id');
});

test('NAV-19 unknown marketplace courses are not found', async ({ loginAs }) => {
	const admin = await loginAs('superadmin');
	expect((await admin.goto('/marketplace/foo'))!.status()).toBe(404);
	await expect(admin.getByText('Course unavailable.')).toBeVisible();
	const student = await loginAs('e2e_student1');
	expect((await student.goto('/marketplace/foo'))!.status()).toBe(403);
});
