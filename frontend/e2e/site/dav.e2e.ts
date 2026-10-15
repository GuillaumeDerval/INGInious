/**
 * Integration tests of the WebDAV access (SITE-22, SITE-23).
 */
import { test, expect, installCourse, withDb } from '../fixtures.js';

const KEY = 'a'.repeat(80);
let course: string;
let other: string;
const auth = (u = 'e2e_admin', k = KEY) => ({ Authorization: `Basic ${Buffer.from(`${u}:${k}`).toString('base64')}` });

test.beforeAll(async () => {
	course = installCourse('site_main', 'e2e_site_dav');
	other = installCourse('tutorial', 'e2e_site_dav2');
	await withDb((db) =>
		db.collection('users').updateMany({ username: { $in: ['e2e_admin', 'e2e_tutor'] } }, { $set: { apikey: KEY } })
	);
});

test('SITE-22 WebDAV requires the API key of a course admin', async ({ request }) => {
	const none = await request.fetch(`/dav/${course}/`, { method: 'PROPFIND' });
	expect([none.status(), none.headers()['www-authenticate']]).toEqual([401, `Basic realm="${course}"`]);
	expect(
		(await request.fetch(`/dav/${course}/`, { method: 'PROPFIND', headers: auth('e2e_admin', 'bad') })).status()
	).toBe(401);
	expect((await request.fetch(`/dav/${course}/`, { method: 'PROPFIND', headers: auth('e2e_tutor') })).status()).toBe(
		401
	);
	expect(
		(await request.fetch(`/dav/${course}/`, { method: 'PROPFIND', headers: { ...auth('superadmin', 'x') } })).status()
	).toBe(401);
	const ok = await request.fetch(`/dav/${course}/`, { method: 'PROPFIND', headers: { ...auth(), Depth: '1' } });
	expect(ok.status()).toBe(207);
	expect(await ok.text()).toContain(`/dav/${course}/mcq1/`);
});

test('SITE-23 WebDAV reads and writes course files safely', async ({ request }) => {
	const h = { ...auth(), 'Content-Type': 'application/octet-stream' };
	expect(await (await request.get(`/dav/${course}/mcq1/task.yaml`, { headers: auth() })).text()).toContain('MCQ one');
	expect((await request.fetch(`/dav/${course}/newtask`, { method: 'MKCOL', headers: auth() })).status()).toBe(201);
	const task =
		'name: Via DAV\nenvironment_type: mcq\nenvironment_id: mcq\nproblems:\n  q:\n    type: match\n    answer: x\n';
	expect((await request.put(`/dav/${course}/newtask/task.yaml`, { headers: h, data: task })).status()).toBe(201);
	expect(
		(await request.put(`/dav/${course}/newtask/task.yaml`, { headers: h, data: 'name: [unclosed' })).status()
	).toBe(400);
	expect((await request.put(`/dav/${course}/course.yaml`, { headers: h, data: 'foo: 1' })).status()).toBe(400);
	expect((await request.delete(`/dav/${course}/course.yaml`, { headers: h })).status()).toBe(403);
	// Paths are confined to the course: the path is normalised before the course is chosen.
	expect((await request.get(`/dav/${course}/..%2F${other}/course.yaml`, { headers: auth() })).status()).not.toBe(200);
	expect(
		(
			await request.fetch(`/dav/${course}/newtask`, {
				method: 'MOVE',
				headers: { ...auth(), Destination: `/dav/${course}/moved` }
			})
		).status()
	).toBe(201);
	expect((await request.delete(`/dav/${course}/moved`, { headers: h })).status()).toBe(204);
});
