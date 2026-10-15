/**
 * Coverage-driven integration tests of the student pages and of server guards:
 * category filter of the task list, empty lists and searches without result,
 * a contest not started yet, the LTI binding refused in the browser, LTI
 * sessions on normal pages, unloadable courses, invalid ids and e-mail links
 * that cannot be built from a foreign Host header, the navigation drawer of small
 * screens and a server refusing a database of another version.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { parse, stringify } from 'yaml';
import { expect, installCourse, test, withDb } from '../fixtures.js';
import { E2E, E2E_ID } from '../setup-data.js';
import { appUrl, createUser, sessionCookie, uid } from '../auth/helpers.js';
import { launch11 } from '../lti/mock/platform.js';

/** Registers students to a course (DB `courses` document). */
const register = (courseid: string, students: string[]) =>
	withDb((db) =>
		db.collection('courses').updateOne({ _id: courseid as never }, { $set: { students } }, { upsert: true })
	);

/** Rewrites fields of the course.yaml of an installed course. */
const setCourse = (courseid: string, fields: Record<string, unknown>) => {
	const file = resolve(E2E.tasksDir, `${courseid}/course.yaml`);
	writeFileSync(file, stringify({ ...parse(readFileSync(file, 'utf8')), ...fields }, { version: '1.1' }));
};

test('NAV-03 NAV-08 the category filter hides the sections without task of the category', async ({
	page,
	context,
	loginAs,
	baseURL
}) => {
	const course = installCourse('cov_site', `e2e_covpg_${uid()}`);
	await register(course, ['e2e_student1']);
	await loginAs('e2e_student1');
	await page.goto(`/course/${course}`);
	await expect(page.getByText('Others')).toBeVisible();
	await page.getByRole('button', { name: 'cov_cat' }).click();
	await expect(page.getByText('Others')).toHaveCount(0);
	await expect(page.getByText('Exercises').first()).toBeVisible();
	await expect(page.getByRole('link', { name: /Score task code1/ })).toBeVisible();
	// NAV-08 unregistering is refused to the staff.
	await context.clearCookies();
	await loginAs('e2e_admin');
	const refused = await page.request.post(`/course/${course}?/unregister`, {
		form: {},
		headers: { origin: baseURL!, accept: 'application/json', 'x-sveltekit-action': 'true' }
	});
	expect((await refused.json()).status).toBe(403);
});

test('TASK-08 anonymous visitors of a previewable course cannot use the task actions', async ({ request, baseURL }) => {
	const course = installCourse('nav_preview', `e2e_covpv_${uid()}`);
	const response = await request.post(`/course/${course}/t1`, {
		form: { '@action': 'check', submissionid: new ObjectId().toHexString() },
		headers: { origin: baseURL! }
	});
	expect(response.status()).toBe(403);
});

test('NAV-01 NAV-02 NAV-10 empty course lists, upcoming tasks and searches without result', async ({
	page,
	context,
	loginAs,
	baseURL
}) => {
	const user = await createUser();
	await context.addCookies([await sessionCookie(user, baseURL!)]);
	await page.goto('/mycourses');
	await expect(page.getByText('You are not registered to any course')).toBeVisible();
	await page.goto('/coming_tasks');
	await expect(page.getByText('You have no upcoming tasks')).toBeVisible();
	await page.goto('/courselist');
	await page.getByRole('searchbox').fill('no course has this name');
	await expect(page.getByText('No course found.')).toBeVisible();
	await context.clearCookies();
	await loginAs('e2e_student1');
	await page.goto('/mycourses');
	await page.getByRole('searchbox').fill('no course has this name');
	await expect(page.getByText('No course found.')).toBeVisible();
});

test('SITE-14 a contest that has not started yet', async ({ page, loginAs }) => {
	const course = installCourse('cov_site_contest', `e2e_covct_${uid()}`);
	const file = resolve(E2E.tasksDir, `${course}/course.yaml`);
	const yaml = parse(readFileSync(file, 'utf8'));
	yaml.dispenser_data.contest_settings.start = '2098-01-01 00:00:00+00:00';
	writeFileSync(file, stringify(yaml, { version: '1.1' }));
	await register(course, ['e2e_student1']);
	await loginAs('e2e_student1');
	await page.goto(`/contest/${course}`);
	await expect(page.getByText('Contest has not started yet.')).toBeVisible();
});

