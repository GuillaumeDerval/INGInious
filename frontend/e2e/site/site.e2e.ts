/**
 * Integration tests of the REST API v0 (SITE-06..11) and of the bundled
 * plugins using the `e2e_site_main` course (SITE-12, 13, 16, 18, 19).
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Dealer } from 'zeromq';
import { decode, encode } from '@msgpack/msgpack';
import { test, expect, installCourse, withDb } from '../fixtures.js';

/** True when the grading backend answers a ClientHello with environments (grading possible). */
const backendUp = (async () => {
	const dealer = new Dealer({ linger: 0, receiveTimeout: 3000 });
	// Same address as the backend of e2e/config.yaml (the Colima port is bound to IPv4 only).
	dealer.connect('tcp://127.0.0.1:2000');
	try {
		await dealer.send(encode({ name: 'e2e-site-probe', '@type': 'ClientHello' }));
		const [frame] = await dealer.receive();
		return Object.keys((decode(frame) as { available_environments?: object }).available_environments ?? {}).length > 0;
	} catch {
		return false;
	} finally {
		dealer.close();
	}
})();

let course: string;
test.beforeAll(async () => {
	course = installCourse('site_main', undefined, { shared: true });
	await withDb(async (db) => {
		await db
			.collection('courses')
			.updateOne({ _id: course as never }, { $set: { students: ['e2e_student1', 'e2e_student2'] } }, { upsert: true });
		await db.collection('submissions').deleteMany({ courseid: course });
		await db.collection('user_tasks').deleteMany({ courseid: course });
	});
});

test('SITE-06 API conventions: JSON/YAML negotiation, 403, 404 and 405', async ({ request }) => {
	expect(await (await request.get('/api/v0/courses')).json()).toEqual({ error: 'You are not authenticated' });
	const yaml = await request.get('/api/v0/auth_methods', { headers: { Accept: 'text/yaml' } });
	expect(yaml.headers()['content-type']).toBe('text/yaml; charset=utf-8');
	expect(await yaml.text()).toContain('INGInious account');
	const put = await request.put('/api/v0/auth_methods', { data: {} });
	expect([put.status(), put.headers()['allow']]).toEqual([405, 'GET']);
	expect((await request.get('/api/v0/unknown')).status()).toBe(404);
});

test('SITE-07 API login rotates the session and reports the status', async ({ request }) => {
	expect(await (await request.get('/api/v0/authentication')).json()).toEqual({ authenticated: false });
	const before = (await request.storageState()).cookies.find((c) => c.name === 'inginious_session_id')?.value;
	expect(
		(await request.post('/api/v0/authentication', { data: { login: 'e2e_student1', password: 'wrong' } })).status()
	).toBe(403);
	expect((await request.post('/api/v0/authentication', { data: { login: 'e2e_student1' } })).status()).toBe(400);
	const ok = await request.post('/api/v0/authentication', { data: { login: 'e2e_student1', password: 'superadmin' } });
	expect(await ok.json()).toEqual({ status: 'success', username: 'e2e_student1' });
	expect((await request.storageState()).cookies.find((c) => c.name === 'inginious_session_id')?.value).not.toBe(before);
	expect(await (await request.get('/api/v0/authentication')).json()).toEqual({
		authenticated: true,
		username: 'e2e_student1'
	});
});

test('SITE-08 API lists the courses with visible tasks and grade', async ({ loginAs, page }) => {
	await loginAs('e2e_student1');
	const [item] = await (await page.request.get(`/api/v0/courses/${course}`)).json();
	expect(item).toMatchObject({ id: course, name: 'SITE main course', is_registered: true, grade: 0 });
	expect(Object.keys(item.tasks).sort()).toEqual(['code1', 'code2', 'mcq1']);
	expect((await page.request.get('/api/v0/courses/nope')).status()).toBe(404);
});

test('SITE-09 API returns task statements without answers; hidden tasks are not found', async ({ loginAs, page }) => {
	await loginAs('e2e_student1');
	const [mcq] = await (await page.request.get(`/api/v0/courses/${course}/tasks/mcq1`)).json();
	expect(mcq.problems.find((p: { id: string }) => p.id === 'q2').answer).toBeUndefined();
	expect(mcq.problems.find((p: { id: string }) => p.id === 'q1').choices).toEqual({ 0: '2', 1: '3', 2: '4' });
	expect((await page.request.get(`/api/v0/courses/${course}/tasks/hidden`)).status()).toBe(404);
	await page.context().clearCookies();
	await loginAs('e2e_student3');
	expect((await page.request.get(`/api/v0/courses/${course}/tasks`)).status()).toBe(403);
});

