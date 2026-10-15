/**
 * Integration tests of the task page and the submission lifecycle (TASK-01..25),
 * on a copy of the task_showcase fixture course (course `e2e_task_showcase`).
 * Every test uses its own fresh students. Tests that need real grading are
 * skipped when the backend (tcp://127.0.0.1:2000) does not answer.
 */
import { Dealer } from 'zeromq';
import { encode, decode } from '@msgpack/msgpack';
import { BSON, GridFSBucket, type Db } from 'mongodb';
import type { Page } from '@playwright/test';
import { test, expect, installCourse, withDb, createSessionCookie } from '../fixtures.js';
import { E2E } from '../setup-data.js';

const C = installCourse('task_showcase');

/**
 * True when the grading backend answers a ClientHello on the address of
 * e2e/config.yaml, resolved like the app does (zeromq, IPv6 enabled).
 */
const backendUp = (async () => {
	const dealer = new Dealer({ ipv6: true, linger: 0, receiveTimeout: 3000 });
	dealer.connect(process.env.E2E_BACKEND ?? 'tcp://127.0.0.1:2000');
	try {
		await dealer.send(encode({ name: 'e2e-probe', '@type': 'ClientHello' }));
		const [frame] = await dealer.receive();
		return Object.keys((decode(frame) as { available_environments?: object }).available_environments ?? {}).length > 0;
	} catch {
		return false;
	} finally {
		dealer.close();
	}
})();
/** Skips the current test when grading is impossible. */
async function needsBackend() {
	test.skip(!(await backendUp), 'grading backend (tcp://127.0.0.1:2000) is down');
}

let counter = 0;
/** Creates registered students with unique names (password "superadmin"). */
async function students(n = 1, registered = true): Promise<string[]> {
	const names = Array.from({ length: n }, () => `task_${process.pid}_${Date.now() % 1e6}_${++counter}`);
	await withDb(async (db) => {
		await db.collection('users').insertMany(
			names.map((username) => ({
				username,
				realname: username,
				email: `${username}@x.org`,
				password: E2E.passwordHash,
				bindings: {},
				language: 'en',
				code_indentation: '4',
				tos_accepted: true
			}))
		);
		if (registered)
			await db
				.collection('courses')
				.updateOne({ _id: C as never }, { $push: { students: { $each: names } } as never }, { upsert: true });
	});
	return names;
}

/** Submissions of a user for a task, oldest first. */
const submissionsOf = (username: string, taskid: string) =>
	withDb((db) =>
		db.collection('submissions').find({ courseid: C, taskid, username }).sort({ submitted_on: 1 }).toArray()
	);

/** Decoded GridFS input of a submission. */
async function inputOf(db: Db, id: unknown): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const c of new GridFSBucket(db).openDownloadStream(id as never)) chunks.push(c as Buffer);
	return BSON.deserialize(Buffer.concat(chunks), { promoteBuffers: true });
}

const url = (task: string) => `/course/${C}/${task}`;

/** Opens a task page and waits until it is interactive (hydrated). */
async function open(page: Page, task: string) {
	await page.goto(url(task));
	await page.locator('form[data-ready]').waitFor();
}

test('TASK-01 a registered student opens a task: statement, information and history', async ({ loginAs }) => {
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'code_python');
	await expect(page.getByRole('heading', { name: 'Python code - count to n' })).toBeVisible();
	await expect(page.getByText('INGInious test-suite')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Contact link' })).toHaveAttribute(
		'href',
		`mailto:teacher@example.org?subject=${C}/code_python/${me}`
	);
	await expect(page.getByTestId('task-status')).toHaveText('Not yet attempted');
	await expect(page.getByText('No deadline')).toBeVisible();
	await expect(page.getByText('cat_basics', { exact: true })).toBeVisible();
	await expect(page.getByText(/No submission yet/)).toBeVisible();
	await expect(page.getByRole('link', { name: 'Next task' })).toHaveAttribute('href', url('single_line'));
	const ut = await withDb((db) =>
		db.collection('user_tasks').find({ username: me, courseid: C, taskid: 'code_python' }).toArray()
	);
	expect(ut).toHaveLength(1);
	expect(ut[0]).toMatchObject({ tried: 0, grade: 0, submissionid: null, state: '', random: [] });
});

