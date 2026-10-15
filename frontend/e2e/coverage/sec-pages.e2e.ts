/**
 * Integration tests of the task page refusals (HTTP status), the SSH access of
 * debug sessions, the staff submission page seen by a tutor and the run-time part
 * of the Content-Security-Policy, on `e2e_sec_ui` (a copy of the `cov_ui` fixture:
 * e2e_admin is admin, e2e_tutor tutor). Submissions are inserted in the database.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BSON, GridFSBucket, ObjectId } from 'mongodb';
import type { Page } from '@playwright/test';
import { expect, installCourse, test, withDb } from '../fixtures.js';
import { useApp } from '../auth/helpers.js';
import { E2E } from '../setup-data.js';

const C = installCourse('cov_ui', 'e2e_sec_ui');
const TASK = `/course/${C}/lone_mcq`;

let counter = 0;
/** Creates a student registered to the course (password "superadmin"). */
async function student(): Promise<string> {
	const username = `sec_${process.pid}_${Date.now() % 1e6}_${++counter}`;
	await withDb(async (db) => {
		await db.collection('users').insertOne({
			username,
			realname: username,
			email: `${username}@x.org`,
			password: E2E.passwordHash,
			bindings: {},
			language: 'en',
			tos_accepted: true
		});
		await db
			.collection('courses')
			.updateOne({ _id: C as never }, { $push: { students: username } as never }, { upsert: true });
	});
	return username;
}

/** Inserts a submission of `username` to lone_mcq (answer "Alpha", input stored in GridFS); returns its id. */
const submission = (username: string, fields: Record<string, unknown>) =>
	withDb(async (db) => {
		const upload = new GridFSBucket(db).openUploadStream('');
		upload.end(BSON.serialize({ pick: ['0'], '@random': [] }));
		await new Promise((r) => upload.on('finish', r));
		return String(
			(
				await db.collection('submissions').insertOne({
					courseid: C,
					taskid: 'lone_mcq',
					username: [username],
					input: upload.id,
					status: 'done',
					result: 'success',
					grade: 100,
					submitted_on: new Date(),
					text: '',
					problems: {},
					tests: {},
					custom: {},
					...fields
				})
			).insertedId
		);
	});

/** Raw data block of the staff submission page (CSTU-15, admins only). */
const debugData = (page: Page) => page.locator('details', { hasText: 'Debug information' }).locator('pre');

/** SSH access of a running debug session (TASK-12). */
const SSH = { ssh_host: 'ssh.example', ssh_port: 2222, ssh_user: 'worker', ssh_password: 'sec-pw' };

test('TASK-08 a refused submission answers HTTP 403 and the task page shows why', async ({ loginAs }) => {
	const me = await student();
	const page = await loginAs(me);
	await page.goto(TASK);
	await page.locator('form[data-ready]').waitFor();
	await page.getByRole('checkbox', { name: 'Alpha' }).check();
	// The deadline passes while the page is open.
	const yaml = join(E2E.tasksDir, C, 'course.yaml');
	const course = readFileSync(yaml, 'utf8');
	writeFileSync(
		yaml,
		course.replace(
			'lone_mcq: { accessibility: true }',
			"lone_mcq: { accessibility: '2020-01-01 00:00:00 / 2021-01-01 00:00:00' }"
		)
	);
	try {
		const answer = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(TASK));
		await page.getByRole('button', { name: 'Submit' }).click();
		expect((await answer).status()).toBe(403);
		await expect(page.getByText('You are not allowed to submit for this task.')).toBeVisible();
		expect(await withDb((db) => db.collection('submissions').countDocuments({ username: me }))).toBe(0);
	} finally {
		writeFileSync(yaml, course);
	}
});