test('SITE-11 SITE-10 API submission is graded and read back by its owner only', async ({ loginAs, page }) => {
	test.setTimeout(120_000);
	await loginAs('e2e_student1');
	const url = `/api/v0/courses/${course}/tasks/mcq1/submissions`;
	const created = await page.request.post(url, { data: { q1: '0', q2: 'yes' } });
	expect(created.status()).toBe(200);
	const { submissionid } = await created.json();
	// Without grading backend the submission ends as an error ("Environment not available.").
	const up = await backendUp;
	await expect
		.poll(async () => (await (await page.request.get(`${url}/${submissionid}`)).json())[0].status, { timeout: 90_000 })
		.toBe(up ? 'done' : 'error');
	const [sub] = await (await page.request.get(`${url}/${submissionid}?input`)).json();
	if (up) expect(sub).toMatchObject({ id: submissionid, result: 'success', grade: 100 });
	expect(sub.input).toMatchObject({ q2: 'yes', '@username': 'e2e_student1' });
	expect((await (await page.request.get(url)).json()).length).toBeGreaterThan(0);
	expect((await page.request.post(`/api/v0/courses/${course}/tasks/hidden/submissions`, { data: {} })).status()).toBe(
		404
	);
	await page.context().clearCookies();
	await loginAs('e2e_student2');
	expect(await (await page.request.get(`${url}/${submissionid}`)).json()).toEqual({ error: 'Submission not found' });
});

test('SITE-12 SITE-13 scoreboard plugin: menus, rankings and access', async ({ loginAs, page }) => {
	await withDb((db) =>
		db.collection('submissions').insertMany(
			[
				['e2e_student1', 5],
				['e2e_student1', 9],
				['e2e_student2', 7]
			].map(([u, score]) => ({
				courseid: course,
				taskid: 'code1',
				username: [u],
				custom: { score },
				result: 'success',
				status: 'done',
				submitted_on: new Date(),
				grade: 100
			}))
		)
	);
	await loginAs('e2e_student2');
	await page.goto(`/course/${course}`);
	await page.getByRole('link', { name: 'Scoreboards' }).first().click();
	await expect(page.getByRole('heading', { name: /Available scoreboards/ })).toBeVisible();
	await page.getByRole('link', { name: 'Code 1 only' }).click();
	const rows = page.locator('tbody tr');
	await expect(rows.nth(0)).toContainText(/E2E student1/i);
	await expect(rows.nth(0)).toContainText('9');
	await expect(rows.nth(1)).toContainText(/E2E student2/i);
	expect((await page.goto(`/scoreboard/${course}/9`))!.status()).toBe(404);
	await page.context().clearCookies();
	await loginAs('e2e_student3');
	expect((await page.goto(`/scoreboard/${course}`))!.status()).toBe(403);
});

test('SITE-16 demo plugin page', async ({ request }) => {
	const r = await request.get('/plugindemo');
	expect([r.status(), await r.text()]).toEqual([200, 'This is a simple demo plugin']);
});

test('SITE-18 simple_grader requires the shared secret and grades', async ({ request }) => {
	test.setTimeout(120_000);
	expect((await request.get('/external')).status()).toBe(200);
	expect((await request.post('/external', { data: { taskid: 'mcq1', input: '{}' } })).status()).toBe(403);
	const r = await request.post('/external', {
		data: { api_key: 'e2e-grader-key', taskid: 'mcq1', input: JSON.stringify({ q1: '0', q2: 'yes' }) },
		timeout: 90_000
	});
	expect(r.headers()['access-control-allow-origin']).toBe('*');
	expect(await r.json()).toMatchObject({ status: 'done', result: (await backendUp) ? 'success' : 'crash' });
	expect(
		await (await request.post('/external', { data: { api_key: 'e2e-grader-key', taskid: 'mcq1', input: '{' } })).json()
	).toEqual({ status: 'error', status_message: 'Cannot decode input' });
});

test('SITE-19 git_repo commits graded submissions', async () => {
	// The API submission of SITE-11 (same file, run before) was graded and committed.
	const repo = 'e2e/.generated/git-repo';
	await expect
		.poll(() => existsSync(`${repo}/${course}/mcq1/e2e_student1/result.yaml`), { timeout: 30_000 })
		.toBe(true);
	expect(execFileSync('git', ['log', '--format=%s'], { cwd: repo, encoding: 'utf8' })).toContain(`${course}/mcq1 - `);
});