test('TASK-01 unregistered users are sent to the registration, anonymous ones to the sign-in', async ({
	loginAs,
	page
}) => {
	await page.goto(url('mcq_single'));
	await expect(page).toHaveURL(/\/signin/);
	const [me] = await students(1, false);
	await (await loginAs(me)).goto(url('mcq_single'));
	await expect(page).toHaveURL(new RegExp(`/register/${C}`));
});

test('TASK-02 code problems use an editor pre-filled with the default code', async ({ loginAs }) => {
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'code_python');
	await expect(page.locator('.cm-content')).toContainText('def count_to(n):');
	await expect(page.locator('input[name=code]')).toHaveValue(/def count_to/);
});

test('TASK-03 single-line problems are pre-filled and validated client-side', async ({ loginAs }) => {
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'single_line');
	await expect(page.getByRole('textbox', { name: /A word/ })).toHaveValue('hel');
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.getByText('Please answer to all the questions.')).toBeVisible();
	expect(await submissionsOf(me, 'single_line')).toHaveLength(0);
});

test('TASK-04 a file is uploaded, stored in the input and downloadable by its owner only', async ({
	loginAs,
	browser,
	baseURL
}) => {
	const [me, other] = await students(2);
	const page = await loginAs(me);
	await open(page, 'file_upload');
	await expect(page.getByText('Allowed extensions: .txt, .py')).toBeVisible();
	await page
		.locator('input[type=file]')
		.setInputFiles({ name: 'my report.txt', mimeType: 'text/plain', buffer: Buffer.from('INGInious\nhello\n') });
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.locator('#task-result')).toBeVisible();
	const [sub] = await submissionsOf(me, 'file_upload');
	const input = await withDb((db) => inputOf(db, sub.input));
	expect(input.upload).toEqual({ filename: 'my report.txt', value: Buffer.from('INGInious\nhello\n') });
	await page.getByTestId('history').locator(`[data-submission="${sub._id}"]`).click();
	const link = page.getByRole('link', { name: /download the file you submitted previously/ });
	await expect(link).toHaveAttribute('href', `${url('file_upload')}/$input/${sub._id}/upload`);
	const response = await page.request.get(`${url('file_upload')}/$input/${sub._id}/upload`);
	expect(await response.text()).toBe('INGInious\nhello\n');
	expect(response.headers()['content-disposition']).toContain('attachment');
	const ctx = await browser.newContext({ baseURL });
	await ctx.addCookies([{ name: 'inginious_session_id', value: await createSessionCookie(other), url: baseURL! }]);
	expect((await ctx.request.get(`${url('file_upload')}/$input/${sub._id}/upload`)).status()).toBe(404);
	await ctx.close();
});

test('TASK-04 wrong extensions are refused by the browser and the server', async ({ loginAs }) => {
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'file_upload');
	await page
		.locator('input[type=file]')
		.setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') });
	await expect(page.getByText('File "a.pdf" has an unsupported type.')).toBeVisible();
	const res = await page.request.post(url('file_upload'), {
		headers: { accept: 'application/json', origin: new URL(page.url()).origin },
		multipart: { '@action': 'submit', upload: { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') } }
	});
	expect((await res.json()).text).toMatch(/^Please answer to all the questions and verify/);
	expect(await submissionsOf(me, 'file_upload')).toHaveLength(0);
});

test('TASK-05 multiple choices are limited and shuffled per user, stable on reload', async ({ loginAs }) => {
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'mcq_single');
	const radios = page.getByRole('radio');
	await expect(radios).toHaveCount(3);
	await expect(page.getByRole('radio', { name: 'Brussels' })).toBeVisible();
	const order = await page.locator('[data-problem=capital] label').allTextContents();
	await page.reload();
	expect(await page.locator('[data-problem=capital] label').allTextContents()).toEqual(order);
	await open(page, 'mcq_multiple');
	await expect(page.getByRole('checkbox')).toHaveCount(4);
});

