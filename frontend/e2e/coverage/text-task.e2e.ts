/**
 * Integration coverage of the rich text renderer (RST / `#MD` Markdown, TASK-19)
 * and of the less common task page paths (feedback shapes, result kinds, tags,
 * SSH panel, crafted action requests), on the course fixture `cov_text`
 * (course `e2e_cov_text`). rst_gallery / md_gallery hold one problem header per
 * golden example of tests/fixtures/rst. Submissions are inserted directly in the
 * database so that the feedback is deterministic (no grading needed).
 */
import { BSON, GridFSBucket, ObjectId } from 'mongodb';
import type { Page } from '@playwright/test';
import { Dealer } from 'zeromq';
import { encode, decode } from '@msgpack/msgpack';
import { test, expect, installCourse, withDb } from '../fixtures.js';
import { E2E } from '../setup-data.js';

const C = installCourse('cov_text');
const url = (task: string) => `/course/${C}/${task}`;

/** True when the grading backend answers (same probe as e2e/task). */
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
	test.skip(!(await backendUp), 'grading backend is down');
}

let counter = 0;
/** Creates a registered student with a unique name (password "superadmin"). */
async function student(): Promise<string> {
	const username = `cov_${process.pid}_${Date.now() % 1e6}_${++counter}`;
	await withDb(async (db) => {
		await db.collection('users').insertOne({
			username,
			realname: username,
			email: `${username}@x.org`,
			password: E2E.passwordHash,
			bindings: {},
			language: 'en',
			code_indentation: '4',
			tos_accepted: true
		});
		await db
			.collection('courses')
			.updateOne({ _id: C as never }, { $push: { students: username } as never }, { upsert: true });
	});
	return username;
}

