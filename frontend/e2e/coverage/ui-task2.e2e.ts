/**
 * Integration coverage of the UI kit (sortable tables, search selects, rich text
 * editors, copy fields, file drops, code editors) and of the client-side states of
 * the task page (action errors, result polling, reloaded answers, auto-tags,
 * unnamed problems), on the course fixture `cov_ui` (course `e2e_cov_ui`).
 * Submissions are inserted directly in the database; the task actions whose
 * outcome depends on the grading backend are intercepted in the browser.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { Binary, BSON, GridFSBucket } from 'mongodb';
import type { Page, Route } from '@playwright/test';
import { test, expect, installCourse, withDb } from '../fixtures.js';
import { E2E } from '../setup-data.js';

const C = installCourse('cov_ui');
const url = (task: string, course = C) => `/course/${course}/${task}`;
const TASKS = E2E.tasksDir;

let counter = 0;
/** Creates a student registered to `course` (password "superadmin"), with optional user fields. */
async function student(fields: Record<string, unknown> = {}, course = C): Promise<string> {
	const username = `ui_${process.pid}_${Date.now() % 1e6}_${++counter}`;
	await withDb(async (db) => {
		await db.collection('users').insertOne({
			username,
			realname: username,
			email: `${username}@x.org`,
			password: E2E.passwordHash,
			bindings: {},
			language: 'en',
			code_indentation: '4',
			tos_accepted: true,
			...fields
		});
		await db
			.collection('courses')
			.updateOne({ _id: course as never }, { $push: { students: username } as never }, { upsert: true });
	});
	return username;
}

/** Inserts a graded submission of `username` for `taskid` (input stored in GridFS) and returns its id. */
async function insertSubmission(
	username: string,
	taskid: string,
	input: Record<string, unknown>,
	fields: Record<string, unknown> = {}
): Promise<string> {
	return withDb(async (db) => {
		const upload = new GridFSBucket(db).openUploadStream('');
		upload.end(BSON.serialize({ ...input, '@random': [] }));
		await new Promise((r) => upload.on('finish', r));
		const { insertedId } = await db.collection('submissions').insertOne({
			courseid: C,
			taskid,
			username: [username],
			input: upload.id,
			status: 'done',
			result: 'success',
			grade: 100,
			submitted_on: new Date(Date.now() - 60_000 * ++counter),
			text: '',
			problems: {},
			tests: {},
			custom: {},
			...fields
		});
		return String(insertedId);
	});
}

/** Opens a task page and waits until it is interactive. */
async function open(page: Page, task: string, course = C) {
	await page.goto(url(task, course));
	await page.locator('form[data-ready]').waitFor();
}

/** Action (`@action` field) of an intercepted task page request, null for other requests. */
const actionOf = (route: Route) =>
	route.request().method() === 'POST'
		? (/name="@action"\r\n\r\n(\w+)/.exec(route.request().postData() ?? '')?.[1] ?? null)
		: null;

/** JSON of a submission still being graded. */
const waitingJson = (id: string) => ({
	id,
	status: 'waiting',
	result: 'waiting',
	grade: 0,
	submittedOn: new Date().toISOString(),
	title: '',
	text: 'Your submission is in the queue.',
	problems: {},
	tests: {},
	replace: false
});

test('TASK-08 TASK-09 TASK-10 action errors are shown; polling goes on while the result is waiting', async ({
	loginAs
}) => {
	const me = await student();
	const page = await loginAs(me);
	await open(page, 'code');
	const fake = 'fffffffffffffffffffffff1';
	let checks = 0;
	let releaseCheck = () => {};
	const gate = new Promise<void>((r) => (releaseCheck = r));
	let mode: 'refuse' | 'abort' | 'accept' = 'refuse';
	await page.route(url('code'), async (route) => {
		const action = actionOf(route);
		if (action === 'submit' && mode === 'refuse')
			return route.fulfill({ json: { status: 'error', text: 'Submission refused' } });
		if (action === 'submit' && mode === 'abort') return route.abort();
		if (action === 'submit') return route.fulfill({ json: { status: 'ok', submissionid: fake, remove: [] } });
		if (action === 'check' && ++checks === 1)
			return route.fulfill({ json: { status: 'ok', submission: waitingJson(fake) } });
		if (action === 'check') {
			await gate;
			return route.fulfill({ json: { status: 'error', text: 'Check failed' } });
		}
		return route.continue();
	});
	const errorAlert = page.getByRole('alert').filter({ hasText: 'Error' });
	await page.locator('[data-problem="word"] input').fill('x');
	// Ctrl + another key does not submit.
	await page.locator('[data-problem="word"] input').press('Control+a');
	await expect(errorAlert).toHaveCount(0);
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(errorAlert).toContainText('Submission refused');
	mode = 'abort';
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(errorAlert).toContainText('Internal error');
	mode = 'accept';
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.locator('#task-result')).toContainText('Your submission is in the queue.');
	await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled();
	// The second poll fails: the error replaces the waiting state.
	await expect.poll(() => checks).toBe(2);
	releaseCheck();
	await expect(errorAlert).toContainText('Check failed');
	await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();
});