test('TASK-06 match problems are text inputs sent untrimmed', async ({ loginAs }) => {
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'match_answer');
	await page.getByRole('textbox', { name: /The answer/ }).fill('42 ');
	await page.getByRole('textbox', { name: /City of light/ }).fill('Paris');
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.locator('#task-result')).toBeVisible();
	const [sub] = await submissionsOf(me, 'match_answer');
	expect(await withDb((db) => inputOf(db, sub.input))).toMatchObject({ answer: '42 ', city: 'Paris' });
});

test('TASK-07 the mcq agent grades a quiz', async ({ loginAs }) => {
	await needsBackend();
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'mcq_single');
	await page.getByRole('radio', { name: 'Brussels' }).check();
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.getByText('Your answer passed the tests! Your score is 100%.')).toBeVisible();
	await expect(page.getByText('Brussels is the capital since 1830.')).toBeVisible();
	const [sub] = await submissionsOf(me, 'mcq_single');
	expect(sub).toMatchObject({ status: 'done', result: 'success', grade: 100, state: '{"capital": ""}' });
});

test('TASK-08 CORE-08 a submission stores the legacy document and input metadata', async ({ loginAs }) => {
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'mcq_multiple');
	await page.getByRole('checkbox').first().check();
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.locator('#task-result')).toBeVisible();
	const [sub] = await submissionsOf(me, 'mcq_multiple');
	expect(sub).toMatchObject({ courseid: C, taskid: 'mcq_multiple', username: [me], response_type: 'rst' });
	const input = await withDb((db) => inputOf(db, sub.input));
	expect(input).toMatchObject({
		'@username': me,
		'@email': `${me}@x.org`,
		'@lang': 'en',
		'@attempts': '1',
		'@random': [],
		'@state': ''
	});
	expect(input.primes).toEqual(['0']);
});

test('TASK-09 the result card is shown when grading ends (crash when no agent)', async ({ loginAs }) => {
	// Deterministic: no backend provides docker/doesnotexist, so the job ends at once as a crash.
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'no_env');
	await page.getByRole('radio').first().check();
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.locator('#task-result')).toContainText('An internal error occurred');
	await expect(page.getByText('Environment not available.')).toBeVisible();
	await expect(page.getByTestId('task-tries')).toHaveText('1');
	const [sub] = await submissionsOf(me, 'no_env');
	expect(sub).toMatchObject({ status: 'error', result: 'crash' });
	expect(sub).not.toHaveProperty('jobid');
});

test('TASK-10 the history lists submissions and reloads old answers', async ({ loginAs }) => {
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'match_answer');
	for (const answer of ['1', '2']) {
		await page.getByRole('textbox', { name: /The answer/ }).fill(answer);
		await page.getByRole('textbox', { name: /City of light/ }).fill('x');
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();
	}
	const subs = await submissionsOf(me, 'match_answer');
	expect(subs).toHaveLength(2);
	await page.reload();
	await expect(page.getByTestId('history').locator('li')).toHaveCount(2);
	// Like legacy, a reload shows no submission until one is chosen in the history.
	await expect(page.getByTestId('displayed')).toHaveCount(0);
	await expect(page.locator('#task-result')).toHaveCount(0);
	const first = page.getByTestId('history').locator(`[data-submission="${subs[0]._id}"]`);
	await first.click();
	await expect(page.getByRole('textbox', { name: /The answer/ })).toHaveValue('1');
	// The displayed submission is marked in the history and its date heads the result card.
	await expect(first).toHaveAttribute('aria-current', 'true');
	await expect(first.getByTestId('displayed')).toHaveText('Displayed');
	await expect(page.getByTestId('result-date')).toContainText('Submitted on');
	// Another student cannot load it.
	const res = await page.request.post(url('match_answer'), {
		headers: { accept: 'application/json', origin: new URL(page.url()).origin },
		multipart: { '@action': 'load', submissionid: 'ffffffffffffffffffffffff' }
	});
	expect(res.status()).toBe(404);
});

