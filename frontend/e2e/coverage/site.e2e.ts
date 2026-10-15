/**
 * Coverage-driven integration tests of the site, navigation, authentication and
 * LTI areas: flows not exercised by the feature tests of e2e/{nav,auth,site,lti,core}
 * (job queue with real slow jobs, REST API and WebDAV error branches, scoreboard
 * and contest variants, simple_grader, error pages, menus) and, on an extra
 * server, the integrations with external services replaced by local fakes:
 * marketplace JSON + git repositories, OAuth 2 providers, an LDAP directory
 * (glauth container), SAML, reverse-proxy headers.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash, createHmac, createPublicKey } from 'node:crypto';
import { resolve } from 'node:path';
import { ObjectId } from 'mongodb';
import { exportJWK } from 'jose';
import { parse, stringify } from 'yaml';
import type { APIRequestContext, Page } from '@playwright/test';
import { createSessionCookie, expect, installCourse, removeCourse, test, withDb } from '../fixtures.js';
import { E2E, E2E_ID } from '../setup-data.js';
import { appUrl, createUser, sessionCookie, startApp, uid, type App } from '../auth/helpers.js';
import { idpCert, samlResponse } from '../auth/saml-idp.js';
import { launch11, startMockLms, type MockLms } from '../lti/mock/platform.js';

/** Basic authorization header. */
const basic = (user: string, key: string) => ({
	Authorization: `Basic ${Buffer.from(`${user}:${key}`).toString('base64')}`
});
/** Registers students to a course (DB `courses` document). */
const register = (courseid: string, students: string[]) =>
	withDb((db) =>
		db.collection('courses').updateOne({ _id: courseid as never }, { $set: { students } }, { upsert: true })
	);
/** A done submission document. */
const submission = (courseid: string, taskid: string, username: string[], fields: Record<string, unknown> = {}) => ({
	courseid,
	taskid,
	username,
	status: 'done',
	result: 'success',
	grade: 100,
	submitted_on: new Date(),
	...fields
});
/** Posts a form action the way the browser does (same origin). */
const action = (request: APIRequestContext, url: string, form: Record<string, string>, origin: string) =>
	request.post(url, { form, headers: { origin, accept: 'application/json', 'x-sveltekit-action': 'true' } });
/** Status and `message` of a form action posted with `action`. */
async function actionResult(response: Awaited<ReturnType<typeof action>>) {
	const body = await response.json();
	const data = body.data ? (JSON.parse(body.data) as unknown[]) : [];
	return { status: body.status as number, message: data[1] as string | undefined };
}

/**
 * Records the forms of `page` submitted to `path` and cancels their submission, so that the
 * document (and its browser coverage) stays; returns the list of the posted form data.
 */
async function holdSubmissions(page: Page, path: string): Promise<() => Promise<string[]>> {
	await page.evaluate((path) => {
		const held: string[] = ((window as unknown as { held: string[] }).held = []);
		document.addEventListener('submit', (event) => {
			const form = event.target as HTMLFormElement;
			if (new URL(form.action).pathname !== path) return;
			event.preventDefault();
			held.push(new URLSearchParams(new FormData(form) as unknown as string[][]).toString());
		});
	}, path);
	return () => page.evaluate(() => (window as unknown as { held: string[] }).held);
}

/** Rewrites the course.yaml of an installed course (YAML 1.1 like the app). */
function editCourse(courseid: string, edit: (content: Record<string, unknown>) => void) {
	const file = resolve(E2E.tasksDir, `${courseid}/course.yaml`);
	const content = parse(readFileSync(file, 'utf8'), { version: '1.1' }) as Record<string, unknown>;
	edit(content);
	writeFileSync(file, stringify(content, { version: '1.1' }));
}