test('TASK-10 reloading a submission: errors, missing answers, code editor update', async ({ loginAs }) => {
	const me = await student({ code_indentation: 'tabs' });
	const old = await insertSubmission(me, 'code', { code: 'print(2)' });
	const page = await loginAs(me);
	await page.emulateMedia({ colorScheme: 'dark' });
	await open(page, 'code');
	const editor = page.locator('[data-problem="code"] .cm-content');
	// Tabs indentation preference: Tab inserts a tab character.
	await editor.click();
	await page.keyboard.press('Control+End');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await page.keyboard.type('y');
	await expect(page.locator('input[type=hidden][name="code"]')).toHaveValue('print(1)\n\ty');
	await page.locator('[data-problem="word"] input').fill('typed');
	// A failed load is reported.
	await page.route(url('code'), (route) =>
		actionOf(route) === 'load' ? route.fulfill({ json: { status: 'error', text: 'Load failed' } }) : route.continue()
	);
	await page.getByTestId('history').locator(`[data-submission="${old}"]`).click();
	await expect(page.getByRole('alert').filter({ hasText: 'Error' })).toContainText('Load failed');
	await page.unroute(url('code'));
	// The stored code replaces the editor content; the missing answer becomes empty.
	await page.getByTestId('history').locator(`[data-submission="${old}"]`).click();
	await expect(page.locator('#task-result')).toContainText(`Submission #${old}`);
	await expect(editor).toHaveText('print(2)');
	await expect(page.locator('[data-problem="word"] input')).toHaveValue('');
});

test('TASK-20 admins see the automatic tags of a submission, long ones truncated', async ({ loginAs }) => {
	const long = 'an automatic tag with a rather long text';
	const id = await insertSubmission(
		'e2e_admin',
		'code',
		{ code: 'x', word: 'x' },
		{ tests: { '*auto-tag-1': long, '*auto-tag-2': 'short tag' } }
	);
	const page = await loginAs('e2e_admin');
	await open(page, 'code');
	await page.getByTestId('history').locator(`[data-submission="${id}"]`).click();
	const tags = page.getByLabel('Tags');
	await expect(tags).toContainText('short tag');
	await expect(tags.locator(`[title="${long}"]`)).toHaveText(`${long.slice(0, 28)}…`);
});