test('TASK-11 a running submission can be killed', async ({ loginAs }) => {
	await needsBackend();
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'outcomes');
	await page.getByRole('textbox', { name: /Mode/ }).fill('sleep');
	await page.getByRole('button', { name: 'Submit' }).click();
	await page.getByRole('button', { name: 'Kill' }).click();
	await expect(page.getByText('Your submission was killed.')).toBeVisible({ timeout: 30_000 });
});

test('TASK-12 CORE-07 only course admins get the SSH debug button', async ({ loginAs }) => {
	const [me] = await students();
	let page = await loginAs(me);
	await open(page, 'outcomes');
	await expect(page.getByText('Staff tools')).toHaveCount(0);
	page = await loginAs('e2e_admin');
	await open(page, 'outcomes');
	await page.getByText('Staff tools').click();
	await expect(page.getByRole('button', { name: 'SSH debug' })).toBeVisible();
	if (!(await backendUp)) return;
	await page.getByRole('textbox', { name: /Mode/ }).fill('success');
	await page.getByRole('button', { name: 'SSH debug' }).click();
	await expect(page.getByText(/ssh worker@/)).toBeVisible({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Kill' }).click();
});

test('TASK-13 the evaluation mode decides the evaluated submission', async ({ loginAs }) => {
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'eval_last');
	await page.getByRole('radio').first().check();
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();
	const [sub] = await submissionsOf(me, 'eval_last');
	await expect
		.poll(() =>
			withDb((db) => db.collection('user_tasks').findOne({ username: me, taskid: 'eval_last' })).then((u) =>
				String(u?.submissionid)
			)
		)
		.toBe(String(sub._id));
	await page.reload();
	await expect(page.getByTestId('evaluated')).toHaveText(/Last submission/);
	// The grade box says which submission it comes from; the reloaded evaluated one is marked.
	await expect(page.getByTestId('grade-source')).toHaveText('Grade of your last submission');
	await page.getByTestId('history').locator(`[data-submission="${sub._id}"]`).click();
	await expect(page.getByTestId('result-date').getByText('Last submission')).toBeVisible();
});

test('TASK-14 the submission limit blocks students', async ({ loginAs }) => {
	const [me] = await students();
	await withDb((db) =>
		db.collection('user_tasks').insertOne({
			courseid: C,
			taskid: 'limited_amount',
			username: me,
			grade: 0,
			submissionid: null,
			succeeded: false,
			tried: 2,
			random: [],
			tokens: { amount: 2 },
			state: ''
		})
	);
	const page = await loginAs(me);
	await open(page, 'limited_amount');
	await expect(page.getByRole('button', { name: 'You have reached the submission limit.' })).toBeDisabled();
	await expect(page.getByText('0 submissions left (2 submissions)')).toBeVisible();
	const res = await page.request.post(url('limited_amount'), {
		headers: { accept: 'application/json', origin: new URL(page.url()).origin },
		multipart: { '@action': 'submit', q: '0' }
	});
	expect((await res.json()).text).toBe('You are not allowed to submit for this task.');
	await open(page, 'limited_period');
	await expect(page.getByText(/1 submissions every 1 hour\(s\)/)).toBeVisible();
});

test('TASK-15 only the stored-submissions limit is kept', async ({ loginAs }) => {
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'stored_two');
	for (let i = 0; i < 3; i++) {
		await page.getByRole('radio').first().check();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();
	}
	expect(await submissionsOf(me, 'stored_two')).toHaveLength(2);
	await expect(page.getByTestId('history').locator('li')).toHaveCount(2);
});