test.describe('main server', () => {
	let course: string;
	let contest: string;
	test.beforeAll(async () => {
		course = installCourse('cov_site');
		contest = installCourse('cov_site_contest');
		// Course of the simple_grader plugin (e2e/config.yaml), also used by site/site.e2e.ts.
		installCourse('site_main', undefined, { shared: true });
		await register(course, ['e2e_student1', 'e2e_student2', 'e2e_student3']);
		await register(contest, ['e2e_student1', 'e2e_student2']);
		await withDb(async (db) => {
			await db.collection('submissions').deleteMany({ courseid: { $in: [course, contest] } });
			await db.collection('user_tasks').deleteMany({ courseid: { $in: [course, contest] } });
		});
	});

	test('NAV-17 SITE-11 the job queue lists running and waiting jobs; admins kill them', async ({
		page,
		loginAs,
		baseURL,
		playwright
	}) => {
		test.setTimeout(180_000);
		// Ten slow jobs (two tasks for five users): more than the docker agent runs at once.
		const users = ['e2e_student1', 'e2e_student2', 'e2e_student3', 'e2e_admin', 'superadmin'];
		const ids: string[] = [];
		for (const user of users) {
			await page.context().clearCookies();
			await loginAs(user);
			for (const task of ['slow1', 'slow2']) {
				const url = `/api/v0/courses/${course}/tasks/${task}/submissions`;
				// Form-encoded body (not JSON).
				const created = await page.request.post(url, { form: { answer: 'x' }, headers: { origin: baseURL! } });
				expect(created.status()).toBe(200);
				ids.push((await created.json()).submissionid);
				// A second submission while the first one is pending is refused (SubmissionError -> 409).
				if (user === 'e2e_student1' && task === 'slow1') {
					expect((await page.request.post(url, { data: { answer: 'y' } })).status()).toBe(409);
					const [sub] = await (await page.request.get(`${url}/${ids[0]}`)).json();
					expect(sub.status).toBe('waiting');
					expect(sub.grade).toBeUndefined();
				}
			}
		}
		// The snapshot of the queue is refreshed every 10 seconds.
		await page.context().clearCookies();
		await loginAs('e2e_student1');
		await expect
			.poll(
				async () => {
					await page.goto('/queue');
					return page
						.locator(`tr[title]`)
						.filter({ hasText: `${course}/slow` })
						.count();
				},
				{ timeout: 40_000, intervals: [2_000] }
			)
			.toBeGreaterThan(3);
		await expect(page.getByRole('heading', { name: /Running jobs/ })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Kill' })).toHaveCount(0);
		const jobid = (await page
			.locator('tr[title]')
			.filter({ hasText: `${course}/slow` })
			.first()
			.getAttribute('title'))!;
		// Students may not kill jobs, even with a forged form; unknown jobs are refused too.
		expect((await actionResult(await action(page.request, '/queue?/kill', { jobid }, baseURL!))).status).toBe(403);
		const refused = await page.request.post('/queue?/kill', {
			form: { jobid },
			headers: { origin: baseURL!, accept: 'text/html' }
		});
		expect(await refused.text()).toContain("You're not allowed to do that");
		await page.context().clearCookies();
		await loginAs('e2e_admin');
		await page.goto('/queue');
		const rows = page.locator('tr[title]').filter({ hasText: `${course}/slow` });
		await rows.first().getByRole('button', { name: 'Kill' }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Kill' }).click();
		await expect(page.getByText('Kill request sent.')).toBeVisible();
		// The superadmin kills every remaining job of the course (running or waiting), from another
		// client: the page keeps showing the jobs (browser coverage is taken from the last document).
		const root = await playwright.request.newContext({
			baseURL,
			extraHTTPHeaders: {
				'x-forwarded-proto': 'http',
				cookie: `inginious_session_id=${await createSessionCookie('superadmin')}`
			}
		});
		await expect
			.poll(
				async () => {
					const html = await (await root.get('/queue')).text();
					const titles = [...html.matchAll(/<tr title="([^"]+)">(?:(?!<\/tr>)[\s\S])*?\/slow\d/g)]
						.filter((m) => m[0].includes(course))
						.map((m) => m[1]);
					for (const id of titles) await action(root, '/queue?/kill', { jobid: id }, baseURL!);
					return titles.length;
				},
				{ timeout: 90_000, intervals: [5_000] }
			)
			.toBe(0);
		await root.dispose();
		await expect
			.poll(
				async () =>
					withDb((db) =>
						db.collection('submissions').countDocuments({ courseid: course, status: { $in: ['waiting'] } })
					),
				{ timeout: 60_000 }
			)
			.toBe(0);
	});

	test('SITE-06 SITE-08 SITE-11 REST API error branches', async ({ page, loginAs, request, baseURL }) => {
		test.setTimeout(120_000);
		await loginAs('e2e_student1');
		// Every course the user is registered to or may register to (no course id).
		const all = await (await page.request.get('/api/v0/courses')).json();
		expect(all.find((c: { id: string }) => c.id === course)).toMatchObject({ is_registered: true });
		await page.context().clearCookies();
		await loginAs('e2e_tutor');
		const open = await (await page.request.get('/api/v0/courses')).json();
		expect(open.find((c: { id: string }) => c.id === contest)).toMatchObject({ is_registered: false });
		expect(open.find((c: { id: string }) => c.id === contest).tasks).toBeUndefined();
		await page.context().clearCookies();
		await loginAs('e2e_student2');
		const base = `/api/v0/courses/${course}/tasks`;
		// HEAD is answered like GET.
		expect((await page.request.head(`${base}/mcq1`)).status()).toBe(200);
		// POST on one submission: method not allowed.
		const post = await page.request.post(`${base}/mcq1/submissions/${new ObjectId()}`, { data: {} });
		expect([post.status(), post.headers().allow]).toEqual([405, 'GET, POST']);
		// Closed task: visible but not open to submissions.
		expect((await page.request.post(`${base}/closed/submissions`, { data: { answer: '1' } })).status()).toBe(403);
		// Inconsistent input (missing answers), invalid JSON and invalid form bodies.
		expect((await page.request.post(`${base}/mcq1/submissions`, { data: { q1: '9' } })).status()).toBe(400);
		const badJson = await page.request.post(`${base}/mcq1/submissions`, {
			headers: { 'content-type': 'application/json' },
			data: Buffer.from('{not json')
		});
		expect(badJson.status()).toBe(400);
		const badForm = await page.request.post(`${base}/mcq1/submissions`, {
			headers: { 'content-type': 'multipart/form-data; boundary=x', origin: baseURL! },
			data: 'garbage'
		});
		expect(badForm.status()).toBe(400);
		// A file problem: the stored input is returned in base64.
		const file = await page.request.post(`${base}/file1/submissions`, {
			multipart: { upload: { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') } },
			headers: { origin: baseURL! }
		});
		const { submissionid } = await file.json();
		const [sub] = await (await page.request.get(`${base}/file1/submissions/${submissionid}?input`)).json();
		expect(sub.input.upload).toMatchObject({ filename: 'a.txt', value: Buffer.from('hello').toString('base64') });
		// YAML answers are also chosen from the Content-Type of the request.
		const yaml = await request.post('/api/v0/authentication', {
			headers: { 'content-type': 'application/x-yaml' },
			data: 'login: x'
		});
		expect(yaml.headers()['content-type']).toBe('text/yaml; charset=utf-8');
	});

	test('SITE-22 SITE-23 WebDAV methods and refusals', async ({ request }) => {
		const KEY = 'c'.repeat(80);
		await withDb((db) => db.collection('users').updateOne({ username: 'e2e_admin' }, { $set: { apikey: KEY } }));
		const h = basic('e2e_admin', KEY);
		const dav = (method: string, path: string, headers: Record<string, string> = {}, data?: string) =>
			request.fetch(`/dav/${path}`, { method, headers: { ...h, ...headers }, data });
		expect((await dav('PROPFIND', 'nope/')).status()).toBe(404);
		expect((await dav('PROPFIND', '')).status()).toBe(404);
		// A symbolic link leaving the course folder is not followed.
		const link = resolve(E2E.tasksDir, `${course}/escape`);
		rmSync(link, { force: true });
		symlinkSync('/etc', link);
		expect((await dav('GET', `${course}/escape/hosts`)).status()).not.toBe(200);
		rmSync(link, { force: true });
		expect((await dav('PROPFIND', '..%2F..%2Fetc/')).status()).toBe(404);
		// No credentials at all, credentials without colon, unknown user.
		expect((await request.fetch(`/dav/${course}/`, { method: 'PROPFIND' })).status()).toBe(401);
		expect(
			(
				await request.fetch(`/dav/${course}/`, { method: 'PROPFIND', headers: { Authorization: 'Basic eA==' } })
			).status()
		).toBe(401);
		expect((await request.fetch(`/dav/${course}/`, { method: 'GET', headers: basic('nobody', 'x') })).status()).toBe(
			401
		);
		const options = await dav('OPTIONS', `${course}/`);
		expect([options.status(), options.headers().dav]).toEqual([200, '1, 2']);
		expect(await (await dav('GET', `${course}/`)).text()).toContain('course.yaml');
		expect((await dav('GET', `${course}/missing.txt`)).status()).toBe(404);
		const head = await dav('HEAD', `${course}/mcq1/task.yaml`);
		expect([head.status(), Number(head.headers()['content-length'])]).toEqual([200, expect.any(Number)]);
		expect((await dav('PROPFIND', `${course}/missing/`)).status()).toBe(404);
		const depth0 = await (await dav('PROPFIND', `${course}/`, { Depth: '0' })).text();
		expect(depth0).not.toContain('mcq1');
		const fileProps = await (await dav('PROPFIND', `${course}/mcq1/task.yaml`)).text();
		expect(fileProps).toContain('getcontentlength');
		// PUT: on a folder, in a missing folder, then create and replace a file.
		expect((await dav('PUT', `${course}/mcq1`, {}, 'x')).status()).toBe(405);
		expect((await dav('PUT', `${course}/nofolder/a.txt`, {}, 'x')).status()).toBe(409);
		expect((await dav('PUT', `${course}/notes.txt`, {}, 'one')).status()).toBe(201);
		expect((await dav('PUT', `${course}/notes.txt`, {}, 'two')).status()).toBe(204);
		// MKCOL on an existing folder or in a missing parent.
		expect((await dav('MKCOL', `${course}/mcq1`)).status()).toBe(405);
		expect((await dav('MKCOL', `${course}/a/b`)).status()).toBe(409);
		// DELETE of a missing file, of the course root.
		expect((await dav('DELETE', `${course}/missing.txt`)).status()).toBe(404);
		expect((await dav('DELETE', `${course}`)).status()).toBe(403);
		// COPY/MOVE: missing source, protected targets, other course, overwrite rules.
		const to = (path: string) => ({ Destination: `/dav/${path}` });
		expect((await dav('COPY', `${course}/missing.txt`, to(`${course}/x.txt`))).status()).toBe(404);
		// Without destination (400), onto itself (403).
		expect((await dav('COPY', `${course}/notes.txt`)).status()).toBe(400);
		expect((await dav('MOVE', `${course}/notes.txt`, to(`${course}/notes.txt`))).status()).toBe(403);
		expect((await dav('COPY', `${course}/notes.txt`, to(`${course}/course.yaml`))).status()).toBe(403);
		expect((await dav('COPY', `${course}/notes.txt`, to(`site_main/notes.txt`))).status()).toBe(403);
		expect((await dav('COPY', `${course}/notes.txt`, { Destination: '/dav/%E0%A4%A' })).status()).toBe(403);
		expect((await dav('COPY', `${course}/notes.txt`, to(`${course}/copy.txt`))).status()).toBe(201);
		expect((await dav('COPY', `${course}/notes.txt`, { ...to(`${course}/copy.txt`), Overwrite: 'F' })).status()).toBe(
			412
		);
		expect((await dav('COPY', `${course}/notes.txt`, to(`${course}/copy.txt`))).status()).toBe(204);
		expect((await dav('COPY', `${course}/mcq1`, to(`${course}/mcq1copy`))).status()).toBe(201);
		expect((await dav('MOVE', `${course}/copy.txt`, to(`${course}/notes.txt`))).status()).toBe(204);
		const lock = await dav('LOCK', `${course}/notes.txt`);
		expect([lock.status(), lock.headers()['lock-token']]).toEqual([200, expect.stringMatching(/^<opaquelocktoken:/)]);
		expect((await dav('UNLOCK', `${course}/notes.txt`)).status()).toBe(204);
		const patch = await dav('PATCH', `${course}/notes.txt`);
		expect([patch.status(), patch.headers().allow]).toContain(405);
		for (const path of ['notes.txt', 'mcq1copy']) expect((await dav('DELETE', `${course}/${path}`)).status()).toBe(204);
	});

	test('SITE-12 SITE-13 scoreboard variants: forms of content, ties, groups, reverse order and invalid boards', async ({
		page,
		loginAs
	}) => {
		await withDb(async (db) => {
			await db.collection('users').deleteMany({ username: 'cov_ghost' });
			await db
				.collection('submissions')
				.insertMany([
					submission(course, 'code1', ['e2e_student1'], { custom: { score: 5 } }),
					submission(course, 'code1', ['e2e_student1'], { custom: { score: '8' } }),
					submission(course, 'code1', ['e2e_student2'], { custom: { score: 8 } }),
					submission(course, 'code1', ['e2e_student3', 'cov_ghost'], { custom: { score: 3 } }),
					submission(course, 'code1', ['e2e_student3'], { custom: { score: '  ' } }),
					submission(course, 'code1', ['e2e_student3'], { custom: { score: { nested: 1 } } }),
					submission(course, 'code2', ['e2e_student1'], { custom: { score: 4 } }),
					submission(course, 'code2', ['e2e_student1'], { custom: { score: 1 } }),
					submission(course, 'code2', ['e2e_student2'], { custom: { score: 2 } })
				]);
		});
		await loginAs('e2e_student1');
		// Task menus: a task of several scoreboards links to the list, a task of one board to that board.
		for (const task of ['code1', 'slow1', 'mcq1']) await page.goto(`/course/${course}/${task}`);
		await page.goto(`/scoreboard/${course}`);
		await expect(page.getByRole('link', { name: 'Weighted' })).toBeVisible();
		// Single task: ties share the rank (empty cell), the group shows both names.
		await page.goto(`/scoreboard/${course}/0`);
		const rows = page.locator('tbody tr');
		await expect(rows).toHaveCount(3);
		await expect(rows.nth(2)).toContainText('cov_ghost');
		await page.goto(`/scoreboard/${course}/1`);
		await expect(page.getByRole('columnheader', { name: 'Total score' })).toBeVisible();
		await page.goto(`/scoreboard/${course}/2`);
		await expect(page.locator('tbody tr').first()).toBeVisible();
		for (const index of ['4', '5', '6', 'x'])
			expect((await page.goto(`/scoreboard/${course}/${index}`))!.status(), index).toBe(404);
		// Courses without scoreboard.
		expect((await page.goto(`/scoreboard/${contest}`))!.status()).toBe(404);
	});

	test('SITE-14 contest variants: results, settings validation and disabled contests', async ({
		page,
		loginAs,
		baseURL
	}) => {
		const at = (h: number) => new Date(Date.UTC(2021, 0, 1, h));
		await withDb((db) =>
			db
				.collection('submissions')
				.insertMany([
					submission(contest, 'mcq1', ['e2e_student1'], { result: 'killed', submitted_on: at(1) }),
					submission(contest, 'mcq1', ['e2e_student1'], { result: 'timeout', submitted_on: at(2) }),
					submission(contest, 'mcq1', ['e2e_student1'], { result: 'crash', submitted_on: at(3) }),
					submission(contest, 'mcq1', ['e2e_student1'], { submitted_on: at(4) }),
					submission(contest, 'mcq1', ['e2e_student1'], { submitted_on: at(5) }),
					submission(contest, 'mcq1', ['e2e_student2'], { submitted_on: at(6) }),
					submission(contest, 'ghost', ['e2e_student2'], { submitted_on: at(7) })
				])
		);
		await loginAs('e2e_admin');
		await page.goto(`/course/${contest}`);
		await expect(page.getByRole('link', { name: 'Contest settings' }).first()).toBeVisible();
		await page.goto(`/contest/${contest}`);
		await expect(page.locator('tbody tr').first()).toBeVisible();
		const save = (fields: Record<string, string>) =>
			action(
				page.request,
				`/contest/${contest}/admin`,
				{
					enabled: 'on',
					start: '2020-01-01 00:00:00',
					end: '2099-01-01 00:00:00',
					blackout: '0',
					penalty: '20',
					...fields
				},
				baseURL!
			);
		const message = async (fields: Record<string, string>) => (await actionResult(await save(fields))).message;
		expect(await message({ start: 'nope' })).toBe('Invalid start date');
		expect(await message({ end: 'nope' })).toBe('Invalid end date');
		expect(await message({ blackout: 'x' })).toBe('Invalid number of hours for the blackout');
		expect(await message({ penalty: '-3' })).toBe(
			'Invalid number of minutes for the penalty: should be greater than 0'
		);
		await save({ enabled: '' });
		await page.goto(`/course/${contest}`);
		await expect(page.getByRole('link', { name: 'Contest', exact: true })).toHaveCount(0);
		expect((await page.goto(`/contest/${contest}`))!.status()).toBe(404);
		await save({});
		// Not a contest course.
		expect((await page.goto(`/contest/${course}`))!.status()).toBe(404);
	});

	test('SITE-18 simple_grader: asynchronous jobs, polling and request errors', async ({ request }) => {
		test.setTimeout(120_000);
		const grader = async (data: Record<string, string>) =>
			(await request.post('/external', { data: { api_key: 'e2e-grader-key', ...data }, timeout: 90_000 })).json();
		expect(await grader({ jobid: 'nope' })).toEqual({
			status: 'error',
			status_message: 'There is no job with jobid nope'
		});
		expect(await grader({ taskid: 'mcq1' })).toEqual({ status: 'error', status_message: 'Unknown request type' });
		expect(await grader({ taskid: 'ghost', input: '{}' })).toEqual({
			status: 'error',
			status_message: 'Cannot open task'
		});
		expect(await grader({ taskid: 'mcq1', input: 'null' })).toEqual({
			status: 'error',
			status_message: 'Input is not consistent with the task'
		});
		const started = await grader({ taskid: 'mcq1', input: JSON.stringify({ q1: ['0'], q2: 'yes' }), async: '1' });
		expect(started).toMatchObject({ status: 'done', jobid: expect.any(String) });
		let polled: Record<string, unknown> = { status: 'waiting' };
		const seen = new Set<unknown>();
		await expect
			.poll(
				async () => {
					polled = await grader({ jobid: started.jobid });
					seen.add(polled.status);
					return polled.status;
				},
				{ timeout: 90_000, intervals: [100] }
			)
			.toBe('done');
		expect(polled).toHaveProperty('result');
		// A finished job is returned once.
		expect((await grader({ jobid: started.jobid })).status).toBe('error');
	});

	test('SITE-01 SITE-03 SITE-04 SITE-05 user administration: pagination, failures and forged forms', async ({
		page,
		loginAs,
		baseURL
	}) => {
		await withDb(async (db) => {
			await db.collection('users').deleteMany({ username: /^covadm_/ });
			await db.collection('users').insertMany(
				Array.from({ length: 30 }, (_, i) => ({
					username: `covadm_${String(i).padStart(2, '0')}`,
					realname: i === 0 ? '' : `Cov ${i}`,
					email: `covadm_${i}@site.org`,
					language: 'en',
					bindings: i === 1 ? { github: ['gh-1', {}], weird: [] } : {}
				}))
			);
		});
		// An account document without the optional fields.
		await withDb((db) => db.collection('users').insertOne({ username: 'covadm_bare' }));
		await loginAs('superadmin');
		await page.goto('/administrator/users?q=covadm_bare&page=abc');
		await page.goto('/administrator/users?q=covadm_&page=1');
		await page.getByRole('link', { name: 'Next' }).click();
		await expect(page).toHaveURL(/page=2/);
		await page.getByRole('link', { name: 'Previous' }).click();
		await expect(page).toHaveURL(/page=1/);
		await expect(page.locator('tbody tr').first()).toContainText('covadm_00');
		const post = (name: string, form: Record<string, string>) =>
			action(page.request, `/administrator/users?/${name}`, form, baseURL!);
		expect(await actionResult(await post('delete', { username: 'covadm_missing' }))).toEqual({
			status: 404,
			message: 'Impossible to delete this user'
		});
		expect(await actionResult(await post('activate', { username: 'covadm_missing' }))).toEqual({
			status: 404,
			message: 'User not found'
		});
		for (const username of ['covadm_01', 'covadm_bare'])
			expect((await actionResult(await post('revoke', { username, binding_id: 'nope' }))).message).toBe(
				'Incorrect authentication binding.'
			);
		// Invalid accounts: empty username (only external accounts may have none), invalid address.
		for (const [form, message] of [
			[{ username: '', realname: 'X', email: 'x@site.org', password: 'abcdefgh' }, 'Invalid username format.'],
			[{ username: 'covadm_bad', realname: 'X', email: 'nope', password: 'abcdefgh' }, 'Invalid email format.']
		] as const)
			expect((await actionResult(await post('add', form))).message).toBe(message);
		// Course creation without id.
		expect((await actionResult(await action(page.request, '/mycourses?/create', {}, baseURL!))).status).toBe(400);
		// A forged confirmation (empty username) is an invalid form: the error is shown as a toast.
		await page.goto('/administrator/users?q=covadm_01');
		await page.getByRole('button', { name: 'Revoke access' }).first().click();
		const dialog = page.getByRole('alertdialog');
		await dialog.locator('input[name="username"]').evaluate((i: HTMLInputElement) => (i.value = ''));
		await dialog.getByRole('button', { name: 'Confirm' }).click();
		await expect(page.getByText('Invalid form data.')).toBeVisible();
		// Last document: the list, client-side pagination and an open confirmation.
		await page.goto('/administrator/users?q=covadm_&page=2');
		await page.getByRole('link', { name: 'Previous' }).click();
		await expect(page).toHaveURL(/page=1/);
		await page.getByRole('button', { name: 'Revoke access' }).first().click();
		await expect(page.getByRole('alertdialog')).toBeVisible();
		await page.keyboard.press('Escape');
	});

	test('SITE-19 git_repo stores the files of the grader archive', async ({ page, loginAs }) => {
		test.setTimeout(120_000);
		await loginAs('e2e_student2');
		const url = `/api/v0/courses/${course}/tasks/archive/submissions`;
		const thecode =
			'#!/bin/bash\nmkdir -p /archive/sub\necho hi > /archive/generated.txt\necho x > /archive/sub/f.txt\n';
		const { submissionid } = await (await page.request.post(url, { data: { thecode } })).json();
		await expect
			.poll(async () => (await (await page.request.get(`${url}/${submissionid}`)).json())[0].status, {
				timeout: 90_000
			})
			.toBe('done');
		const files = (dir: string): string[] =>
			(existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []).flatMap((e) =>
				e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]
			);
		await expect
			.poll(() => files(`e2e/.generated/git-repo/${course}/archive`).some((f) => f.endsWith('generated.txt')), {
				timeout: 30_000
			})
			.toBe(true);
	});

	test('NAV-10 NAV-15 course page category filter, deadlines in hours and upcoming tasks', async ({
		page,
		loginAs
	}) => {
		// file1 closes in a few hours: shown in the 7-day planner, with a deadline in hours.
		const soon = (h: number) => new Date(Date.now() + h * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
		editCourse(course, (c) => {
			const config = (c.dispenser_data as { config: Record<string, unknown> }).config;
			config.file1 = { accessibility: `${soon(-24)} / ${soon(10)}` };
		});
		await withDb(async (db) => {
			await db.collection('user_tasks').deleteMany({ courseid: course, username: 'e2e_student3' });
			await db.collection('user_tasks').insertMany(
				['code1', 'code2', 'mcq1', 'archive'].map((taskid) => ({
					courseid: course,
					taskid,
					username: 'e2e_student3',
					succeeded: true,
					grade: 100,
					tried: 1,
					state: '',
					submissionid: null
				}))
			);
		});
		// Upcoming tasks of a student who succeeded none (several deadlines to sort).
		await loginAs('e2e_student1');
		for (const planner of ['7', 'nope'])
			expect(await (await page.request.get(`/coming_tasks?time_planner=${planner}`)).text()).toContain('File task');
		await page.context().clearCookies();
		await loginAs('e2e_student3');
		await page.request.get('/coming_tasks');
		await page.goto(`/course/${course}`);
		await page.getByRole('button', { name: /cov_cat|Cat/ }).click();
		await expect(page.getByText('Others')).toHaveCount(0);
		await expect(page.getByText('2 / 2')).toBeVisible();
	});

	test('NAV-11 the group page of a course without groups explains it', async ({ page, loginAs, baseURL }) => {
		// A group reserved to an audience the student is not part of (and without members list).
		await withDb(async (db) => {
			await db.collection('groups').deleteMany({ courseid: contest });
			await db
				.collection('groups')
				.insertOne({ courseid: contest, description: 'Reserved', size: 2, audiences: [new ObjectId()] });
		});
		await loginAs('e2e_student1');
		expect((await actionResult(await action(page.request, `/group/${contest}?/leave`, {}, baseURL!))).message).toBe(
			"You're not registered in a group."
		);
		await page.goto(`/group/${contest}`);
		await expect(page.getByText(/Groups have been set up but you're not allowed/)).toBeVisible();
		// Open groups: one without member list, one with a member without account.
		await withDb((db) =>
			db.collection('groups').insertMany([
				{ courseid: contest, description: 'Open', size: 2 },
				{ courseid: contest, description: 'Ghost', size: 3, students: ['cov_ghost_member'], audiences: [] }
			])
		);
		await page.goto(`/group/${contest}`);
		await expect(page.getByText('Ghost').first()).toBeVisible();
	});

	test('NAV-02 NAV-03 course lists show an empty state when the search matches nothing', async ({ page, loginAs }) => {
		await loginAs('e2e_student1');
		await page.goto('/mycourses');
		await page.getByRole('searchbox').first().fill('zzz-no-such-course');
		await expect(page.getByText('No course found.')).toBeVisible();
	});

	test('NAV-04 the public course list shows an empty state when the search matches nothing', async ({ page }) => {
		await page.goto('/courselist');
		await page.getByRole('searchbox').first().fill('zzz-no-such-course');
		await expect(page.getByText('No course found.')).toBeVisible();
	});

	test('NAV-06 the registration page of a password-protected course asks for it', async ({ page, loginAs }) => {
		const pwd = installCourse('nav_pwd', 'e2e_cov_site_pwd');
		await loginAs('e2e_student3');
		await page.goto(`/register/${pwd}`);
		await expect(page.getByLabel('Password')).toBeVisible();
	});
});

/** Directory of the generated data of the extra server (git repositories, glauth configuration). */
const GENERATED = resolve(`e2e/.generated/cov-site-${E2E_ID}`);
/** Name of the glauth container of this run. */
const LDAP_CONTAINER = `inginious-e2e-ldap-${E2E_ID}`;

/** Marketplace courses served by the fake marketplace. */
const MARKET = [
	{ id: 'good', link: 'https://market.invalid/good.git', name: { en: 'Good course', fr: 'Bon cours' } },
	{ id: 'noyaml', link: 'https://market.invalid/noyaml.git', name: { fr: 'Sans yaml' }, default_language: 'fr' },
	{ id: 'empty', link: 'https://market.invalid/empty.git', name: { de: 'Leer' } },
	{ id: 'plain', link: 'http://market.invalid/plain.git', name: {} },
	{ id: 'broken', link: 'https://broken.invalid/broken.git', name: { en: 'Broken' } }
].map((c) => ({
	languages: 'en',
	license: 'MIT',
	maintainers: 'COV',
	authors: '',
	default_language: 'en',
	short_desc: { en: `Short ${c.id}` },
	description: c.id === 'good' ? { en: '**Rich** description' } : {},
	...c
}));

/** Creates a git repository `<GENERATED>/market/<name>` with `files`. */
function gitRepo(name: string, files: Record<string, string>) {
	const dir = `${GENERATED}/market/${name}`;
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(`${dir}/task1`, { recursive: true });
	for (const [path, content] of Object.entries({ 'task1/task.yaml': 'name: T\n', ...files }))
		writeFileSync(`${dir}/${path}`, content);
	const git = (...args: string[]) =>
		execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, stdio: 'ignore' });
	git('init', '-q');
	git('add', '-A');
	git('commit', '-q', '-m', 'init');
}

/** Profile answered by the fake OAuth providers for an access token (= the authorization code). */
function oauthProfile(host: string, path: string, token: string): [number, unknown] {
	const email = `${token}@oauth.local`;
	if (token.includes('fail')) return [500, {}];
	if (host === 'api.github.com' && path === '/user')
		return [200, { id: token, name: token.includes('noname') ? null : 'Git Hub', login: `login-${token}` }];
	if (host === 'api.github.com') return [200, [{ email, primary: true, verified: !token.includes('unverified') }]];
	const verified = !token.includes('unverified');
	const hd = token.includes('wronghd') ? 'other.org' : 'uclouvain.be';
	const name = token.includes('emptyname') ? ' ' : 'O Auth';
	const address = token.includes('bademail') ? 'not-an-email' : email;
	return [200, { sub: `sub-${token}`, id: `id-${token}`, name, email: address, email_verified: verified, hd }];
}

test.describe('extra server: marketplace, OAuth, LDAP, SAML, reverse proxy', () => {
	let app: App;
	let fake: Server;
	let marketBroken = false;
	let ldapPort = 0;
	const imported: string[] = [];
	test.describe.configure({ mode: 'serial' });
	test.use({ baseURL: appUrl(5) });

	test.beforeAll(async () => {
		test.setTimeout(120_000);
		mkdirSync(GENERATED, { recursive: true });
		gitRepo('good.git', {
			'course.yaml':
				'name: Good\ndescription: From git\ntags: { t: { name: T } }\ntoc: [{ id: s, title: S, tasks_list: [task1] }]\n'
		});
		gitRepo('noyaml.git', {});
		gitRepo('empty.git', { 'course.yaml': '' });
		// Static pages without title or content.
		mkdirSync(`${GENERATED}/static`, { recursive: true });
		writeFileSync(`${GENERATED}/static/covempty.yaml`, '');
		writeFileSync(`${GENERATED}/static/covtitle.yaml`, 'title: Only a title\n');
		// Fake marketplace and OAuth providers (requests of the app are redirected here, see fetch-redirect.mjs).
		fake = createServer((req, res) => {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				const url = new URL(req.url!, 'http://fake');
				const json = (status: number, value: unknown) =>
					res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
				if (url.pathname === '/market.json') return marketBroken ? res.end('not json') : json(200, MARKET);
				const [, host, ...rest] = url.pathname.split('/');
				const path = `/${rest.join('/')}`;
				if (req.method === 'POST') {
					const code = new URLSearchParams(body).get('code') ?? '';
					return code.includes('badcode')
						? json(400, { error: 'invalid_grant' })
						: json(200, { access_token: code, token_type: 'Bearer', expires_in: 3600 });
				}
				const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
				return json(...oauthProfile(host, path, token));
			});
		});
		await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
		const fakeUrl = `http://127.0.0.1:${(fake.address() as import('node:net').AddressInfo).port}`;
		// LDAP directory: glauth container (users alice, nomail and a service account).
		const sha = (s: string) => createHash('sha256').update(s).digest('hex');
		const user = (name: string, gid: number, pw: string, mail = '') =>
			`[[users]]\n  name = "${name}"\n${mail ? `  mail = "${mail}"\n` : ''}  uidnumber = ${5000 + name.length}\n  primarygroup = ${gid}\n  passsha256 = "${sha(pw)}"\n`;
		mkdirSync(`${GENERATED}/ldap`, { recursive: true });
		writeFileSync(
			`${GENERATED}/ldap/config.cfg`,
			`[ldap]\n  enabled = true\n  listen = "0.0.0.0:3893"\n[ldaps]\n  enabled = false\n[backend]\n  datastore = "config"\n  baseDN = "dc=glauth,dc=com"\n[behaviors]\n  IgnoreCapabilities = true\n` +
				user('alice', 5501, 'alicepw', 'alice@ldap.local') +
				user('nomail', 5501, 'nomailpw') +
				user('svc', 5502, 'svcpass') +
				`[[groups]]\n  name = "students"\n  gidnumber = 5501\n[[groups]]\n  name = "svcaccts"\n  gidnumber = 5502\n`
		);
		execFileSync('docker', ['rm', '-f', LDAP_CONTAINER], { stdio: 'ignore' });
		execFileSync('docker', [
			'run',
			'-d',
			'--rm',
			'--name',
			LDAP_CONTAINER,
			'-p',
			'127.0.0.1::3893',
			'-v',
			`${GENERATED}/ldap:/app/config`,
			'glauth/glauth:v2.3.2'
		]);
		// The host port is chosen by docker.
		ldapPort = Number(execFileSync('docker', ['port', LDAP_CONTAINER, '3893'], { encoding: 'utf8' }).split(':').pop());
		const ldap = { plugin_module: 'inginious.frontend.plugins.auth.ldap_auth', base_dn: 'dc=glauth,dc=com' };
		const oauth = (provider: string, id = provider, extra = {}) => ({
			plugin_module: `inginious.frontend.plugins.auth.${provider}_auth`,
			id,
			client_id: 'cid',
			client_secret: 'secret',
			...extra
		});
		app = await startApp(
			5,
			{
				marketplace_url: `${fakeUrl}/market.json`,
				static_directory: `${GENERATED}/static`,
				// Full MongoDB URI; SMTP with credentials and the default sender.
				mongo_opt: { host: E2E.mongoUrl, database: E2E.database },
				smtp: { host: 'localhost', port: 1025, username: 'cov' },
				'reverse-proxy-config': { enable: true, 'x-for': 1 },
				plugins: [
					oauth('github'),
					oauth('google', 'google', { domain: 'uclouvain.be', imlink: '/logo.svg' }),
					oauth('google', 'google2'),
					oauth('facebook'),
					oauth('linkedin'),
					{
						...ldap,
						id: 'ldap',
						name: 'Campus LDAP',
						imlink: '/logo.svg',
						host: '127.0.0.1',
						port: ldapPort,
						bind_dn: 'cn={},ou=students,dc=glauth,dc=com',
						cn: 'cn',
						mail: 'mail'
					},
					// No port option (in the host), service account bind, default attribute names and name.
					{ ...ldap, id: 'ldapsvc', host: `127.0.0.1:${ldapPort}`, bind_dn: 'cn=svc,ou=svcaccts,dc=glauth,dc=com' },
					{ ...ldap, id: 'ldapanon', host: '127.0.0.1', port: ldapPort },
					// The configured name attribute does not exist.
					{
						...ldap,
						id: 'ldapcn',
						host: '127.0.0.1',
						port: ldapPort,
						bind_dn: 'cn={},ou=students,dc=glauth,dc=com',
						cn: 'displayname'
					},
					{ ...ldap, id: 'ldaptls', host: '127.0.0.1', port: ldapPort, encryption: 'tls' },
					{ ...ldap, id: 'ldapssl', host: '127.0.0.1', port: ldapPort, encryption: 'ssl' },
					{
						plugin_module: 'inginious.frontend.plugins.auth.saml2_auth',
						id: 'saml',
						sp: { entityId: 'inginious-cov' },
						idp: { singleSignOnService: { url: 'https://idp.example/sso' }, x509cert: idpCert },
						attributes: { uid: 'uid', cn: 'cn', email: 'mail' }
					},
					{ plugin_module: 'inginious.frontend.plugins.simple_grader' },
					// Default environment (not provided by the agents), run command and timeout.
					{ plugin_module: 'inginious.frontend.plugins.taskless-hello-world' },
					{ plugin_module: 'inginious.frontend.plugins.unknown_plugin' }
				]
			},
			{
				NODE_OPTIONS: `--import ${resolve('e2e/coverage/fetch-redirect.mjs')}`,
				E2E_FAKE_PROVIDER: fakeUrl,
				// git clones of https://market.invalid/<repo> use the local repositories.
				GIT_CONFIG_COUNT: '1',
				GIT_CONFIG_KEY_0: `url.file://${GENERATED}/market/.insteadOf`,
				GIT_CONFIG_VALUE_0: 'https://market.invalid/'
			}
		);
	});

	test.afterAll(async () => {
		await app?.stop();
		await new Promise((r) => fake?.close(r));
		execFileSync('docker', ['rm', '-f', LDAP_CONTAINER], { stdio: 'ignore' });
		for (const id of imported) removeCourse(id);
	});

	/** Logs `username` in on the extra server. */
	const login = async (page: Page, username: string) =>
		page
			.context()
			.addCookies([{ name: 'inginious_session_id', value: await createSessionCookie(username), url: appUrl(5) }]);

	test('NAV-18 NAV-19 the marketplace lists, describes and imports courses from git', async ({ page }) => {
		test.setTimeout(120_000);
		await login(page, 'superadmin');
		await page.goto('/marketplace');
		for (const name of ['Good course', 'Sans yaml', 'Leer', 'plain'])
			await expect(page.getByText(name).first()).toBeVisible();
		// Details: rendered description, information and only https links.
		await page.goto('/marketplace/good');
		await expect(page.locator('strong', { hasText: 'Rich' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'https://market.invalid/good.git' })).toBeVisible();
		await page.goto('/marketplace/plain');
		await expect(page.getByText('http://market.invalid/plain.git')).toHaveCount(0);
		expect((await page.goto('/marketplace/nope'))!.status()).toBe(404);
		// Import from the list (then course administration) and from the details page (then the course).
		const id = (name: string) => {
			const courseid = `covmk_${name}_${uid()}`;
			imported.push(courseid);
			return courseid;
		};
		const good = id('good');
		await page.goto('/marketplace');
		const card = page.locator('form').filter({ has: page.locator('input[value="good"]') });
		await card.getByRole('textbox').fill(good);
		await card.getByRole('button', { name: 'Import course' }).click();
		await expect(page).toHaveURL(new RegExp(`/admin/${good}`));
		const noyaml = id('noyaml');
		await page.goto('/marketplace/noyaml');
		await page.getByRole('textbox', { name: 'New course id' }).fill(noyaml);
		await page.getByRole('button', { name: 'Import course' }).click();
		await expect(page).toHaveURL(new RegExp(`/course/${noyaml}`));
		const post = (path: string, form: Record<string, string>) => action(page.request, path, form, appUrl(5));
		expect(
			(await actionResult(await post('/marketplace', { courseid: 'empty', new_courseid: id('empty') }))).status
		).toBe(303);
		for (const [form, message] of [
			[{ courseid: 'good', new_courseid: good }, `Course with id ${good} already exists.`],
			[{ courseid: 'plain', new_courseid: id('plain') }, "Couldn't clone course into your instance"],
			[{ courseid: 'broken', new_courseid: id('broken') }, "Couldn't clone course into your instance"],
			[{ courseid: 'nope', new_courseid: id('nope') }, 'User returned an invalid form.'],
			[{ courseid: 'good' }, 'Course with invalid name: '],
			[{}, 'Course with invalid name: ']
		] as const)
			expect((await actionResult(await post('/marketplace', form))).message).toBe(message);
		// An unreachable or invalid marketplace gives an empty list.
		marketBroken = true;
		await page.goto('/marketplace');
		await expect(page.getByText('No public courses available')).toBeVisible();
		marketBroken = false;
	});

	/** OAuth flow up to the callback: returns the callback response (303 with the flash cookie). */
	async function oauthFlow(page: Page, id: string, code: string | null, forgedState = false) {
		await page.goto('/signin');
		const start = await page.request.post(`/auth/signin/${id}`, {
			form: { redirect: '/preferences/bindings' },
			maxRedirects: 0,
			headers: { origin: appUrl(5) }
		});
		const state = new URL(start.headers().location).searchParams.get('state')!;
		const query = new URLSearchParams({ state: forgedState ? 'forged' : state, ...(code ? { code } : {}) });
		return page.request.get(`/auth/callback/${id}?${query}`, { maxRedirects: 0 });
	}

	test('AUTH-14 AUTH-15 OAuth providers end-to-end against a fake provider', async ({ page }) => {
		test.setTimeout(180_000);
		const run = uid();
		await page.goto('/signin');
		await expect(page.getByRole('button', { name: 'Sign in with Google' }).first()).toBeVisible();
		// The Google authorization URL carries the domain restriction.
		const google = await page.request.post('/auth/signin/google', {
			form: { redirect: '/' },
			maxRedirects: 0,
			headers: { origin: appUrl(5) }
		});
		expect(new URL(google.headers().location).searchParams.get('hd')).toBe('uclouvain.be');
		// Successful sign-ins create bound accounts (then the profile asks for a username).
		for (const [id, code] of [
			['github', `gh-ok-${run}`],
			['github', `gh-noname-${run}`],
			['google', `g-ok-${run}`],
			['google2', `g2-wronghd-${run}`],
			['facebook', `fb-${run}`],
			['linkedin', `li-${run}`]
		]) {
			await page.context().clearCookies();
			const res = await oauthFlow(page, id, code);
			expect(res.status(), `${id} ${code}`).toBe(303);
			expect(
				await withDb((db) => db.collection('users').findOne({ email: `${code}@oauth.local` })),
				code
			).toMatchObject({
				bindings: { [id]: expect.any(Array) }
			});
		}
		// Refused identities: unverified e-mails, other Google domain, provider errors, bad codes, forged states.
		for (const [id, code, forged] of [
			['github', `gh-unverified-${run}`, false],
			['github', `gh-fail-${run}`, false],
			['google', `g-unverified-${run}`, false],
			['google', `g-wronghd-${run}`, false],
			['google', `g-badcode-${run}`, false],
			['github', null, false],
			['github', `gh-ok2-${run}`, true],
			['google2', `g-emptyname-${run}`, false],
			['google2', `g-bademail-${run}`, false]
		] as const) {
			await page.context().clearCookies();
			const res = await oauthFlow(page, id, code, forged);
			expect(res.headers().location, `${id} ${code}`).toBe('/signin');
		}
		// A callback without a started flow.
		await page.context().clearCookies();
		expect(
			(await page.request.get('/auth/callback/github?code=x&state=y', { maxRedirects: 0 })).headers().location
		).toBe('/signin');
		// Logged-in users bind (then refresh) an identity; an identity bound to another account is not moved.
		const cookie = async (username: string) =>
			page
				.context()
				.addCookies([{ name: 'inginious_session_id', value: await createSessionCookie(username), url: appUrl(5) }]);
		await page.context().clearCookies();
		await cookie('e2e_student1');
		for (let i = 0; i < 2; i++)
			expect((await oauthFlow(page, 'linkedin', `li-bind-${run}`)).headers().location).toBe('/preferences/bindings');
		expect(
			(await withDb((db) => db.collection('users').findOne({ username: 'e2e_student1' })))!.bindings.linkedin
		).toEqual([`sub-li-bind-${run}`, {}]);
		await page.context().clearCookies();
		await cookie('e2e_student2');
		expect((await oauthFlow(page, 'linkedin', `li-bind-${run}`)).headers().location).toBe('/preferences/bindings');
		await withDb((db) =>
			db.collection('users').updateOne({ username: 'e2e_student1' }, { $unset: { 'bindings.linkedin': '' } })
		);
		// A logged-in session whose account disappeared.
		const ghost = await createUser();
		await page.context().clearCookies();
		await page.context().addCookies([await sessionCookie(ghost, appUrl(5))]);
		await withDb((db) => db.collection('users').deleteOne({ username: ghost.username }));
		expect((await oauthFlow(page, 'facebook', `fb-ghost-${run}`)).headers().location).toBe('/preferences/bindings');
		// An account created by a provider (no username yet) deletes itself.
		await page.context().clearCookies();
		await oauthFlow(page, 'facebook', `fb-del-${run}`);
		const del = await page.request.post('/preferences/delete', {
			form: { delete_email: `fb-del-${run}@oauth.local` },
			headers: { origin: appUrl(5), accept: 'application/json', 'x-sveltekit-action': 'true' }
		});
		expect(del.status()).toBeLessThan(500);
		expect(await withDb((db) => db.collection('users').findOne({ email: `fb-del-${run}@oauth.local` }))).toBeNull();
	});

	test('AUTH-16 LDAP sign-in against a directory: success, wrong passwords, missing fields, throttling', async ({
		page
	}) => {
		test.setTimeout(120_000);
		await withDb((db) => db.collection('users').deleteMany({ 'bindings.ldap.0': 'alice' }));
		await page.goto('/auth/page/ldap');
		await page.getByLabel('Username').fill('Alice');
		await page.getByLabel('Password').fill('alicepw');
		await page.getByRole('button', { name: /Sign in/ }).click();
		await expect(page).not.toHaveURL(/\/auth\/page\/ldap/);
		expect(await withDb((db) => db.collection('users').findOne({ 'bindings.ldap.0': 'alice' }))).toMatchObject({
			email: 'alice@ldap.local'
		});
		const attempt = async (id: string, login: string, password: string, ip = '10.0.0.1') => {
			const res = await page.request.post(`/auth/page/${id}`, {
				form: { login, password },
				headers: { origin: appUrl(5), accept: 'application/json', 'x-sveltekit-action': 'true', 'x-forwarded-for': ip }
			});
			return actionResult(res);
		};
		await page.context().clearCookies();
		for (const [id, login, password, message] of [
			['ldap', 'alice', 'wrong', 'Cannot contact host'],
			['ldap', 'nomail', 'nomailpw', "Can't get field mail from your LDAP server"],
			['ldap', 'alice', ' ', 'Empty password'],
			['ldapsvc', 'ghost', 'svcpass', 'Unknown user'],
			['ldapsvc', 'alice', 'svcpass', 'Incorrect password'],
			['ldapanon', 'alice', 'alicepw', 'Cannot contact host'],
			['ldapcn', 'alice', 'alicepw', "Can't get field displayname from your LDAP server"],
			['ldaptls', 'alice', 'alicepw', 'Cannot contact host'],
			['ldapssl', 'alice', 'alicepw', 'Cannot contact host']
		])
			expect((await attempt(id, login, password)).message, id).toBe(`Authentication failed: ${message}`);
		// Too many failures on one login (from varying addresses).
		for (let i = 0; i < 20; i++) await attempt('ldapsvc', 'victim', 'svcpass', `10.1.0.${i}`);
		expect(await attempt('ldapsvc', 'victim', 'svcpass', '10.2.0.1')).toEqual({
			status: 429,
			message: 'Too many requests, please retry later.'
		});
		// Methods without a form have no form page.
		expect((await page.goto('/auth/page/github'))!.status()).toBe(404);
	});

	test('AUTH-17 SAML with default name and multi-valued attributes', async ({ page }) => {
		const id = `samlcov_${uid()}`;
		await page.goto('/signin');
		await expect(page.getByRole('button', { name: 'Sign in with SAML' })).toBeVisible();
		const start = await page.request.post('/auth/signin/saml', {
			form: { redirect: '/' },
			maxRedirects: 0,
			headers: { origin: appUrl(5) }
		});
		const relay = new URL(start.headers().location).searchParams.get('RelayState')!;
		const response = samlResponse(`${appUrl(5)}/auth/callback/saml`, 'inginious-cov', {
			uid: [id, 'second'],
			cn: 'Multi Valued',
			mail: `${id}@saml.local`
		});
		await page.request.post('/auth/callback/saml', {
			form: { SAMLResponse: response, RelayState: relay, alreadyRedirected: '1' },
			maxRedirects: 0
		});
		expect(await withDb((db) => db.collection('users').findOne({ email: `${id}@saml.local` }))).toMatchObject({
			bindings: { saml: [id, {}] }
		});
	});

	test('AUTH-12 the bindings page lists configured and removed methods with their fields', async ({ page }) => {
		const user = await createUser({
			bindings: { github: [`gh-${uid()}`, { studentid: '42' }], removed_method: ['x', null] }
		});
		await page.context().addCookies([await sessionCookie(user, appUrl(5))]);
		await page.goto('/preferences/bindings');
		await expect(page.getByText('github.studentid')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'removed_method' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Refresh fields' })).toHaveCount(1);
		// A forged revoke form (no binding field): the action error is shown as a toast.
		const revoke = page.getByRole('button', { name: 'Revoke access' }).first();
		await revoke.evaluate((b) => b.removeAttribute('name'));
		await revoke.click();
		await expect(page.getByText('Invalid form data.').first()).toBeVisible();
	});

	/** Posts a registration page action from the client address `ip` (rate limits are per client). */
	const registerAction = async (page: Page, name: string, form: Record<string, string>, ip: string) =>
		actionResult(
			await page.request.post(`/register?/${name}`, {
				form,
				headers: { origin: appUrl(5), accept: 'application/json', 'x-sveltekit-action': 'true', 'x-forwarded-for': ip }
			})
		);

	test('AUTH-08 lost password: invalid addresses, rate limit, invalid and valid reset links', async ({ page }) => {
		expect((await registerAction(page, 'lostpasswd', { recovery_email: 'bad' }, '10.5.0.1')).message).toBe(
			'Invalid email format.'
		);
		for (let i = 0; i < 10; i++) await registerAction(page, 'lostpasswd', { recovery_email: 'no@x.org' }, '10.6.0.1');
		expect((await registerAction(page, 'lostpasswd', { recovery_email: 'no@x.org' }, '10.6.0.1')).message).toBe(
			'Too many requests, please retry later.'
		);
		expect(
			(await registerAction(page, 'resetpasswd', { reset: 'nope', passwd: 'abcdefg', passwd2: 'abcdefg' }, '10.5.0.2'))
				.message
		).toBe('Invalid reset hash.');
		const user = await createUser();
		await registerAction(page, 'lostpasswd', { recovery_email: user.email }, '10.7.0.1');
		const { reset } = (await withDb((db) => db.collection('users').findOne({ username: user.username })))!;
		await page.goto(`/register?reset=${reset}`);
		await page.getByLabel(/^Password/).fill('abc');
		await expect(page.getByText('Too short')).toBeVisible();
		await page.getByLabel(/^Password/).fill('Abcdefgh12!x');
		await page.getByLabel(/Confirm password/).fill('Abcdefgh12!x');
		await page.getByRole('button', { name: 'Set new password' }).click();
		await expect(page).toHaveURL(/\/signin/);
	});

	test('AUTH-07 an account is activated from its activation link', async ({ page }) => {
		const name = `covreg${uid()}`;
		const result = await registerAction(
			page,
			'register',
			{ username: name, realname: 'Reg', email: `${name}@inginious.local`, passwd: 'abcdefgh', passwd2: 'abcdefgh' },
			'10.8.0.1'
		);
		expect(result.status).toBe(200);
		const { activate } = (await withDb((db) => db.collection('users').findOne({ username: name })))!;
		// Registrations (and their mails) are limited per client.
		const many = `covmany${uid()}`;
		let last = '';
		for (let i = 0; i < 11; i++) {
			const u = `${many}${i}`;
			last = (
				await registerAction(
					page,
					'register',
					{ username: u, realname: 'M', email: `${u}@inginious.local`, passwd: 'abcdefgh', passwd2: 'abcdefgh' },
					'10.11.0.1'
				)
			).message!;
		}
		expect(last).toBe('Too many requests, please retry later.');
		await page.goto(`/register?activate=${activate}`);
		await page.getByRole('button', { name: 'Activate my account' }).click();
		await expect(page).toHaveURL(/\/signin/);
	});

	test('AUTH-14 AUTH-17 LTI-02 form methods through the callback, SAML repost, disabled plugins, proxied LTI', async ({
		page,
		request
	}) => {
		// A form method reached through the callback URL (no form): the error is flashed.
		expect((await page.request.get('/auth/callback/ldap', { maxRedirects: 0 })).headers().location).toBe('/signin');
		const noFields = await page.request.post('/auth/page/ldap', {
			form: {},
			headers: { origin: appUrl(5), accept: 'application/json', 'x-sveltekit-action': 'true' }
		});
		expect((await actionResult(noFields)).message).toBe('Authentication failed: Empty password');
		// Static pages without title or content.
		for (const name of ['covempty', 'covtitle']) expect((await request.get(`/pages/${name}`)).status()).toBe(200);
		// A taskless job on an environment the agents do not provide.
		await page
			.context()
			.addCookies([{ name: 'inginious_session_id', value: await createSessionCookie('superadmin'), url: appUrl(5) }]);
		await page.goto('/taskless_hello_world');
		await page.getByLabel('Input your name').fill('Cov');
		await page.getByRole('button', { name: 'Run Job' }).click();
		await expect(page.getByRole('status')).toBeVisible({ timeout: 60_000 });
		// The scoreboard plugin is not enabled on this server.
		expect((await request.get('/scoreboard/e2e_cov_site')).status()).toBe(404);
		// LTI 1.1 launches signed for the public URL given by the reverse proxy headers.
		const lti = installCourse('cov_site_lti', 'e2e_cov_site_lti_proxy');
		try {
			const publicUrl = `https://proxy.example/lti/${lti}/mcq1`;
			const proxied = await request.post(`/lti/${lti}/mcq1`, {
				form: launch11(publicUrl, 'ltikey', 'ltisecret'),
				headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'proxy.example' },
				maxRedirects: 0
			});
			expect(proxied.status()).toBe(302);
			// Without protocol header, adapter-node assumes https (and so does the signature check).
			const local = `${appUrl(5)}/lti/${lti}/mcq1`;
			const direct = await request.post(local, {
				form: launch11(local.replace('http:', 'https:'), 'ltikey', 'ltisecret'),
				headers: { 'x-forwarded-proto': '' },
				maxRedirects: 0
			});
			expect(direct.status()).toBe(302);
		} finally {
			removeCourse(lti);
		}
		// The SAML response is re-posted by the page itself with the session cookie and
		// `alreadyRedirected` (empty fields here): two posts to the callback.
		const posts: string[] = [];
		page.on('request', (r) => {
			if (r.method() === 'POST' && r.url().endsWith('/auth/callback/saml')) posts.push(r.postData() ?? '');
		});
		await page.goto('/signin');
		await page.evaluate(() => {
			const form = Object.assign(document.createElement('form'), { method: 'POST', action: '/auth/callback/saml' });
			document.body.append(form);
			form.submit();
		});
		await expect.poll(() => posts.length).toBe(2);
		expect(posts[1]).toContain('alreadyRedirected=yes');
	});

	test('SITE-18 SITE-22 disabled simple_grader and throttled WebDAV behind a reverse proxy', async ({ request }) => {
		expect((await request.get('/external')).status()).toBe(404);
		const course = installCourse('cov_site', 'e2e_cov_site_proxy');
		await withDb((db) =>
			db.collection('users').updateOne({ username: 'e2e_admin' }, { $set: { apikey: 'k'.repeat(80) } })
		);
		const dav = (ip: string, key = 'wrong') =>
			request.fetch(`/dav/${course}/`, {
				method: 'PROPFIND',
				headers: { ...basic('e2e_admin', key), 'x-forwarded-for': ip }
			});
		for (let i = 0; i < 20; i++) expect((await dav(`10.3.0.${i}`)).status()).toBe(401);
		// The account is now blocked, even with the right key.
		expect((await dav('10.4.0.1', 'k'.repeat(80))).status()).toBe(401);
		removeCourse(course);
	});
});

test.describe('LTI error branches', () => {
	const C = 'e2e_cov_site_lti';
	const C2 = 'e2e_cov_site_lti2';
	const ISS = 'https://cov.example';
	const SINGLE = 'https://cov-single.example';
	const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/';
	const DL = 'https://purl.imsglobal.org/spec/lti-dl/claim/';
	const AGS = 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint';
	const SCOPE = 'https://purl.imsglobal.org/spec/lti-ags/scope/score';
	let mock: MockLms;
	test.describe.configure({ mode: 'serial' });

	/** Rewrites the course.yaml of an installed course (YAML 1.1 like the app: the JWK key `n` must be quoted). */
	const setCourse = (courseid: string, fields: Record<string, unknown>) => {
		const file = resolve(E2E.tasksDir, `${courseid}/course.yaml`);
		writeFileSync(file, stringify({ ...parse(readFileSync(file, 'utf8')), ...fields }, { version: '1.1' }));
	};

	test.beforeAll(async () => {
		mock = await startMockLms();
		installCourse('cov_site_lti', C);
		installCourse('cov_site_lti', C2);
		const jwk = {
			...(await exportJWK(createPublicKey(mock.platform.privateKey))),
			kid: 'platform-kid-1',
			alg: 'RS256'
		};
		const client = (id: string, extra: Record<string, unknown> = {}) => ({
			client_id: id,
			auth_login_url: `${mock.url}/auth`,
			auth_token_url: `${mock.url}/token`,
			key_set_url: `${mock.url}/jwks`,
			deployment_ids: ['dep-1'],
			private_key: mock.tool.privatePem,
			...extra
		});
		setCourse(C, {
			admins: ['e2e_admin'],
			lti_keys: { covkey: 'covsecret' },
			lti_secrets: {},
			lti_config: {
				[ISS]: [
					client('cov-1', { default: true, public_key: mock.tool.publicPem }),
					// Inline key set, token endpoint failing, public key derived from the private one.
					client('cov-2', { key_set_url: undefined, key_set: { keys: [jwk] }, auth_token_url: `${mock.url}/nope` })
				],
				[SINGLE]: client('cov-s')
			}
		});
		// Second LTI course administered by e2e_admin, without registration (deep linking to it fails),
		// with a task that cannot be loaded (left out of the picker).
		mkdirSync(resolve(E2E.tasksDir, `${C2}/broken`), { recursive: true });
		writeFileSync(resolve(E2E.tasksDir, `${C2}/broken/task.yaml`), 'name: Broken\nproblems:\n  w:\n    type: nope\n');
		setCourse(C2, {
			admins: ['e2e_admin'],
			lti_keys: { covkey2: 's' },
			lti_config: {},
			lti_secrets: {},
			dispenser_data: {
				toc: [{ id: 's', title: 'S', tasks_list: { mcq1: 0, broken: 1 } }],
				config: { mcq1: { accessibility: true }, broken: { accessibility: true } }
			}
		});
		await withDb(async (db) => {
			await db.collection('users').updateMany({}, { $unset: { [`ltibindings.${C}/covkey`]: '' } });
			await db
				.collection('users')
				.updateOne(
					{ username: 'e2e_admin' },
					{ $set: { [`ltibindings.${ISS.replace(/\./g, '')}/cov-1/dep-1`]: 'cov-admin' } }
				);
			await db
				.collection('users')
				.updateOne(
					{ username: 'e2e_student1' },
					{ $set: { [`ltibindings.${ISS.replace(/\./g, '')}/cov-1/dep-1`]: 'cov-student' } }
				);
		});
	});
	test.afterAll(async () => {
		await mock.close();
		removeCourse(C);
		removeCourse(C2);
	});

	/** OIDC login step of a launch: returns the state (cookie set in the context) and nonce. */
	async function oidc(request: APIRequestContext, client = 'cov-1', courseid = C) {
		const q = new URLSearchParams({
			iss: ISS,
			login_hint: 'x',
			target_link_uri: 'http://tool/launch',
			client_id: client,
			lti1p3_new_window: '1'
		});
		const res = await request.get(`/lti1.3/oidc_login/${courseid}?${q}`, { maxRedirects: 0 });
		const location = new URL(res.headers().location);
		return { state: location.searchParams.get('state')!, nonce: location.searchParams.get('nonce')! };
	}

	/** Signed id_token of the mock platform (claims override the defaults). */
	const idToken = (nonce: string, claims: Record<string, unknown>, aud = 'cov-1') =>
		mock.idToken({
			iss: ISS,
			aud,
			sub: 'cov-student',
			nonce,
			[`${CLAIM}deployment_id`]: 'dep-1',
			[`${CLAIM}message_type`]: 'LtiResourceLinkRequest',
			[`${CLAIM}version`]: '1.3.0',
			...claims
		});

	/** Posts an id_token to a launch URL; returns the response (redirect to the LTI page on success). */
	const launch = (request: APIRequestContext, path: string, form: Record<string, string>) =>
		request.post(path, { form, maxRedirects: 0 });

	test('LTI-08 OIDC login refusals, cookie check page and registrations selection', async ({ request }) => {
		const login = (query: Record<string, string>, path = `/lti1.3/oidc_login/${C}`, headers = {}) =>
			request.get(`${path}?${new URLSearchParams(query)}`, { maxRedirects: 0, headers });
		expect((await login({ iss: ISS })).status()).toBe(400);
		expect((await login({ iss: 'https://nope', login_hint: 'x', target_link_uri: 'y' })).status()).toBe(400);
		expect((await login({ iss: ISS, login_hint: 'x', target_link_uri: 'y' }, '/lti1.3/oidc_login')).status()).toBe(400);
		// Cookie check page, for an https deployment (third-party cookie attributes).
		const page = await login({ iss: ISS, login_hint: 'x', target_link_uri: 'y' }, `/lti1.3/oidc_login/${C}`, {
			'x-forwarded-proto': 'https'
		});
		expect(await page.text()).toContain('SameSite=None; Secure; Partitioned');
		// Without client id: the default registration, or the only one of the platform.
		const def = await login({ iss: ISS, login_hint: 'x', target_link_uri: 'y', lti1p3_new_window: '1' });
		expect(new URL(def.headers().location).searchParams.get('client_id')).toBe('cov-1');
		const single = await login({ iss: SINGLE, login_hint: 'x', target_link_uri: 'y', lti1p3_new_window: '1' });
		expect(new URL(single.headers().location).searchParams.get('client_id')).toBe('cov-s');
		// The login may also be posted by the platform.
		const posted = await request.post(`/lti1.3/oidc_login/${C}`, {
			form: { iss: ISS, login_hint: 'x', target_link_uri: 'y', lti1p3_new_window: '1', lti_message_hint: 'h' },
			maxRedirects: 0,
			headers: { 'x-forwarded-proto': 'https' }
		});
		expect(new URL(posted.headers().location).searchParams.get('lti_message_hint')).toBe('h');
		// JWKS: public key derived from the private key; extra path segments.
		const hash = createHash('md5').update(`${ISS}cov-2`).digest('hex');
		expect((await (await request.get(`/lti1.3/jwks/${C}/${hash}`)).json()).keys).toHaveLength(1);
		expect((await request.get(`/lti1.3/jwks/a/${C}/${hash}`)).status()).toBe(404);
	});

	test('LTI-09 id_token launch refusals name the failed check', async ({ request }) => {
		const refused = async (form: Record<string, string>, check: string, path = `/lti1.3/launch/${C}/mcq1`) => {
			const res = await launch(request, path, form);
			expect(res.status(), check).toBe(403);
			expect(await res.text(), check).toContain(`Invalid LTI launch (${check}).`);
		};
		await refused({ id_token: 'x' }, 'state');
		let { state } = await oidc(request);
		await refused({ id_token: 'garbage', state }, 'id_token');
		let nonce: string;
		({ state, nonce } = await oidc(request));
		await refused({ id_token: await idToken(nonce, { iss: 'https://unknown' }), state }, 'issuer');
		({ state, nonce } = await oidc(request));
		await refused({ id_token: await idToken(nonce, {}), state }, 'issuer', '/lti1.3/launch');
		({ state, nonce } = await oidc(request));
		const forged = (await idToken(nonce, {})).split('.');
		await refused({ id_token: `${forged[0]}.${forged[1]}.${'A'.repeat(forged[2].length)}`, state }, 'signature');
		({ state } = await oidc(request));
		await refused({ id_token: await idToken('other-nonce', {}), state }, 'nonce');
		({ state, nonce } = await oidc(request));
		await refused({ id_token: await idToken(nonce, { [`${CLAIM}deployment_id`]: 'dep-9' }), state }, 'deployment');
		({ state, nonce } = await oidc(request));
		await refused({ id_token: await idToken(nonce, { [`${CLAIM}version`]: '1.1' }), state }, 'message');
		({ state, nonce } = await oidc(request));
		await refused(
			{ id_token: await idToken(nonce, { [`${CLAIM}message_type`]: 'LtiDeepLinkingRequest' }), state },
			'message',
			`/lti1.3/launch/${C}`
		);
		({ state, nonce } = await oidc(request));
		await refused({ id_token: await idToken(nonce, {}), state }, 'message', `/lti1.3/launch/${C}`);
	});

	test('LTI-08 LTI-09 launches without course in the URL, inline key sets and name fallbacks', async ({ page }) => {
		const go = async (claims: Record<string, unknown>, aud = 'cov-1', path = '/lti1.3/launch') => {
			const { state, nonce } = await oidc(page.request, aud);
			const res = await launch(page.request, path, { id_token: await idToken(nonce, claims, aud), state });
			expect(res.status(), await res.text()).toBe(302);
			return res.headers().location;
		};
		const custom = { [`${CLAIM}custom`]: { courseid: C, taskid: 'mcq1', secret: 'nope' } };
		// Course and task in the custom claim (wrong deployment secret: refused by the task page).
		const target = await go({ ...custom, given_name: 'Given', family_name: 'Family' });
		expect((await page.goto(target))!.status()).toBe(403);
		// Inline key set, e-mail only, no custom secret.
		await go({ [`${CLAIM}custom`]: { courseid: C, taskid: 'mcq1' }, email: 'e@x' }, 'cov-2');
		await go({ ...custom, family_name: 'OnlyFamily' }, 'cov-1', `/lti1.3/launch/${C}/mcq1`);
		await go({ ...custom, given_name: 'OnlyGiven' });
		const doc = await withDb((db) =>
			db.collection('sessions').findOne({ 'lti.realname': 'Given Family' }, { sort: { _id: -1 } })
		);
		expect(doc?.lti).toMatchObject({ context_title: 'N/A', tool_name: 'N/A', roles: [] });
	});

	test('LTI-10 deep linking: picker, secret creation, refusals', async ({ page, baseURL }) => {
		const deep = async (sub: string, settings: unknown = { deep_link_return_url: `${mock.url}/dlreturn` }) => {
			const { state, nonce } = await oidc(page.request);
			const claims = {
				sub,
				[`${CLAIM}message_type`]: 'LtiDeepLinkingRequest',
				[`${DL}deep_linking_settings`]: settings
			};
			const res = await launch(page.request, `/lti1.3/deeplaunch/${C}`, {
				id_token: await idToken(nonce, claims),
				state
			});
			return res.headers().location;
		};
		// Unbound LMS user: login step.
		expect(await deep('cov-unknown')).toMatch(/\/lti1\.3\/login\?session_id=/);
		const login = await deep('cov-unknown');
		expect((await page.request.get(login.replace('/login', '/deeplink'), { maxRedirects: 0 })).status()).toBe(302);
		// A bound student administers no LTI course.
		await page.goto(await deep('cov-student'));
		await expect(page.getByText('No LTI course available')).toBeVisible();
		// A resource launch session is not a deep linking launch.
		const { state, nonce } = await oidc(page.request);
		const custom = { [`${CLAIM}custom`]: { courseid: C, taskid: 'mcq1' }, sub: 'cov-admin' };
		const res = await launch(page.request, `/lti1.3/launch/${C}`, { id_token: await idToken(nonce, custom), state });
		// (the login step logs the bound user in and rotates the session token)
		const token = new URL((await page.request.get(res.headers().location)).url()).searchParams.get('session_id');
		expect((await page.request.get(`/lti1.3/deeplink?session_id=${token}`, { maxRedirects: 0 })).status()).toBe(403);
		// The bound admin picks a task: the deployment secret of the course is created. The signed answer is
		// auto-submitted to the platform (recorded instead, like in e2e/lti: the http mock cannot receive it).
		await page.addInitScript(() => {
			const submit = HTMLFormElement.prototype.submit;
			HTMLFormElement.prototype.submit = function () {
				if (this.action.endsWith('/dlreturn')) this.dataset.submitted = '1';
				else submit.call(this);
			};
		});
		await page.goto(await deep('cov-admin', { deep_link_return_url: `${mock.url}/dlreturn`, data: 'opaque' }));
		await expect(page).toHaveURL(/\/lti1\.3\/deeplink\?session_id=/);
		const url = page.url();
		const post = (form: Record<string, string>) =>
			page.request.post(url, {
				form,
				headers: { origin: baseURL!, accept: 'application/json', 'x-sveltekit-action': 'true' }
			});
		expect((await post({ courseid: 'nope', taskid: 'mcq1' })).status()).toBe(403);
		expect((await post({ courseid: C, taskid: 'nope' })).status()).toBe(404);
		expect((await post({ courseid: C2, taskid: 'mcq1' })).status()).toBe(400);
		expect((await post({ courseid: C, taskid: 'mcq1' })).status()).toBe(200);
		// A deep linking request without opaque data.
		const plain = await deep('cov-admin');
		const plainUrl = new URL((await page.request.get(plain)).url());
		const answer = await page.request.post(`${plainUrl.pathname}${plainUrl.search}`, {
			form: { courseid: C, taskid: 'mcq1' },
			headers: { origin: baseURL!, accept: 'application/json', 'x-sveltekit-action': 'true' }
		});
		expect(answer.status()).toBe(200);
		expect(Object.keys(parse(readFileSync(resolve(E2E.tasksDir, `${C}/course.yaml`), 'utf8')).lti_secrets)).toContain(
			`${ISS}/cov-1/dep-1`
		);
		// The picker: a course without loadable task besides mcq1, then the task of the main course.
		await page.getByLabel('Course').selectOption(C2);
		await page.getByLabel('Course').selectOption(C);
		await page.getByLabel('Task').selectOption('mcq2');
		await page.getByRole('button', { name: 'Select' }).click();
		await expect(page.locator(`form[action="${mock.url}/dlreturn"]`)).toHaveAttribute('data-submitted', '1');
		// The picker stays usable on the answer page (client-side selection).
		await page.getByLabel('Course').selectOption(C2);
		await page.getByLabel('Course').selectOption(C);
		await page.getByLabel('Task').selectOption('mcq1');
	});

	test('LTI-02 LTI-03 LTI-04 LTI 1.1 signature checks, missing fields and binding conflicts', async ({
		page,
		request,
		context,
		baseURL
	}) => {
		const url = `${baseURL}/lti/${C}/mcq1`;
		for (const field of ['oauth_timestamp', 'oauth_signature_method', 'oauth_nonce', 'oauth_consumer_key', 'sig']) {
			const form = launch11(url, 'covkey', 'covsecret', { [field]: undefined });
			if (field === 'sig') delete form.oauth_signature;
			expect((await request.post(url, { form, maxRedirects: 0 })).status(), field).toBe(403);
		}
		expect((await request.post(url, { form: launch11(url, 'nokey', 'covsecret'), maxRedirects: 0 })).status()).toBe(
			403
		);
		// Grades sent back: the outcome fields are required.
		expect(
			(
				await request.post(url, {
					form: launch11(url, 'covkey', 'covsecret', { lis_result_sourcedid: undefined }),
					maxRedirects: 0
				})
			).status()
		).toBe(403);
		// Repeated parameters are sorted by value; missing optional fields get defaults.
		const fields = launch11(url, 'covkey', 'covsecret', {
			oauth_version: undefined,
			roles: undefined,
			context_title: undefined,
			lis_person_contact_email_primary: undefined,
			user_id: 'cov-lms-1'
		});
		delete fields.oauth_signature;
		const pairs: [string, string][] = [
			...Object.entries(fields),
			['custom_x', '2'],
			['custom_x', '1'],
			['custom_x', '1']
		];
		const pct = (v: string) =>
			encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
		const sorted = pairs
			.map(([k, v]) => [pct(k), pct(v)])
			.sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
			.map(([k, v]) => `${k}=${v}`)
			.join('&');
		const signature = createHmac('sha1', 'covsecret&')
			.update(`POST&${pct(url)}&${pct(sorted)}`)
			.digest('base64');
		const body = new URLSearchParams([...pairs, ['oauth_signature', signature]]).toString();
		const res = await request.post(url, {
			data: body,
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			maxRedirects: 0
		});
		expect(res.status()).toBe(302);
		const doc = await withDb((db) => db.collection('sessions').findOne({ 'lti.username': 'cov-lms-1' }));
		expect(doc?.lti).toMatchObject({ context_title: 'N/A', email: '', roles: ['Student'] });
		// The task page of an unbound LMS user leads to the login step.
		const unbound = new URL(res.headers().location!, baseURL).searchParams.get('session_id');
		expect((await request.get(`/lti/task?session_id=${unbound}`, { maxRedirects: 0 })).headers().location).toMatch(
			/\/lti\/login\?session_id=/
		);
		// A course that stopped being an LTI course after the launch.
		await withDb((db) =>
			db
				.collection('users')
				.updateOne({ username: 'e2e_student3' }, { $set: { [`ltibindings.${C2}/covkey2`]: 'cov-s3b' } })
		);
		const url2 = `${baseURL}/lti/${C2}/mcq1`;
		// Grades are not sent back for this course: submissions carry no LTI tags.
		setCourse(C2, { lti_send_back_grade: false });
		const launched = await request.post(url2, {
			form: launch11(url2, 'covkey2', 's', { user_id: 'cov-s3b' }),
			maxRedirects: 0
		});
		const task = new URL(launched.headers().location!, baseURL);
		// (login step) then the best submission: none yet.
		const taskUrl = new URL((await request.get(`${task.pathname}${task.search}`)).url());
		const best = await request.get(`/lti/bestsubmission${taskUrl.search}`);
		expect(await best.json()).toEqual({ status: 'success', submission: null });
		const submitted = await request.post(`/lti/task${taskUrl.search}`, {
			multipart: { '@action': 'submit', q1: '0' },
			headers: { origin: baseURL! }
		});
		expect(submitted.status()).toBe(200);
		setCourse(C2, { is_lti: false });
		expect((await request.get(`${taskUrl.pathname}${taskUrl.search}`)).status()).toBe(403);
		setCourse(C2, { is_lti: true, lti_send_back_grade: true });
		// Binding: invalid tokens, then a conflict with an account bound to another LMS user.
		await context.addCookies([
			{ name: 'inginious_session_id', value: await createSessionCookie('e2e_student2'), url: baseURL! }
		]);
		const bad = await page.goto(`/lti/bind?lti_session_id=${new ObjectId()}.1.${'a'.repeat(43)}`);
		expect(bad!.status()).toBe(400);
		await expect(page.getByText('Error 400').first()).toBeVisible();
		expect((await page.request.get('/lti/bind')).status()).toBe(400);
		await page.goto(`${baseURL}${res.headers().location}`);
		await page.goto((await page.getByRole('link', { name: 'Bind your INGInious account' }).getAttribute('href'))!);
		const bindUrl = page.url();
		// Plain form submission (rendered by the server), then the enhanced button (same binding again).
		const html = { origin: baseURL!, accept: 'text/html' };
		expect(await (await page.request.post(bindUrl, { form: {}, headers: html })).text()).toContain('now bound');
		await page.getByRole('button', { name: 'Bind my account' }).click();
		await expect(page.getByText(/Your account is now bound/)).toBeVisible();
		// Another account is bound to this LMS user: refused.
		await withDb((db) =>
			db
				.collection('users')
				.updateOne({ username: 'e2e_student1' }, { $set: { [`ltibindings.${C}/covkey`]: 'cov-lms-1' } })
		);
		expect(await (await page.request.post(bindUrl, { form: {}, headers: html })).text()).toContain('already bound');
		const again = await page.request.post(bindUrl, {
			form: {},
			headers: { origin: baseURL!, accept: 'application/json', 'x-sveltekit-action': 'true' }
		});
		expect((await actionResult(again)).message).toBe('Your account is already bound with this context.');
	});

	test('LTI-07 LTI-12 grade passback retries, failures and give-ups', async ({ page, baseURL }) => {
		test.setTimeout(240_000);
		const users = ['qa', 'qb', 'qc', 'qd', 'qe', 'ga', 'gb', 'gc', 'gd'].map((u) => `cov_lti_${u}`);
		const launchClaims = (aud: string, lineitem: string, iss = ISS) => ({
			iss,
			aud,
			sub: 'x',
			[AGS]: { scope: [SCOPE], lineitem: `${mock.url}/lineitems/1/${lineitem}` }
		});
		await withDb(async (db) => {
			await db.collection('user_tasks').deleteMany({ username: { $in: users } });
			await db
				.collection('user_tasks')
				.insertMany(
					users
						.filter((u) => u !== 'cov_lti_qa')
						.map((username) => ({ username, courseid: C, taskid: 'mcq1', grade: username.endsWith('qb') ? 50 : 100 }))
				);
			const lis = (u: string, key: string, url = `${mock.url}/outcome`, courseid = C) => ({
				username: `cov_lti_${u}`,
				courseid,
				taskid: 'mcq1',
				nb_attempt: 0,
				outcome_consumer_key: key,
				outcome_result_id: `sid-${u}`,
				outcome_service_url: url
			});
			await db
				.collection('lis_outcome_queue')
				.insertMany([
					lis('qa', 'covkey'),
					lis('qb', 'covkey'),
					lis('qc', 'nokey'),
					lis('qd', 'covkey', 'not a url'),
					lis('qe', 'covkey', `${mock.url}/outcome`, 'e2e_cov_missing_course')
				]);
			const launches: [string, Record<string, unknown> | null][] = [
				['ga', null],
				['gb', launchClaims('cov-1', 'lineitem', 'https://unknown')],
				['gc', launchClaims('cov-2', 'lineitem')],
				['gd', launchClaims('cov-1', 'lineitem_fail')]
			];
			for (const [u, claims] of launches) {
				if (claims)
					await db
						.collection('lti_launch')
						.insertOne({ key: `cov-launch-${u}`, value: claims, expires: new Date(Date.now() + 3600_000) });
				await db.collection('lti_grade_queue').insertOne({
					username: `cov_lti_${u}`,
					courseid: C,
					taskid: 'mcq1',
					nb_attempt: 0,
					message_launch_id: `cov-launch-${u}`
				});
			}
		});
		// Any completed LTI submission processes the queues.
		await withDb((db) =>
			db
				.collection('users')
				.updateOne({ username: 'e2e_student3' }, { $set: { [`ltibindings.${C}/covkey`]: 'cov-s3' } })
		);
		const url = `${baseURL}/lti/${C}/mcq1`;
		await page.goto(
			mock.page(
				url,
				launch11(url, 'covkey', 'covsecret', { user_id: 'cov-s3', lis_outcome_service_url: `${mock.url}/outcome` })
			)
		);
		await expect(page).toHaveURL(/\/lti\/task\?session_id=/);
		await page.getByText('Right', { exact: true }).click();
		await page.getByRole('textbox').first().fill('yes');
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect
			.poll(
				async () =>
					(await withDb((db) => db.collection('lis_outcome_queue').countDocuments({ username: { $in: users } }))) +
					(await withDb((db) => db.collection('lti_grade_queue').countDocuments({ username: { $in: users } }))),
				{ timeout: 150_000 }
			)
			.toBe(0);
		expect(mock.log.some((l) => l.body.includes('<textString>0.5</textString>'))).toBe(true);
		// The best submission of a multiple choice task.
		const best = await page.request.get(`/lti/bestsubmission?${new URL(page.url()).searchParams}`);
		expect((await best.json()).question_answer[0]).toMatchObject({ answer: ['Right'], type: 'mcq' });
	});
});

test.describe('shell, sessions and error pages', () => {
	/** Inserts a session document (fields override a logged-in default) and returns its signed cookie. */
	async function rawSession(fields: Record<string, unknown>) {
		const id = new ObjectId();
		await withDb((db) =>
			db.collection('sessions').insertOne({
				_id: id,
				loggedin: true,
				is_lti: false,
				auth_storage: {},
				expiration: new Date(Date.now() + 3600_000),
				...fields
			})
		);
		const mac = createHmac('sha256', E2E.secretKey).update(id.toHexString()).digest('base64url');
		return `${id.toHexString()}.${mac}`;
	}

	test('CORE-01 the language menu of visitors submits the chosen language', async ({ page }) => {
		await page.goto('/courselist');
		const held = await holdSubmissions(page, '/language');
		await page.getByRole('button', { name: 'Language' }).click();
		await page.getByRole('menuitem', { name: 'Français' }).click();
		await expect.poll(async () => (await held())[0]).toContain('language=fr');
	});

	test('CORE-01 NAV-01 language changes, user menu, sidebar toggle and drawer', async ({ page, loginAs, request }) => {
		await loginAs('e2e_student1');
		await page.goto('/mycourses');
		const origin = new URL(page.url()).origin;
		// Language changes (then back), the same language again, a missing one and GET /language.
		for (const language of ['fr', 'en', 'en'])
			expect(
				(
					await page.request.post('/language', {
						form: { language },
						headers: { origin, accept: 'text/html' },
						maxRedirects: 0
					})
				).status()
			).toBe(303);
		expect(
			(
				await page.request.post('/language', { form: {}, headers: { origin, accept: 'text/html' }, maxRedirects: 0 })
			).status()
		).toBe(303);
		expect((await page.request.get('/language', { maxRedirects: 0 })).status()).toBe(303);
		// Cross-site form posts are refused.
		const evil = await request.post('/language', {
			form: { language: 'fr' },
			headers: { origin: 'https://evil.example' }
		});
		expect([evil.status(), await evil.text()]).toEqual([403, 'Cross-site POST form submissions are forbidden']);
		// Sidebar collapse on large screens, drawer on small ones.
		await page.getByRole('button', { name: 'Open menu' }).click();
		await expect(page.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false');
		await page.setViewportSize({ width: 500, height: 800 });
		await page.getByRole('button', { name: 'Open menu' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);
		// The user menu submits the logout form (held: the document stays, for the coverage).
		const held = await holdSubmissions(page, '/logout');
		await page.getByRole('button', { name: 'User menu' }).click();
		await page.getByRole('menuitem', { name: 'Log out' }).click();
		await expect.poll(async () => (await held()).length).toBe(1);
	});

	test('AUTH-10 AUTH-11 profile updates: validation errors, defaults and vanished accounts', async ({
		page,
		context,
		baseURL
	}) => {
		const user = await createUser({ language: undefined, code_indentation: undefined });
		await context.addCookies([await sessionCookie(user, baseURL!)]);
		await page.goto('/preferences/profile');
		await expect(page.getByLabel(/Complete name/)).toHaveValue(user.realname);
		const save = async (fields: Record<string, string>) =>
			(
				await actionResult(
					await action(
						page.request,
						'/preferences/profile',
						{ realname: 'Name', language: 'en', timezone: 'UTC', code_indentation: '4', ...fields },
						baseURL!
					)
				)
			).message;
		expect(await save({ passwd: 'longpassword', passwd2: 'other' })).toBe("Passwords don't match !");
		expect(await save({ passwd: 'longpassword' })).toBe("Passwords don't match !");
		expect(await save({ passwd: 'longpassword', passwd2: 'longpassword' })).toBe('Incorrect old password.');
		expect(await save({ realname: ' ' })).toBe('Name is too short.');
		expect(await save({ timezone: 'Mars/Base' })).toBe('Incorrect timezone.');
		expect(await save({ language: 'xx', code_indentation: '7' })).toBe('Profile updated.');
		expect(await withDb((db) => db.collection('users').findOne({ username: user.username }))).toMatchObject({
			language: 'en',
			code_indentation: '4'
		});
		// The account disappeared: the profile cannot be shown nor saved.
		await withDb((db) => db.collection('users').deleteOne({ username: user.username }));
		expect(await save({})).toBe('Incorrect email.');
		expect((await page.goto('/preferences/profile'))!.status()).toBe(404);
		await page.goto('/preferences/bindings');
		await expect(page.getByText('No authentication binding.')).toBeVisible();
		// A session without time zone, of an account without time zone.
		const other = await createUser();
		await context.clearCookies();
		const bare = await rawSession({ username: other.username, email: other.email, language: 'en' });
		await context.addCookies([{ name: 'inginious_session_id', value: bare, url: baseURL! }]);
		await page.goto('/preferences/profile');
		await expect(page.getByLabel(/Complete name/)).toHaveValue(other.realname);
		// A logged-in session without identity.
		await context.clearCookies();
		await context.addCookies([{ name: 'inginious_session_id', value: await rawSession({}), url: baseURL! }]);
		expect((await page.goto('/preferences/profile'))!.status()).toBe(404);
		expect((await page.goto('/preferences/delete'))!.status()).toBe(200);
	});

	test('AUTH-05 SITE-07 password checks of accounts without usable password, forged cookies and missing pages', async ({
		request,
		context,
		page,
		baseURL
	}) => {
		// An account without language takes the one of the session.
		const plain = await createUser({ language: undefined });
		expect(
			(
				await request.post('/api/v0/authentication', { data: { login: plain.username, password: 'superadmin' } })
			).status()
		).toBe(200);
		for (const password of [null, 'not-a-known-hash']) {
			const user = await createUser({ password });
			const res = await request.post('/api/v0/authentication', { data: { login: user.username, password: 'x' } });
			expect(res.status()).toBe(403);
		}
		const value = await createSessionCookie('e2e_student1');
		await context.addCookies([
			{ name: 'inginious_session_id', value: `${value.split('.')[0]}.${'A'.repeat(43)}`, url: baseURL! }
		]);
		expect((await page.request.get('/mycourses', { maxRedirects: 0 })).status()).toBe(302);
		expect((await page.request.get('/pages/nope')).status()).toBe(404);
	});

	test('CORE-02 AUTH-04 sessions with missing fields, expired sessions, malformed flashes and server errors', async ({
		page,
		context,
		baseURL
	}) => {
		// A session without profile fields (older documents): defaults, then the language is stored.
		const value = await rawSession({ username: 'e2e_student2' });
		await context.addCookies([{ name: 'inginious_session_id', value, url: baseURL! }]);
		await page.goto('/mycourses');
		await expect(page.getByRole('button', { name: 'User menu' })).toContainText('e2e_student2');
		const id = new ObjectId(value.split('.')[0]);
		await expect
			.poll(async () => (await withDb((db) => db.collection('sessions').findOne({ _id: id })))?.language)
			.toBe('en');
		// An expired session is replaced by a new anonymous one.
		const expired = await rawSession({ username: 'e2e_student2', expiration: new Date(Date.now() - 1000) });
		await context.addCookies([{ name: 'inginious_session_id', value: expired, url: baseURL! }]);
		expect((await page.request.get('/mycourses', { maxRedirects: 0 })).status()).toBe(302);
		// Malformed flash messages are ignored.
		for (const flash of ['{"kind":"nope","message":"x"}', 'not json'])
			await context.addCookies([{ name: 'inginious_flash', value: encodeURIComponent(flash), url: baseURL! }]);
		await page.goto('/signin');
		await expect(page.getByText('nope')).toHaveCount(0);
		// A corrupted account document: internal error page.
		const corrupted = await createUser({ pinned_courses: 5 });
		await context.clearCookies();
		await context.addCookies([await sessionCookie(corrupted, baseURL!)]);
		expect((await page.goto('/mycourses'))!.status()).toBe(500);
		await expect(page.getByRole('heading', { name: 'Internal error' })).toBeVisible();
	});
});

test.describe('configurations', () => {
	/** Base configuration of this run. */
	const base = () => parse(readFileSync(`e2e/.generated/config-${E2E_ID}.yaml`, 'utf8')) as Record<string, unknown>;
	for (const [name, content] of [
		['without session secret', () => stringify({ ...base(), session_parameters: {} })],
		['with the unsupported local backend', () => stringify({ ...base(), backend: 'local' })],
		['with an empty configuration file', () => ''],
		['without configuration file', null]
	] as const)
		test(`CORE-02 a server ${name} refuses to start`, async () => {
			const file = `e2e/.generated/config-${E2E_ID}-invalid.yaml`;
			if (content) writeFileSync(file, content());
			const env: Record<string, string | undefined> = {
				...process.env,
				PORT: new URL(appUrl(0)).port,
				INGINIOUS_CONFIG: content ? file : undefined,
				NODE_V8_COVERAGE: `${E2E.coverageDir}/server-raw`
			};
			if (!content) delete env.INGINIOUS_CONFIG;
			const child = spawn('node', [E2E.buildDir], { env, stdio: 'ignore' });
			const code = await new Promise<number | null>((done) => {
				const timer = setTimeout(() => (child.kill('SIGTERM'), done(null)), 20_000);
				child.once('exit', (c) => (clearTimeout(timer), done(c)));
				// Configuration errors may only surface on the first request.
				setTimeout(() => void fetch(appUrl(0)).catch(() => undefined), 3_000);
			});
			expect(code).not.toBe(0);
		});

	test('AUTH-05 behind a reverse proxy with the default number of hops, failed logins are counted per forwarded address', async () => {
		const app = await startApp(0, { 'reverse-proxy-config': { enable: true } });
		try {
			const res = await fetch(`${appUrl(0)}/api/v0/authentication`, {
				method: 'POST',
				body: JSON.stringify({ login: 'nobody', password: 'x' }),
				headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.12.0.1' }
			});
			expect(res.status).toBe(403);
		} finally {
			await app.stop();
		}
	});

	test('CORE-04 CORE-05 a server without SMTP and with a cookie domain', async () => {
		const app = await startApp(0, {
			smtp: null,
			'reverse-proxy-config': { enable: true, x_for: 2 },
			session_parameters: { ...(base().session_parameters as object), cookie_domain: 'localhost' }
		});
		try {
			// Right after the start, no queue snapshot has been received yet.
			const queue = await fetch(`${appUrl(0)}/queue`, {
				headers: { cookie: `inginious_session_id=${await createSessionCookie('superadmin')}` }
			});
			expect(queue.status).toBe(200);
			const res = await fetch(`${appUrl(0)}/language`, {
				method: 'POST',
				body: new URLSearchParams({ language: 'fr' }),
				headers: { origin: appUrl(0), 'x-forwarded-proto': 'http' },
				redirect: 'manual'
			});
			expect(res.headers.get('set-cookie')).toMatch(/Domain=localhost/i);
			// Registrations cannot send their activation mail.
			const name = `covsmtp${uid()}`;
			const form = new URLSearchParams({
				username: name,
				realname: 'S',
				email: `${name}@inginious.local`,
				passwd: 'abcdefgh',
				passwd2: 'abcdefgh'
			});
			await fetch(`${appUrl(0)}/register?/register`, {
				method: 'POST',
				body: form,
				headers: { origin: appUrl(0), 'x-forwarded-proto': 'http', 'x-forwarded-for': '10.9.0.1' }
			});
		} finally {
			await app.stop();
		}
	});
});