test('LTI-04 a binding refused in the browser: the account is already bound in this context', async ({
	page,
	context,
	request,
	baseURL
}) => {
	const course = installCourse('cov_site_lti', `e2e_covbind_${uid()}`);
	const url = `${baseURL}/lti/${course}/mcq1`;
	const launched = await request.post(url, {
		form: launch11(url, 'ltikey', 'ltisecret', { user_id: `lms-${uid()}` }),
		maxRedirects: 0
	});
	const user = await createUser({ ltibindings: { [`${course}/ltikey`]: 'another-lms-user' } });
	await context.addCookies([await sessionCookie(user, baseURL!)]);
	await page.goto(`${baseURL}${launched.headers().location}`);
	await page.goto((await page.getByRole('link', { name: 'Bind your INGInious account' }).getAttribute('href'))!);
	await expect(page.getByText(`${user.realname} [${user.username}]`)).toBeVisible();
	await page.getByRole('button', { name: 'Bind my account' }).click();
	await expect(page.getByText('Your account is already bound with this context.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Bind my account' })).toBeVisible();
});

test('LTI-03 an LTI session used as a cookie cannot browse the normal pages', async ({ page, context, baseURL }) => {
	const id = new ObjectId();
	await withDb((db) =>
		db.collection('sessions').insertOne({
			_id: id,
			is_lti: true,
			loggedin: true,
			username: 'e2e_student1',
			email: 'e2e_student1@inginious.local',
			realname: 'E2E Student1',
			language: 'en',
			tos_signed: true,
			expiration: new Date(Date.now() + 3600_000)
		})
	);
	const mac = createHmac('sha256', E2E.secretKey).update(id.toHexString()).digest('base64url');
	await context.addCookies([{ name: 'inginious_session_id', value: `${id.toHexString()}.${mac}`, url: baseURL! }]);
	const response = await page.goto('/mycourses');
	expect(response!.status()).toBe(403);
	await expect(page.getByText('This page is not available from your LMS.').first()).toBeVisible();
});

test('NAV-03 courses with an invalid id or an invalid accessibility are not found', async ({ request }) => {
	const course = installCourse('nav_open', `e2e_covbad_${uid()}`);
	setCourse(course, { accessible: 42 });
	expect((await request.get(`/course/${course}`)).status()).toBe(404);
	expect((await request.get('/course/not.a.course')).status()).toBe(404);
});

test('AUTH-07 activation links are never built from a foreign Host header', async ({ request, baseURL }) => {
	const name = `cov_${uid()}`;
	const response = await request.post(`${baseURL}/register?/register`, {
		headers: { host: 'evil.example', origin: 'http://evil.example' },
		form: {
			username: name,
			realname: 'Cov',
			email: `${name}@inginious.local`,
			passwd: 'secret123',
			passwd2: 'secret123'
		}
	});
	expect(await response.text()).toContain('Something went wrong while sending you activation email.');
	expect(await withDb((db) => db.collection('users').findOne({ username: name }))).toBeNull();
});

test('NAV-14 on small screens the menu button opens the navigation drawer', async ({ page, loginAs }) => {
	await page.setViewportSize({ width: 400, height: 800 });
	await loginAs('e2e_student1');
	await page.goto('/mycourses');
	const button = page.getByRole('button', { name: 'Open menu' });
	await expect(button).toHaveAttribute('aria-expanded', 'false');
	await button.click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('SITE-01 the server refuses to start on a database of another version (legacy get_app)', async () => {
	test.setTimeout(60_000);
	const database = `${E2E.database}_badver`;
	const client = await MongoClient.connect(E2E.mongoUrl);
	try {
		await client.db(database).dropDatabase();
		await client.db(database).collection('db_version').insertOne({ db_version: 1 });
		const base = parse(readFileSync(`e2e/.generated/config-${E2E_ID}.yaml`, 'utf8'));
		const file = `e2e/.generated/config-${E2E_ID}-badver.yaml`;
		writeFileSync(file, stringify({ ...base, mongo_opt: { ...base.mongo_opt, database } }));
		const server = spawn('node', [E2E.buildDir], {
			env: {
				...process.env,
				PORT: new URL(appUrl(12)).port,
				INGINIOUS_CONFIG: file,
				NODE_V8_COVERAGE: `${E2E.coverageDir}/server-raw`
			},
			stdio: ['ignore', 'ignore', 'pipe']
		});
		let stderr = '';
		server.stderr!.on('data', (chunk) => (stderr += chunk));
		const code = await new Promise<number | null>((done) => server.once('exit', done));
		expect(code).not.toBe(0);
		expect(stderr).toContain('Database version 1 != ');
	} finally {
		await client.db(database).dropDatabase();
		await client.close();
	}
});