test('TASK-16 a group member submits for the whole group', async ({ loginAs }) => {
	const [a, b, lonely] = await students(3);
	await withDb((db) =>
		db
			.collection('groups')
			.insertOne({ courseid: C, description: `Team ${a}`, size: 2, students: [a, b], audiences: [] })
	);
	let page = await loginAs(lonely);
	await open(page, 'group_task');
	await expect(page.getByRole('button', { name: 'Please register in a group' })).toBeDisabled();
	page = await loginAs(a);
	await open(page, 'group_task');
	await expect(page.getByRole('link', { name: `Group: Team ${a}` })).toBeVisible();
	await page.getByRole('radio').first().check();
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();
	const [sub] = await submissionsOf(b, 'group_task');
	expect(sub.username).toEqual([a, b]);
	expect(await withDb((db) => inputOf(db, sub.input))).toMatchObject({ '@username': `${a},${b}` });
});

test('TASK-17 random inputs are stable, stored and checked', async ({ loginAs }) => {
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'random_inputs');
	const values = await page
		.locator('input[name^="@random_"]')
		.evaluateAll((els) => els.map((e) => Number((e as HTMLInputElement).value)));
	expect(values).toHaveLength(2);
	const ut = await withDb((db) => db.collection('user_tasks').findOne({ username: me, taskid: 'random_inputs' }));
	expect(ut?.random).toEqual(values);
	await page.reload();
	expect(await page.locator('input[name="@random_0"]').inputValue()).toBe(String(values[0]));
	const res = await page.request.post(url('random_inputs'), {
		headers: { accept: 'application/json', origin: new URL(page.url()).origin },
		multipart: { '@action': 'submit', sum: '1', '@random_0': '0.1', '@random_1': '0.2' }
	});
	expect((await res.json()).text).toBe('Your task has been regenerated. This current task is outdated.');
});

test('TASK-18 accessibility: hidden tasks, closed tasks and soft deadlines', async ({ loginAs }) => {
	const [me] = await students();
	let page = await loginAs(me);
	expect((await page.goto(url('future_task')))?.status()).toBe(403);
	await open(page, 'closed_task');
	await expect(page.getByRole('button', { name: 'The deadline is over, you cannot submit anymore' })).toBeDisabled();
	await open(page, 'soft_deadline');
	await expect(page.getByTestId('deadline').locator('.badge')).toHaveClass(/error/);
	await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();
	page = await loginAs('e2e_tutor');
	await open(page, 'future_task');
	await expect(page.getByText(/This task is currently invisible for students/)).toBeVisible();
	await page.getByText('Staff tools').click();
	await expect(page.getByRole('link', { name: 'View submissions' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Edit task' })).toHaveCount(0);
});

test('TASK-19 statements are rendered from RST', async ({ loginAs }) => {
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'rich_feedback');
	await expect(page.getByText('A note with a title (card)')).toBeVisible();
	await expect(page.locator('table').first()).toContainText('col A');
});

test('TASK-19 tables scroll inside their box on a 390 px screen instead of overflowing the page', async ({
	loginAs
}) => {
	const [me] = await students();
	const page = await loginAs(me);
	await page.setViewportSize({ width: 390, height: 844 });
	await open(page, 'rich_feedback');
	const box = page.locator('article .table-scroll').first();
	await expect(box.locator('table')).toContainText('col A');
	expect(await box.evaluate((e) => getComputedStyle(e).overflowX)).toBe('auto');
	const [boxRight, articleRight, pageWidth] = await box.evaluate((e) => [
		e.getBoundingClientRect().right,
		e.closest('article')!.getBoundingClientRect().right,
		document.documentElement.scrollWidth
	]);
	expect(boxRight).toBeLessThanOrEqual(articleRight);
	expect(pageWidth).toBeLessThanOrEqual(390);
});

// Regression: the simple table of rich_feedback used to fail to parse, and the fallback then
// leaked the future hidden-until block (fixed in lib/server/text).
test('TASK-19 graded rich feedback hides future hidden-until blocks from students', async ({ loginAs }) => {
	await needsBackend();
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'rich_feedback');
	for (const box of await page.getByRole('textbox').all()) await box.fill('x');
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.getByText('PAST-HIDDEN-UNTIL', { exact: false })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText('FUTURE-HIDDEN-UNTIL', { exact: false })).toHaveCount(0);
});