/** Inserts a submission of `username` for task `feedback` (input stored in GridFS) and returns its id. */
async function insertSubmission(username: string, fields: Record<string, unknown>): Promise<string> {
	return withDb(async (db) => {
		const upload = new GridFSBucket(db).openUploadStream('');
		upload.end(BSON.serialize({ one: 'x', two: ['0'], '@random': [] }));
		await new Promise((r) => upload.on('finish', r));
		const { insertedId } = await db.collection('submissions').insertOne({
			courseid: C,
			taskid: 'feedback',
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

/** Opens a task page and waits until it is interactive (hydrated). */
async function open(page: Page, task: string) {
	await page.goto(url(task));
	await page.locator('form[data-ready]').waitFor();
}

/** Selects a submission of the history and waits for its result card. */
async function select(page: Page, id: string) {
	await page.getByTestId('history').locator(`[data-submission="${id}"]`).click();
	await expect(page.locator('#task-result')).toContainText(`Submission #${id}`);
}

/** POSTs a JSON action to a task page. */
const post = (page: Page, task: string, multipart: Record<string, string>) =>
	page.request.post(url(task), {
		headers: { accept: 'application/json', origin: new URL(page.url()).origin },
		multipart
	});

test('TASK-19 every RST construct of the golden examples is rendered in problem headers', async ({ loginAs }) => {
	const page = await loginAs(await student());
	await open(page, 'rst_gallery');
	const card = (id: string) => page.locator(`[data-problem="${id}"]`);
	await expect(card('grid_table').locator('table')).toBeVisible();
	await expect(card('simple_table').locator('thead')).toBeVisible();
	await expect(card('list_table').locator('table')).toBeVisible();
	await expect(card('csv_table').locator('table')).toBeVisible();
	await expect(card('note').locator('.alert')).toBeVisible();
	await expect(card('tip_titled').locator('.card-header')).toBeVisible();
	await expect(card('definition_list').locator('dl')).toBeVisible();
	await expect(card('footnote').locator('a.footnote-reference')).toBeVisible();
	await expect(card('figure').locator('img')).toHaveCount(1);
	await expect(card('time_role').locator('time')).toHaveAttribute('title', /\d{4}-/);
	await expect(card('external_link').locator('a').first()).toHaveAttribute('target', '_blank');
	await expect(card('syntax_error_unknown_directive')).toContainText('Unknown directive type');
	await expect(card('severe_error_inconsistent_titles_excepti')).toContainText('Parsing failed');
	await expect(card('hidden_until_future')).toContainText('A part of this feedback is hidden until');
	await expect(card('hidden_until_bad_date')).toContainText('Unknown date format');
	await expect(card('hidden_until_bad_date')).not.toContainText('secret');
	await expect(card('math_role').locator('.katex').first()).toBeVisible();
	await expect(card('code_block_lang').locator('pre.hljs')).toBeVisible();
	await expect(card('raw_html')).not.toContainText('<');
});

test('TASK-19 #MD texts are rendered as Markdown (GFM tables, alerts, code, math)', async ({ loginAs }) => {
	const page = await loginAs(await student());
	await open(page, 'md_gallery');
	const card = (id: string) => page.locator(`[data-problem="${id}"]`);
	await expect(card('gfm_table').locator('table thead')).toBeVisible();
	await expect(card('github_alert_warning').locator('.alert-warning')).toBeVisible();
	await expect(card('github_alert_note').locator('.alert')).toBeVisible();
	await expect(card('fenced_code').locator('pre.hljs')).toBeVisible();
	await expect(card('math_inline').locator('.katex').first()).toBeVisible();
	await expect(card('math_block_brackets').locator('.katex-display')).toBeVisible();
	await expect(card('strikethrough').locator('s')).toBeVisible();
	await expect(card('headings_start_at_h3').locator('h3')).toBeVisible();
	// The statement of `feedback` is Markdown too, MCQ choices carry their own marker.
	await open(page, 'feedback');
	await expect(page.getByRole('article').locator('table')).toBeVisible();
	await expect(page.locator('[data-problem="two"] strong')).toHaveText('Yes');
});

test('TASK-09 TASK-19 feedback of every shape and result kind is rendered', async ({ loginAs }) => {
	const me = await student();
	const ids = {
		rst: await insertSubmission(me, {
			text: '.. note:: Global **RST** feedback.\n\n.. hidden-until:: 2099-01-01 00:00:00\n\n   SECRET',
			problems: { one: ['success', 'Problem *one* ok'], two: 'old string feedback' },
			tests: { skill_ok: true, mis_bad: true, skill_hidden: true, '*auto-tag-1': 'an automatic tag with a long text' }
		}),
		md: await insertSubmission(me, {
			result: 'failed',
			grade: 50,
			text: '#MD\n> [!CAUTION]\n> Markdown **feedback**',
			problems: { one: ['failed', '#MD *md problem*'], two: { bad: 'format' } }
		}),
		timeout: await insertSubmission(me, { status: 'error', result: 'timeout', grade: 0 }),
		overflow: await insertSubmission(me, { status: 'error', result: 'overflow', grade: 0 }),
		killed: await insertSubmission(me, { status: 'error', result: 'killed', grade: 0 }),
		crash: await insertSubmission(me, { status: 'error', result: 'crash', grade: 0, text: null }),
		odd: await insertSubmission(me, { status: 'error', result: 'unheard-of', grade: 0 })
	};
	const page = await loginAs(me);
	await open(page, 'feedback');
	await expect(page.locator(`[data-submission="${ids.odd}"]`)).toContainText('unheard-of');
	await select(page, ids.rst);
	await expect(page.locator('#task-result')).toContainText('Your answer passed the tests! Your score is 100%.');
	await expect(page.locator('#task-result .alert-light')).toContainText('Global RST feedback.');
	await expect(page.locator('#task-result')).toContainText('A part of this feedback is hidden until');
	await expect(page.locator('#task-result')).not.toContainText('SECRET');
	await expect(page.locator('#task-result')).toContainText('Good skill');
	await expect(page.locator('#task-result')).toContainText('Misconception');
	await expect(page.locator('#task-result')).not.toContainText('Hidden skill');
	await expect(page.locator('#task-result')).not.toContainText('automatic');
	await expect(page.locator('[data-problem="one"]')).toContainText('Problem one ok');
	await expect(page.locator('[data-problem="two"]')).toContainText('old string feedback');
	await page.locator('[data-problem="two"]').getByRole('button', { name: 'Close' }).click();
	await expect(page.locator('[data-problem="two"]')).not.toContainText('old string feedback');
	await select(page, ids.md);
	await expect(page.locator('#task-result')).toContainText('There are some errors in your answer. Your score is 50%.');
	await expect(page.locator('#task-result .alert-danger strong')).toHaveText('feedback');
	await expect(page.locator('[data-problem="one"] em')).toHaveText('md problem');
	await expect(page.locator('[data-problem="two"]')).toContainText('Feedback is badly formatted.');
	for (const [id, title] of [
		[ids.timeout, 'Your submission timed out.'],
		[ids.overflow, 'Your submission made an overflow.'],
		[ids.killed, 'Your submission was killed.'],
		[ids.crash, 'An internal error occurred.']
	]) {
		await select(page, id);
		await expect(page.locator('#task-result header')).toContainText(title);
	}
	// Staff see the hidden-until block (with the caution), the hidden tag and the auto-tag.
	const admin = await loginAs('e2e_admin');
	const res = await post(admin, 'feedback', { '@action': 'check', submissionid: ids.rst });
	const json = await res.json();
	expect(json.submission.text).toContain('SECRET');
	expect(Object.keys(json.submission.tests)).toContain('*auto-tag-1');
});

test('TASK-12 TASK-09 a waiting SSH submission shows the connection instructions', async ({ loginAs }) => {
	const me = await student();
	const id = await insertSubmission(me, {
		status: 'waiting',
		result: 'crash',
		jobid: 'unknown-job',
		ssh_host: 'ssh.example.org',
		ssh_port: 2222,
		ssh_user: 'worker',
		ssh_password: 's3cret'
	});
	const page = await loginAs(me);
	await open(page, 'feedback');
	await expect(page.getByTestId('ssh-panel')).toContainText('ssh worker@ssh.example.org -p 2222');
	await expect(page.getByTestId('ssh-panel')).toContainText('s3cret');
	await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled();
	await withDb((db) =>
		db.collection('submissions').updateOne({ _id: new ObjectId(id) }, { $set: { status: 'done', result: 'success' } })
	);
	await expect(page.locator('#task-result header')).toContainText('Your answer passed the tests!');
});

test('TASK-08 crafted action requests are rejected', async ({ loginAs }) => {
	const me = await student();
	const page = await loginAs(me);
	await open(page, 'feedback');
	expect((await post(page, 'feedback', { '@action': 'nonsense' })).status()).toBe(400);
	expect((await post(page, 'feedback', { '@action': 'check', submissionid: 'not-an-id' })).status()).toBe(404);
	expect(await (await post(page, 'feedback', { '@action': 'kill', submissionid: 'zzz' })).json()).toEqual({
		status: 'done',
		killed: false
	});
	// Invalid answers: a choice index out of range, a missing match answer.
	for (const body of [{ one: 'x', two: '9' }, { two: '0' }])
		expect((await (await post(page, 'feedback', { '@action': 'submit', ...body })).json()).text).toMatch(
			/^Please answer to all the questions/
		);
});

test('TASK-10 the answers are saved and restored from the browser storage', async ({ loginAs }) => {
	const page = await loginAs(await student());
	await open(page, 'feedback');
	await page.getByRole('button', { name: 'Load my work from memory' }).click();
	await expect(page.getByText('Nothing saved for this task.')).toBeVisible();
	await page.getByRole('textbox').first().fill('saved answer');
	await page.getByRole('button', { name: 'Save my work in memory' }).click();
	await page.getByRole('textbox').first().fill('changed');
	await page.getByRole('button', { name: 'Load my work from memory' }).click();
	await expect(page.getByRole('textbox').first()).toHaveValue('saved answer');
	// A corrupted storage entry is ignored.
	await page.evaluate((key) => localStorage.setItem(key, '{broken'), `${C}/feedback`);
	await page.getByRole('button', { name: 'Load my work from memory' }).click();
	await expect(page.getByText('Nothing saved for this task.').first()).toBeVisible();
});

test('TASK-19 RST and Markdown constructs missing from the golden examples', async ({ loginAs }) => {
	const page = await loginAs(await student());
	await open(page, 'rst_extra');
	const card = (id: string) => page.locator(`[data-problem="${id}"]`);
	const random = await page
		.locator('input[name^="@random_"]')
		.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
	await expect(card('random_rst').locator('.rnd')).toHaveText(`${random[0]}|${random.join(',')}`);
	await expect(card('field_list').locator('table.field-list')).toBeVisible();
	await expect(card('attribution').locator('.attribution')).toContainText('Somebody');
	await expect(card('table_directive').locator('caption')).toHaveText('Caption');
	await expect(card('table_directive_empty')).toContainText('exactly one table expected');
	await expect(card('grid_spans').locator('[colspan="2"]')).toBeVisible();
	await expect(card('classifier').locator('.classifier')).toHaveText('classifier');
	await expect(card('list_table_options').locator('thead')).toContainText('H1');
	await expect(card('list_table_empty')).toContainText('content required');
	await expect(card('csv_header').locator('tbody')).toContainText('two, quoted');
	await expect(card('csv_empty')).toContainText('No table data');
	await expect(card('admonition_plain').locator('.admonition-my-own-title')).toBeVisible();
	await expect(card('hidden_until_empty')).toContainText('Content block expected');
	for (const id of ['hidden_until_eu', 'hidden_until_offset', 'hidden_until_zulu'])
		await expect(card(id)).toContainText(id.slice(13).toUpperCase());
	await expect(card('hidden_until_invalid')).toContainText('Unknown date format');
	await expect(card('code_empty')).toContainText('Content block expected');
	await expect(card('image_options').locator('img.thumb')).toHaveAttribute('alt', 'tiny');
	await expect(card('image_bad_data').locator('img')).not.toHaveAttribute('src');
	await expect(card('figure_legend').locator('.legend')).toHaveText('The legend.');
	await expect(card('substitution_image').locator('img')).toHaveAttribute('src', 'logo.png');
	await expect(card('substitution_raw').locator('br')).toHaveCount(1);
	await expect(card('footnote_twice').locator('a.footnote-reference')).toHaveCount(2);
	await expect(card('custom_roles').locator('span.custom')).toHaveText('styled');
	await expect(card('unknown_role').locator('.problematic')).toBeVisible();
	await expect(card('unknown_role')).toContainText('Unknown interpreted text role');
	await expect(card('rubric')).toContainText('A rubric');
	await expect(card('code_extra_languages').locator('pre.hljs')).toHaveCount(9);
	await expect(card('bare_literal')).toContainText('LITERAL-ONLY');
	await expect(card('bare_literal')).not.toContainText('::');
	await expect(card('header_only_tables').locator('thead')).toHaveCount(2);
	await expect(card('header_only_tables').locator('tbody')).toHaveCount(0);
	await expect(card('list_table_plain_rows').locator('tr')).toHaveCount(2);
	await expect(card('role_without_name')).toContainText('Text.');
	await expect(card('compound_literal').locator('.compound.extra')).toContainText('Compound body.');
	await expect(card('compound_literal').locator('code.literal')).toBeVisible();
	await expect(card('compound_literal').locator('span.target')).toHaveText('inline target');
	await expect(card('img_without_src').locator('img')).toHaveAttribute('alt', 'no source');
	for (const text of ['MINUS-OFFSET', 'SHORT-OFFSET', 'EU-NO-TIME', 'EU-SECONDS'])
		await expect(card('more_dates')).toContainText(text);
	await expect(card('more_dates')).toContainText('Unknown date format');
	await expect(card('fallback_hidden')).toContainText('Parsing failed');
	await expect(card('fallback_hidden')).not.toContainText('SECRET-IN-FALLBACK');
	await open(page, 'md_extra');
	await expect(card('random_md').locator('.rnd')).toHaveText(
		await page.locator('input[name="@random_1"]').inputValue()
	);
	await expect(card('dollar_space').locator('.katex')).toHaveCount(3);
	await expect(card('math_in_link').locator('a .katex')).toHaveCount(2);
	await expect(card('alert_inline').locator('.alert-info')).toHaveText('same line tip');
	await expect(card('alert_empty').locator('.alert-light')).toBeVisible();
	await expect(card('alert_unknown').locator('blockquote')).toBeVisible();
	await expect(card('block_math_multiline').locator('.katex-display')).toBeVisible();
	await expect(card('paragraph_then_math').locator('.katex-display')).toBeVisible();
});

test('TASK-02 code editors load every language, file and long choice lists render', async ({ loginAs }) => {
	const page = await loginAs(await student());
	await open(page, 'editors');
	await expect(page.locator('.cm-editor')).toHaveCount(25);
	await expect(page.locator('[data-problem="many"] input[type=radio]')).toHaveCount(520);
	await page.waitForLoadState('networkidle');
	// The file problem is mandatory: the browser refuses to submit without it.
	await page.locator('[data-problem="many"] input[type=radio]').first().check();
	await page.keyboard.press('Control+Enter');
	await expect(page.getByText('Please answer to all the questions.')).toBeVisible();
	// File selection: size limit, then a valid file dropped on the zone.
	const upload = page.locator('[data-problem="upload"]');
	await expect(upload).toContainText('Maximum size: 10 B.');
	await upload
		.locator('input[type=file]')
		.setInputFiles({ name: 'big.c', mimeType: 'text/plain', buffer: Buffer.alloc(20, 'a') });
	await expect(upload.getByRole('alert')).toHaveText('File "big.c" is too large (maximum 10 B).');
	await upload.locator('label').evaluate((zone) => {
		const data = new DataTransfer();
		data.items.add(new File(['abc'], 'small.c', { type: 'text/plain' }));
		zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
		zone.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
		zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
	});
	await expect(upload.locator('li')).toHaveText(/small\.c\s*\(3 B\)/);
	await expect(upload.getByRole('alert')).toHaveCount(0);
});

test('TASK-01 invalid problem definitions make the task unavailable', async ({ loginAs }) => {
	const page = await loginAs('e2e_admin');
	for (const task of [
		'bad_language',
		'bad_type',
		'bad_content',
		'bad_id',
		'mcq_no_choices',
		'mcq_choice_text',
		'mcq_no_valid',
		'mcq_bad_limit',
		'mcq_small_limit',
		'match_no_answer'
	])
		expect((await page.goto(url(`broken_${task}`)))?.status(), task).toBe(404);
});

test('TASK-01 TASK-14 blocked reasons: anonymous preview, unregistered user, group tokens', async ({
	loginAs,
	page
}) => {
	await page.goto(url('feedback'));
	await expect(page.getByRole('button', { name: 'Please enroll in the course to submit.' })).toBeDisabled();
	await expect(page.getByRole('link', { name: 'Sign in' }).last()).toHaveAttribute('href', /redirect=/);
	await expect(page.getByRole('link', { name: 'Contact link' })).toHaveCount(0);
	const outsider = `cov_out_${Date.now()}`;
	await withDb((db) =>
		db.collection('users').insertOne({
			username: outsider,
			realname: outsider,
			email: `${outsider}@x.org`,
			password: E2E.passwordHash,
			bindings: {},
			language: 'en',
			tos_accepted: true
		})
	);
	await (await loginAs(outsider)).goto(url('feedback'));
	await expect(page.getByRole('link', { name: 'Enroll in the course' })).toHaveAttribute('href', `/register/${C}`);
	const [a, b] = [await student(), await student()];
	await (await loginAs(a)).goto(url('limited_group'));
	await expect(page.getByRole('button', { name: 'Please register in a group' })).toBeDisabled();
	await withDb(async (db) => {
		await db
			.collection('groups')
			.insertOne({ courseid: C, description: `G ${a}`, size: 2, students: [a, b], audiences: [] });
		await db.collection('user_tasks').insertOne({
			courseid: C,
			taskid: 'limited_group',
			username: b,
			tried: 1,
			tokens: { amount: 1, date: new Date() },
			grade: 0
		});
	});
	await page.reload();
	await expect(
		page.getByRole('button', {
			name: 'Your group have reached the submission limit. It will be refilled within the next 2 hour(s)'
		})
	).toBeDisabled();
});

test('TASK-04 TASK-23 stored answers are served as text, unknown ones are not', async ({ loginAs }) => {
	const me = await student();
	const id = await insertSubmission(me, {});
	const page = await loginAs(me);
	await page.goto(url('feedback'));
	const get = (path: string) => page.request.get(`${url('feedback')}/${path}`);
	expect(await (await get(`$input/${id}/one`)).text()).toBe('x');
	expect(await (await get(`$input/${id}/two`)).text()).toBe('0');
	expect((await get(`$input/${id}/nope`)).status()).toBe(404);
	expect((await get(`$input/ffffffffffffffffffffffff/one`)).status()).toBe(404);
	const tutor = await loginAs('e2e_tutor');
	expect((await tutor.request.get(`${url('feedback')}/$archive/${id}`)).status()).toBe(404);
});

test('CSTU-01 member tables sort by text and number columns', async ({ loginAs }) => {
	await student();
	const page = await loginAs('e2e_admin');
	await page.goto(`/admin/${C}/students`);
	const header = (name: string) => page.getByRole('columnheader', { name }).first();
	await header('Name').getByRole('button').click();
	await expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
	await header('Name').getByRole('button').click();
	await expect(header('Name')).toHaveAttribute('aria-sort', 'descending');
	await header('Tasks tried').getByRole('button').click();
	await expect(header('Tasks tried')).toHaveAttribute('aria-sort', 'ascending');
	await header('Current grade').getByRole('button').click();
	await expect(header('Current grade')).toHaveAttribute('aria-sort', 'ascending');
});

test('TASK-08 crafted submissions with invalid answers of every problem type are refused', async ({ loginAs }) => {
	const page = await loginAs(await student());
	await open(page, 'editors');
	const codes = Object.fromEntries(
		'python py c cpp java javascript typescript sql yaml markdown shell ocaml scala kotlin csharp rust haskell octave oz go scheme latex xml plain'
			.split(' ')
			.map((l) => [`code_${l}`, ''])
	);
	const file = (name: string, size: number) => ({ name, mimeType: 'text/plain', buffer: Buffer.alloc(size, 'a') });
	const submit = async (fields: Record<string, unknown>) =>
		(
			await page.request.post(url('editors'), {
				headers: { accept: 'application/json', origin: new URL(page.url()).origin },
				multipart: { '@action': 'submit', ...fields } as never
			})
		).json();
	const valid = { ...codes, nameless: '', required: 'r', upload: file('a.c', 5), many: '0' };
	for (const bad of [
		{},
		{ ...valid, required: '' },
		{ ...valid, upload: 'not a file' },
		{ ...valid, upload: file('a.c', 20) },
		{ ...valid, upload: file('a.exe', 5) },
		{ ...valid, many: 'abc' },
		{ ...valid, many: '999' }
	])
		expect((await submit(bad)).text).toMatch(/^Please answer to all the questions/);
	expect(await submit(valid)).toMatchObject({ status: 'ok' });
	// A second submission while the first one is graded... unless it is already done.
	const second = await submit(valid);
	if (second.status === 'error') expect(second.text).toBe('A submission is already pending for this task!');
	// Outdated random inputs.
	await open(page, 'rst_extra');
	const res = await page.request.post(url('rst_extra'), {
		headers: { accept: 'application/json', origin: new URL(page.url()).origin },
		multipart: { '@action': 'submit' }
	});
	expect((await res.json()).text).toBe('Your task has been regenerated. This current task is outdated.');
});

test('TASK-08 TASK-09 a pending submission blocks new ones; legacy documents are displayed', async ({
	loginAs,
	browser,
	baseURL
}) => {
	const me = await student();
	// Dated in the future: an extra server started meanwhile by another test file recovers
	// (marks as lost) the waiting submissions older than its start whose job it does not know.
	const waiting = await insertSubmission(me, {
		status: 'waiting',
		result: undefined,
		submitted_on: new Date(Date.now() + 3600_000)
	});
	const legacy = await insertSubmission(me, {
		result: undefined,
		grade: undefined,
		problems: { one: 'legacy string' },
		text: 42,
		stdout: 'o'.repeat(1500)
	});
	const huge = await insertSubmission(me, { text: 'x'.repeat(200_001) });
	const page = await loginAs(me);
	await page.goto(url('feedback'));
	const check = async (p: Page, id: string) =>
		(await post(p, 'feedback', { '@action': 'check', submissionid: id })).json();
	expect((await check(page, waiting)).submission.text).toContain('Your submission has been sent');
	expect(await (await post(page, 'feedback', { '@action': 'kill', submissionid: waiting })).json()).toMatchObject({
		killed: false
	});
	const submitted = await post(page, 'feedback', { '@action': 'submit', one: 'x', two: '0' });
	expect((await submitted.json()).text).toBe('A submission is already pending for this task!');
	const old = (await check(page, legacy)).submission;
	expect(old).toMatchObject({ result: 'crash', grade: 0, problems: { one: ['crash', expect.any(String)] } });
	expect(old.text).toContain('42');
	expect((await check(page, huge)).submission.text).toContain('Parsing failed');
	const admin = await loginAs('e2e_admin');
	expect((await check(admin, legacy)).submission.debug.stdout).toMatch(/ <truncated>$/);
	// Anonymous visitors of the (previewable) course cannot post actions.
	const anon = await browser.newContext({ baseURL });
	const res = await anon.request.post(url('feedback'), {
		headers: { accept: 'application/json', origin: baseURL!, 'x-forwarded-proto': 'http' },
		multipart: { '@action': 'check', submissionid: waiting }
	});
	expect(res.status()).toBe(403);
	await anon.close();
});

test('TASK-13 in best mode a worse submission does not replace the evaluated one', async ({ loginAs }) => {
	await needsBackend();
	const me = await student();
	const best = await insertSubmission(me, { grade: 100 });
	await withDb((db) =>
		db.collection('user_tasks').insertOne({
			courseid: C,
			taskid: 'feedback',
			username: me,
			tried: 1,
			grade: 100,
			succeeded: true,
			submissionid: new ObjectId(best),
			random: []
		})
	);
	const page = await loginAs(me);
	await open(page, 'feedback');
	await page.getByRole('textbox').first().fill('wrong');
	await page.locator('[data-problem="two"] input[type=checkbox]').first().check();
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.locator('#task-result header')).not.toContainText('sent', { timeout: 30_000 });
	await expect
		.poll(() => withDb((db) => db.collection('user_tasks').findOne({ username: me, taskid: 'feedback' })))
		.toMatchObject({ tried: 2, grade: 100, submissionid: new ObjectId(best) });
});

test('TASK-08 TASK-15 TASK-16 input metadata fallbacks, pruning with archives, group emails', async ({ loginAs }) => {
	const bare = `cov_bare_${Date.now()}`;
	await withDb(async (db) => {
		await db
			.collection('users')
			.insertOne({ username: bare, realname: bare, password: E2E.passwordHash, bindings: {} });
		await db.collection('courses').updateOne({ _id: C as never }, { $push: { students: bare } as never });
	});
	const archive = await withDb(async (db) => {
		const upload = new GridFSBucket(db).openUploadStream('archive');
		upload.end(Buffer.from('tgz'));
		await new Promise((r) => upload.on('finish', r));
		return upload.id;
	});
	const old = await insertSubmission(bare, { taskid: 'stored_one', archive });
	const page = await loginAs(bare);
	// Posted without opening the task first: no user_tasks document yet (no random inputs).
	await page.goto(`/course/${C}`);
	const res = await (await post(page, 'stored_one', { '@action': 'submit', q: 'x' })).json();
	expect(res).toMatchObject({ status: 'ok', remove: [old] });
	const [sub] = await withDb((db) => db.collection('submissions').find({ username: bare }).toArray());
	expect(String(sub._id)).toBe(res.submissionid);
	expect(await withDb((db) => db.collection('fs.files').findOne({ _id: archive }))).toBeNull();
	const input = await withDb(async (db) => {
		const chunks: Buffer[] = [];
		for await (const c of new GridFSBucket(db).openDownloadStream(sub.input)) chunks.push(c as Buffer);
		return BSON.deserialize(Buffer.concat(chunks));
	});
	expect(input).toMatchObject({ '@email': '', '@lang': 'en', '@username': bare });
	// A group with a member without account: his email is empty.
	const a = await student();
	await withDb((db) =>
		db
			.collection('groups')
			.insertOne({ courseid: C, description: `G ${a}`, size: 2, students: [a, 'ghost'], audiences: [] })
	);
	const member = await loginAs(a);
	await open(member, 'limited_group');
	expect(await (await post(member, 'limited_group', { '@action': 'submit', q: 'x' })).json()).toMatchObject({
		status: 'ok'
	});
	const [group] = await withDb((db) =>
		db.collection('submissions').find({ taskid: 'limited_group', username: a }).toArray()
	);
	expect(group.username).toEqual([a, 'ghost']);
});

test('TASK-08 parallel submissions: only one stays pending', async ({ loginAs }) => {
	const page = await loginAs(await student());
	await open(page, 'slow');
	const results = await Promise.all(
		Array.from({ length: 4 }, () => post(page, 'slow', { '@action': 'submit', q: 'x' }).then((r) => r.json()))
	);
	expect(results.filter((r) => r.status === 'ok').length).toBeGreaterThanOrEqual(1);
	for (const r of results.filter((x) => x.status !== 'ok'))
		expect(r.text).toBe('A submission is already pending for this task!');
});

test('TASK-09 a submission deleted while it is graded is not recreated', async ({ loginAs }) => {
	await needsBackend();
	const me = await student();
	const page = await loginAs(me);
	await open(page, 'slow');
	const { submissionid } = await (await post(page, 'slow', { '@action': 'submit', q: 'x' })).json();
	const id = new ObjectId(String(submissionid));
	await expect
		.poll(() => withDb((db) => db.collection('submissions').findOne({ _id: id })).then((s) => s?.jobid))
		.toBeTruthy();
	const waiting = await (await post(page, 'slow', { '@action': 'check', submissionid })).json();
	expect(waiting.submission.status).toBe('waiting');
	await withDb((db) => db.collection('submissions').deleteOne({ _id: id }));
	await page.waitForTimeout(8000);
	expect(await withDb((db) => db.collection('submissions').findOne({ _id: id }))).toBeNull();
	expect(await withDb((db) => db.collection('user_tasks').findOne({ username: me, taskid: 'slow' }))).toMatchObject({
		tried: 0
	});
});

test('NAV-08 the unregistration confirmation can be cancelled', async ({ loginAs }) => {
	const me = await student();
	const page = await loginAs(me);
	await page.goto(`/course/${C}`);
	await page.getByRole('button', { name: 'Unregister from this course' }).click();
	await expect(page.getByRole('alertdialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('alertdialog')).toHaveCount(0);
	const course = await withDb((db) => db.collection('courses').findOne({ _id: C as never }));
	expect(course?.students).toContain(me);
});

test('TASK-10 dates fall back to English / UTC for an invalid stored time zone', async ({ loginAs }) => {
	const me = await student();
	await insertSubmission(me, { submitted_on: new Date('2024-03-01T12:34:00Z') });
	const page = await loginAs(me);
	// Sessions copy the profile time zone (legacy databases may hold any string).
	await withDb((db) =>
		db.collection('sessions').updateMany({ username: me }, { $set: { timezone: 'Mars/Olympus_Mons' } })
	);
	await open(page, 'feedback');
	await expect(page.getByTestId('history')).toContainText('Mar 1, 2024, 12:34 PM');
});