test('TASK-04 TASK-05 lone unnamed problems: choices toggle, file drop zone and the previous file', async ({
	loginAs
}) => {
	const me = await student();
	const old = await insertSubmission(me, 'lone_file', {
		upload: { filename: 'old.txt', value: new Binary(Buffer.from('old')) }
	});
	const page = await loginAs(me);
	await open(page, 'lone_mcq');
	// The fieldset of an untitled problem is named after its id.
	await expect(page.locator('legend', { hasText: 'pick' })).toHaveCount(1);
	const choice = (name: string) => page.getByRole('checkbox', { name });
	await choice('Alpha').check();
	await choice('Beta').check();
	await choice('Alpha').uncheck();
	await expect(choice('Alpha')).not.toBeChecked();
	await expect(choice('Beta')).toBeChecked();

	await open(page, 'lone_file');
	await expect(page.getByText('Choose a file')).toBeVisible();
	await expect(page.getByText('Maximum size: 2.0 MB.')).toBeVisible();
	const zone = page.locator('label').filter({ hasText: 'Choose a file' });
	await zone.dispatchEvent('dragover', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
	await expect(zone).toHaveClass(/border-primary-500/);
	// Dropping nothing keeps the (empty) selection.
	await zone.dispatchEvent('drop', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
	await expect(zone).not.toHaveClass(/border-primary-500/);
	const withFile = await page.evaluateHandle(() => {
		const transfer = new DataTransfer();
		transfer.items.add(new File(['hello'], 'dropped.txt', { type: 'text/plain' }));
		return transfer;
	});
	await zone.dispatchEvent('drop', { dataTransfer: withFile });
	await expect(page.getByText('dropped.txt')).toBeVisible();
	// The file of a reloaded submission can be downloaded.
	await page.getByTestId('history').locator(`[data-submission="${old}"]`).click();
	await expect(
		page.getByRole('link', { name: /download the file you submitted previously \(old\.txt\)/ })
	).toBeVisible();
});

test('TASK-12 with a web terminal configured, the SSH panel embeds it', async ({ loginAs }) => {
	const me = await student();
	await insertSubmission(
		me,
		'code',
		{ code: 'x', word: 'x' },
		{
			status: 'waiting',
			result: 'crash',
			jobid: 'unknown-job',
			ssh_host: 'ssh.example.org',
			ssh_port: 2222,
			ssh_user: 'worker',
			ssh_password: 's3cret'
		}
	);
	const page = await loginAs(me);
	// The e2e configuration has no `webterm`: the page data is given one.
	await page.route(url('code'), async (route) => {
		if (route.request().method() !== 'GET') return route.continue();
		const response = await route.fetch();
		const body = (await response.text()).replace('webterm:null', 'webterm:"https://term.example/"');
		await route.fulfill({ response, body });
	});
	await page.route('https://term.example/**', (route) => route.fulfill({ body: 'terminal' }));
	await open(page, 'code');
	await expect(page.getByTitle('SSH console')).toHaveAttribute(
		'src',
		'https://term.example/?host=ssh.example.org&port=2222&password=s3cret'
	);
	await expect(page.getByTestId('ssh-panel')).toContainText('Alternatively, you can also paste this command');
});

test('TASK-18 staff are warned that the course is hidden from students', async ({ loginAs }) => {
	const closed = installCourse('nav_closed', 'e2e_cov_ui_closed');
	const page = await loginAs('superadmin');
	await open(page, 't1', closed);
	await expect(page.getByText('This course is currently invisible for students.')).toBeVisible();
});

test('CADM-03 staff pickers work with the keyboard; rich texts are previewed', async ({ loginAs }) => {
	const page = await loginAs('e2e_admin');
	await page.goto(`/admin/${C}/settings`);
	const picker = page.getByRole('combobox', { name: 'Tutors' });
	const chips = page.getByRole('button', { name: /^Remove / });
	const before = await chips.count();
	// Nothing to move to before a search.
	await picker.press('ArrowDown');
	await expect(picker).not.toHaveAttribute('aria-activedescendant');
	await picker.fill('e2e_stud');
	const list = page.getByRole('listbox', { name: 'Tutors' });
	await expect(list.getByRole('option')).toHaveCount(3);
	await picker.press('ArrowDown');
	await picker.press('ArrowDown');
	await picker.press('ArrowUp');
	await expect(picker).toHaveAttribute('aria-activedescendant', /-0$/);
	await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
	await picker.press('Enter');
	await expect(chips).toHaveCount(before + 1);
	await picker.fill('e2e_stud');
	await expect(list).toBeVisible();
	await picker.press('Escape');
	await expect(list).toHaveCount(0);
	await picker.fill('');
	await picker.press('Backspace');
	await expect(chips).toHaveCount(before);
	// A failing search shows no suggestion.
	await page.route('**/search_user?**', (route) => route.fulfill({ status: 500, body: 'down' }));
	await picker.fill('e2e_stud');
	await expect(list).toContainText('No result');

	// Rich text: preview, back to edition, Markdown switch, failing preview.
	const preview = page.getByRole('button', { name: 'Preview' }).first();
	await preview.click();
	await expect(page.getByText('Course used by the UI coverage tests.').first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit' }).first().click();
	await page.getByRole('radio', { name: 'Markdown' }).first().click();
	await expect(page.getByRole('radio', { name: 'Markdown' }).first()).toHaveAttribute('aria-checked', 'true');
	await page.route(`**/admin/${C}/preview`, (route) => route.fulfill({ status: 500, body: 'down' }));
	await preview.click();
	await expect(page.getByText('Preview unavailable.')).toBeVisible();
});

test('CADM-04 deployment secrets can be revealed, hidden and copied', async ({ loginAs, context }) => {
	const course = installCourse('cov_ui', 'e2e_cov_ui_lti');
	const file = join(TASKS, course, 'course.yaml');
	const k = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
	});
	const iss = `https://lms-ui-${Date.now()}.example`;
	writeFileSync(
		file,
		stringify({
			...parse(readFileSync(file, 'utf8'), { version: '1.1' }),
			is_lti: true,
			lti_config: {
				[iss]: [
					{
						default: true,
						client_id: 'uiclient',
						auth_login_url: 'https://lms.example/auth',
						auth_token_url: 'https://lms.example/token',
						key_set_url: 'https://lms.example/jwks',
						private_key: k.privateKey,
						public_key: k.publicKey,
						deployment_ids: ['dep1']
					}
				]
			},
			lti_secrets: { [`${iss}/uiclient/dep1`]: 'abc123' }
		})
	);
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const page = await loginAs('e2e_admin');
	await page.goto(`/admin/${course}/settings`);
	const secret = page.getByLabel('Secret', { exact: true });
	await expect(secret).toHaveAttribute('type', 'password');
	await page.getByRole('button', { name: 'Show' }).click();
	await expect(secret).toHaveAttribute('type', 'text');
	await page.getByRole('button', { name: 'Hide' }).click();
	await expect(secret).toHaveAttribute('type', 'password');
	await page.getByRole('button', { name: 'Copy Secret' }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('abc123');
});

test('CSTU-01 CSTU-11 tables sort empty values last, both ways', async ({ loginAs }) => {
	const plain = await student();
	const noMail = await student({ email: '' });
	await insertSubmission(plain, 'code', { code: 'a', word: 'a' });
	await insertSubmission(noMail, 'code', { code: 'b', word: 'b' }, { last_replay: new Date() });
	const page = await loginAs('e2e_admin');
	await page.goto(`/admin/${C}/students`);
	const header = (name: string) => page.getByRole('columnheader', { name }).first();
	/** Text of the rows of the table, in display order. */
	const rows = () => page.locator('tbody tr').allInnerTexts();
	await header('Email address').getByRole('button').click();
	await expect(header('Email address')).toHaveAttribute('aria-sort', 'ascending');
	expect((await rows()).at(-1)).toContain(noMail);
	await header('Email address').getByRole('button').click();
	expect((await rows())[0]).toContain(noMail);

	// File inputs also accept files by MIME type (a CSV without the .csv extension).
	await page.goto(`/admin/${C}/students?tab=audiences`);
	await page.getByText('Import / export').click();
	await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles({
		name: 'audiences.data',
		mimeType: 'text/csv',
		buffer: Buffer.from('user,username,student,aud\n')
	});
	await expect(page.getByText('audiences.data')).toBeVisible();
	await expect(page.getByRole('alert').filter({ hasText: 'unsupported type' })).toHaveCount(0);

	await page.goto(`/admin/${C}/submissions`);
	await header('Replayed on').getByRole('button').click();
	await expect(header('Replayed on')).toHaveAttribute('aria-sort', 'ascending');
	expect((await rows())[0]).toContain(noMail);
	await header('Replayed on').getByRole('button').click();
	expect((await rows()).at(-1)).toContain(noMail);
});

test('AUTH-10 the first visit picks the best language of the Accept-Language header', async ({
	playwright,
	baseURL
}) => {
	/** Language of the page served for an Accept-Language header (fresh session). */
	async function lang(header: string) {
		const request = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'accept-language': header } });
		const html = await (await request.get('/')).text();
		await request.dispose();
		return /<html lang="([\w-]+)"/.exec(html)?.[1];
	}
	expect(await lang('xx;q=0.9, fr;q=0.5, de-AT;q=0.7')).toBe('de');
	expect(await lang('nb-NO;q=0.2, xx')).toBe('nb-NO');
});