test('TASK-20 visible tags are shown after grading', async ({ loginAs }) => {
	await needsBackend();
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'code_python');
	await page
		.locator('.cm-content')
		.fill(
			'def count_to(n):\n    result = []\n    for i in range(1, n + 1):\n        result.append(i)\n    return result\n'
		);
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.getByText('Loops').first()).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText('Hidden skill')).toHaveCount(0);
});

test('TASK-21 admins see the raw debug information of a submission', async ({ loginAs }) => {
	const page = await loginAs('e2e_admin');
	await open(page, 'mcq_single');
	await page.getByRole('radio').first().check();
	await page.getByRole('button', { name: 'Submit' }).click();
	await page.getByText('Debug information').click();
	await expect(page.getByTestId('debug-info')).toContainText('courseid');
	const [me] = await students();
	const student = await loginAs(me);
	await open(student, 'mcq_single');
	await student.getByRole('radio').first().check();
	await student.getByRole('button', { name: 'Submit' }).click();
	await expect(student.locator('#task-result')).toBeVisible();
	await expect(student.getByTestId('debug-info')).toHaveCount(0);
});

test('TASK-22 public task files are served, private ones are not', async ({ loginAs }) => {
	const [me] = await students();
	const page = await loginAs(me);
	const get = (path: string) => page.request.get(`${url('task_info')}/${path}`);
	const hello = await get('hello.txt');
	expect(hello.status()).toBe(200);
	expect(hello.headers()['content-type']).toBe('text/plain');
	expect((await get('sub/data.json')).headers()['content-type']).toBe('application/json');
	expect((await get('pixel.svg')).headers()['content-security-policy']).toContain('sandbox');
	expect((await page.request.get(`/course/${C}/$common/common.txt`)).status()).toBe(200);
	for (const bad of ['sub', 'secret.txt', '..%2fsecret.txt', '%2e%2e/secret.txt'])
		expect((await get(bad)).status()).toBe(404);
	expect((await page.request.get(`${url('future_task')}/x.txt`)).status()).toBe(403);
});

test('TASK-23 staff download the grading archive', async ({ loginAs }) => {
	await needsBackend();
	const [me] = await students();
	const page = await loginAs(me);
	await open(page, 'archive_task');
	await page.getByRole('textbox').first().fill('report');
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled({ timeout: 30_000 });
	const [sub] = await submissionsOf(me, 'archive_task');
	expect(sub.archive).toBeTruthy();
	expect((await page.request.get(`${url('archive_task')}/$archive/${sub._id}`)).status()).toBe(403);
	const tutor = await loginAs('e2e_tutor');
	const res = await tutor.request.get(`${url('archive_task')}/$archive/${sub._id}`);
	expect([...(await res.body()).subarray(0, 2)]).toEqual([0x1f, 0x8b]);
});

test('TASK-25 waiting submissions of another frontend are followed, not errored', async ({ loginAs }) => {
	// Start-up recovery runs when the server starts (hooks.server.ts init), i.e. before this
	// submission is inserted: a submission of another frontend must keep being followed.
	const [me] = await students();
	await withDb(async (db) => {
		const input = new GridFSBucket(db).openUploadStream('');
		input.end(BSON.serialize({ capital: '0' }));
		await new Promise((r) => input.on('finish', r));
		await db.collection('submissions').insertOne({
			courseid: C,
			taskid: 'mcq_single',
			username: [me],
			input: input.id,
			status: 'waiting',
			submitted_on: new Date(),
			grade: 0,
			jobid: 'other-frontend-job'
		});
	});
	const page = await loginAs(me);
	await open(page, 'mcq_single');
	await expect(page.getByText(/Your submission has been sent/)).toBeVisible();
	await page.waitForTimeout(1500);
	const [sub] = await submissionsOf(me, 'mcq_single');
	expect(sub.status).toBe('waiting');
});