test('TASK-12 the SSH access of a debug session is only sent to the administrator who started it', async ({
	page,
	loginAs,
	baseURL
}) => {
	const id = await submission('e2e_admin', { status: 'waiting', result: 'crash', ...SSH });
	const check = async (user: string) => {
		await page.context().clearCookies();
		await loginAs(user);
		const res = await page.request.post(TASK, {
			form: { '@action': 'check', submissionid: id },
			headers: { origin: baseURL! }
		});
		return (await res.json()).submission;
	};
	expect((await check('e2e_admin')).ssh).toEqual({
		host: 'ssh.example',
		port: 2222,
		user: 'worker',
		password: 'sec-pw'
	});
	// Another administrator sees the raw data of the submission, without its SSH password.
	const other = await check('superadmin');
	expect(other.ssh).toBeUndefined();
	expect(other.debug).toMatchObject({ ssh_host: 'ssh.example', ssh_user: 'worker' });
	expect(JSON.stringify(other)).not.toContain('sec-pw');
	await page.goto(`/submission/${id}`);
	await expect(debugData(page)).toContainText('ssh.example');
	await expect(debugData(page)).not.toContainText('sec-pw');
	await withDb((db) => db.collection('submissions').deleteOne({ _id: new ObjectId(id) }));
});

test('CSTU-15 a tutor sees no debug data of a submission and cannot start a debug replay', async ({
	loginAs,
	baseURL
}) => {
	const id = await submission(await student(), { stdout: 'raw container output' });
	const page = await loginAs('e2e_tutor');
	await page.goto(`/submission/${id}`);
	await expect(page.getByRole('heading', { name: 'Lone MCQ' })).toBeVisible();
	await expect(page.getByText('Debug information')).toHaveCount(0);
	await expect(page.getByText('raw container output')).toHaveCount(0);
	await page.getByText('Replay', { exact: true }).click(); // replay actions menu
	await expect(page.getByRole('button', { name: /^Replay as / })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Replay\/debug as / })).toHaveCount(0);
	// Forged requests: a debug replay is refused, no job is created.
	const debug = await page.request.post(`/submission/${id}?/debug`, {
		form: {},
		headers: { origin: baseURL!, accept: 'application/json' }
	});
	expect([debug.status(), (await debug.json()).type]).toEqual([403, 'error']);
	expect(
		await withDb((db) => db.collection('submissions').countDocuments({ username: 'e2e_tutor', courseid: C }))
	).toBe(0);
	// The course administrators see the raw data.
	await page.context().clearCookies();
	await loginAs('e2e_admin');
	await page.goto(`/submission/${id}`);
	await expect(debugData(page)).toContainText('raw container output');
});

test('CORE-03 pages only connect to, frame and post to the application itself by default', async ({ request }) => {
	const csp = (await request.get('/courselist')).headers()['content-security-policy'];
	for (const directive of ["connect-src 'self';", "frame-src 'self';", "form-action 'self';"])
		expect(csp).toContain(directive);
	expect(csp).toMatch(/frame-ancestors 'self'$/);
	// Sign-in forms are redirected to the identity providers.
	expect((await request.get('/signin')).headers()['content-security-policy']).toContain("form-action 'self' https:;");
});

test.describe('with Sentry and a webterm', () => {
	useApp(19, {
		sentry_io_url: 'https://publickey@o7.ingest.sentry.example/3',
		webterm: 'https://term.example:8443/xterm'
	});

	test('CORE-03 CORE-06 TASK-12 the CSP allows the configured Sentry and webterm hosts', async ({ loginAs }) => {
		const id = await submission('e2e_admin', { status: 'waiting', result: 'crash', ...SSH });
		const page = await loginAs('e2e_admin');
		const violations: string[] = [];
		page.on('console', (msg) => {
			if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
		});
		await page.route('https://term.example:8443/**', (route) => route.fulfill({ body: 'remote terminal' }));
		const response = await page.goto(TASK);
		const csp = response!.headers()['content-security-policy'];
		expect(csp).toContain("connect-src 'self' https://o7.ingest.sentry.example;");
		expect(csp).toContain("frame-src 'self' https://term.example:8443;");
		// The waiting debug submission of the administrator shows the webterm.
		await expect(page.frameLocator('iframe[title="SSH console"]').getByText('remote terminal')).toBeVisible();
		expect(violations).toEqual([]);
		await withDb((db) => db.collection('submissions').deleteOne({ _id: new ObjectId(id) }));
	});
});
