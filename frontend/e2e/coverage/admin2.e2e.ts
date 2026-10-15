/**
 * Coverage-driven integration tests of the course model and of the course
 * administration (NAV-xx, TASK-xx, CADM-xx, CSTU-xx): course and task
 * descriptors that cannot be loaded, dispenser edge cases (combinatory pools
 * without amount, contests without data, grade rounding), access rules (LTI
 * sessions, ACL users without e-mail or bindings, closed registrations,
 * unregistered API submissions) and client-side states of the admin pages.
 * Each test works on its own copies of fixture courses, with a course.yaml
 * written by the test (legacy format, read by the Python backend too).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { ObjectId } from 'mongodb';
import type { Page } from '@playwright/test';
import { test, expect, installCourse, removeCourse, withDb, createSessionCookie } from '../fixtures.js';
import { E2E } from '../setup-data.js';

const TASKS = E2E.tasksDir;
const origin = `http://localhost:${E2E.port}`;
let n = 0;

/**
 * Installs a fresh copy of a fixture course; `yaml` replaces (function: rewrites)
 * its course.yaml, `students` are registered in the database.
 */
async function course(
	name: string,
	{
		fixture = 'cov_admin',
		yaml,
		students
	}: {
		fixture?: string;
		yaml?: Record<string, unknown> | ((y: Record<string, unknown>) => Record<string, unknown>);
		students?: string[];
	} = {}
): Promise<string> {
	const c = installCourse(fixture, `e2e_cov5_${name}_${Date.now() % 100000}${n++}`);
	const file = join(TASKS, c, 'course.yaml');
	if (yaml) {
		const current = parse(readFileSync(file, 'utf8'), { version: '1.1' }) as Record<string, unknown>;
		writeFileSync(file, stringify(typeof yaml === 'function' ? yaml(current) : yaml));
	}
	if (students) await withDb((db) => db.collection('courses').insertOne({ _id: c as never, students }));
	return c;
}

/** Writes a task.yaml (raw text) into an installed course. */
function task(c: string, taskid: string, text: string): void {
	mkdirSync(join(TASKS, c, taskid), { recursive: true });
	writeFileSync(join(TASKS, c, taskid, 'task.yaml'), text);
}

/** Creates (or resets) a user with only the given fields. */
const user = (username: string, fields: Record<string, unknown> = {}) =>
	withDb((db) =>
		db
			.collection('users')
			.replaceOne({ username }, { username, realname: username, language: 'en', ...fields }, { upsert: true })
	);

/** POSTs a form action like `use:enhance` (JSON answer); `html` renders the page instead. */
async function act(page: Page, url: string, form: Record<string, string>, html = false) {
	const res = await page.request.post(url, {
		form,
		headers: html
			? { origin, accept: 'text/html' }
			: { origin, 'x-sveltekit-action': 'true', accept: 'application/json' }
	});
	return { status: res.status(), text: await res.text() };
}

/** Client-side navigation (same document, the browser coverage of the page is kept). */
async function nav(page: Page, url: string): Promise<void> {
	await page.evaluate((href) => {
		const a = document.createElement('a');
		a.href = href;
		document.body.append(a);
		a.click();
		a.remove();
	}, url);
	await page.waitForURL((u) => `${u.pathname}${u.search}` === url);
}

/** A minimal mcq task.yaml with the given problems block. */
const mcqTask = (problems: string) => `name: T\nenvironment_type: mcq\nenvironment_id: mcq\nproblems: ${problems}\n`;

test('NAV-01 CORE-04 courses with invalid descriptors are hidden and answer 404', async ({ page, loginAs }) => {
	const base = { name: 'Broken', admins: ['e2e_admin'], accessible: true };
	const broken = await Promise.all(
		[
			{ ...base, nofrontend: true },
			{ ...base, registration_ac: 'phone' },
			{ ...base, tags: { t1: { description: 'no name' } } },
			{ ...base, admins: 'e2e_admin' },
			{ ...base, accessible: 5 }
		].map((yaml, i) => course(`broken${i}`, { yaml }))
	);
	// A plain file among the course folders is ignored by the course list.
	const stray = join(TASKS, `e2e_cov5_stray_${Date.now() % 100000}.txt`);
	writeFileSync(stray, 'not a course');
	try {
		await loginAs('superadmin');
		const list = await (await page.request.get('/courselist')).text();
		for (const c of broken) {
			expect(list).not.toContain(c);
			expect((await page.request.get(`/course/${c}`)).status()).toBe(404);
		}
	} finally {
		rmSync(stray, { force: true });
		broken.forEach(removeCourse);
	}
});

test('CADM-06 TASK-01 broken task descriptors are listed with their error; the editor repairs them', async ({
	page,
	loginAs
}) => {
	const ids = ['nulllimits', 'zerolimit', 'oldenv', 'scalar', 'noproblems', 'notype'];
	const c = await course('brokentasks', {
		yaml: (y) => ({ ...y, dispenser_data: { toc: [{ title: 'Broken', tasks_list: ids }], config: {} } })
	});
	const docker = 'environment_type: docker\nenvironment_id: default\nproblems: {}\n';
	task(c, 'nulllimits', `name: Null limits\n${docker}environment_parameters: {limits: null}\n`);
	task(c, 'zerolimit', `name: Zero limit\n${docker}environment_parameters: {limits: {time: 0}}\n`);
	task(c, 'oldenv', 'name: Old format\nenvironment: default\nproblems: {}\nweight: 2\n');
	task(c, 'scalar', 'just a sentence\n');
	task(c, 'noproblems', 'name: No problems\nenvironment_type: mcq\nenvironment_id: mcq\n');
	task(c, 'nolang', mcqTask('{c: {type: code, name: Code, header: Write}}'));
	task(c, 'notype', 'name: No type\nproblems: {}\n');
	await loginAs('e2e_admin');
	const tasks = await (await page.request.get(`/admin/${c}/tasks`)).text();
	for (const id of ['zerolimit', 'scalar', 'noproblems', 'notype'])
		expect(tasks).toContain(`Error in task with id ${id}`);
	for (const id of ['nulllimits', 'oldenv']) expect(tasks).not.toContain(`Error in task with id ${id}`);
	expect(tasks).toContain('Invalid limit');
	expect(tasks).toContain('Environment type unknown is unknown');
	// Invalid task ids are unknown tasks.
	expect((await page.request.get(`/course/${c}/bad%20id`)).status()).toBe(404);
	// The editor repairs a task without problems (a multiple choice problem without choices stays invalid).
	await page.goto(`/admin/${c}/tasks`);
	const save = (problems: unknown[]) =>
		act(
			page,
			`/admin/${c}/edit/task/noproblems?/save`,
			{
				task: JSON.stringify({
					values: { name: 'Repaired', environment_type: 'mcq', environment_id: 'mcq' },
					problems
				})
			},
			true
		);
	expect((await save([{ id: 'q', type: 'multiple_choice', name: 'Q' }])).text).toContain(
		'Problem q does not have any valid answer'
	);
	expect((await save([])).text).toContain('Task saved.');
	expect(parse(readFileSync(join(TASKS, c, 'noproblems', 'task.yaml'), 'utf8'))).toMatchObject({
		name: 'Repaired',
		problems: {}
	});
	// The legacy task settings are migrated from the warning of the task list.
	await page.getByRole('button', { name: 'Migrate tasks' }).click();
	await expect(page.getByRole('button', { name: 'Migrate tasks' })).toHaveCount(0);
	// The editor opens a task without environment id, and a code problem without language.
	await nav(page, `/admin/${c}/edit/task/notype`);
	await expect(page.locator('select[id$="-environment_id"]')).toHaveValue('');
	await page.goto(`/admin/${c}/edit/task/nolang`);
	await expect(page.locator('details[data-problem="c"]')).toBeAttached();
	// An invalid value is flagged in place only once a save failed with its message.
	await page.getByLabel('Random inputs').fill('-1');
	await expect(page.getByLabel('Random inputs')).not.toHaveAttribute('aria-invalid', 'true');
});

test('NAV-09 NAV-11 dispenser edge cases: pools without amount, empty settings, contests, grade rounding', async ({
	page,
	loginAs
}) => {
	// Combinatory test whose pool has no amount (no task drawn) and a task without settings, seen anonymously.
	const combi = await course('combi', {
		fixture: 'nav_combi',
		yaml: (y) => ({
			...y,
			allow_preview: true,
			dispenser_data: {
				toc: [{ title: 'Pool', config: {}, tasks_list: ['c1', 'c2'] }],
				config: { c1: null, c2: { accessibility: true } }
			}
		})
	});
	const anonymous = await (await page.request.get(`/course/${combi}`)).text();
	expect(anonymous).toContain('NAV Combinatory test');
	expect(anonymous).not.toContain('Combi 2');
	// A contest without dispenser data (disabled by default), then an enabled contest with a task outside its toc.
	const empty = await course('contest0', { yaml: (y) => ({ ...y, task_dispenser: 'contest', dispenser_data: null }) });
	const contest = await course('contest1', {
		students: ['e2e_student1'],
		yaml: (y) => ({
			...y,
			task_dispenser: 'contest',
			dispenser_data: {
				contest_settings: { enabled: true, start: '2020-01-01 00:00:00', end: '2099-01-01 00:00:00' },
				toc_data: { toc: [{ title: 'Problems', tasks_list: ['task1'] }], config: { task1: {} } }
			}
		})
	});
	await loginAs('e2e_admin');
	expect((await page.request.get(`/course/${empty}`)).status()).toBe(200);
	await loginAs('e2e_student1');
	const contestPage = await (await page.request.get(`/course/${contest}`)).text();
	expect(contestPage).toContain('Task one');
	expect(contestPage).not.toContain('Score task');
	// Course grade: (3 + 0) / 2 = 1.5 is rounded half to even (2); a never accessible task does not count.
	const graded = await course('grade', {
		students: ['e2e_student1'],
		yaml: (y) => ({
			...y,
			dispenser_data: {
				toc: [{ title: 'W', tasks_list: ['task1', 'code1'] }],
				config: { task1: { accessibility: true }, code1: { accessibility: true } }
			}
		})
	});
	await withDb((db) =>
		db.collection('user_tasks').insertMany(
			[
				['task1', 3],
				['code1', 0],
				['noconf', 100]
			].map(([taskid, grade]) => ({
				courseid: graded,
				username: 'e2e_student1',
				taskid,
				tried: 1,
				succeeded: false,
				grade,
				submissionid: null,
				state: ''
			}))
		)
	);
	await loginAs('e2e_admin');
	const csv = (await (await page.request.get(`/admin/${graded}/students/students.csv`)).text()).split(/\r?\n/);
	const header = csv[0].split(',');
	const row = csv.find((l) => l.startsWith('e2e_student1,'))!.split(',');
	expect(row[header.indexOf('grade')]).toBe('2');
});

test('NAV-05 NAV-07 TASK-14 access rules: LTI sessions, ACL users without e-mail or bindings, closed registrations', async ({
	page,
	context,
	loginAs
}) => {
	// A visitor of an LTI session (not logged in yet) cannot preview a task outside of its LMS.
	const plain = await course('ltionly', { yaml: (y) => ({ ...y, accessible: true, allow_preview: true }) });
	const cookie = await createSessionCookie('e2e_student1');
	await withDb((db) =>
		db
			.collection('sessions')
			.updateOne(
				{ _id: new ObjectId(cookie.split('.')[0]) },
				{ $set: { is_lti: true, loggedin: false, username: null } }
			)
	);
	await context.addCookies([{ name: 'inginious_session_id', value: cookie, url: origin }]);
	const lti = await page.request.get(`/course/${plain}/task1`);
	expect(lti.status()).toBe(403);
	expect(await lti.text()).toContain('must be accessed on an external platform');
	// Access control lists checked on users without bindings or without e-mail: registration refused.
	await user('cov5_bare');
	for (const method of ['binding', 'email']) {
		const c = await course(`acl${method}`, {
			yaml: (y) => ({
				...y,
				accessible: true,
				registration: true,
				registration_ac: method,
				registration_ac_accept: true,
				registration_ac_list: ['cov5_*']
			})
		});
		await loginAs('cov5_bare');
		const res = await page.request.get(`/register/${c}`, { maxRedirects: 0 });
		expect(res.status()).toBe(303);
		expect(res.headers().location).toBe(`/course/${c}`);
	}
	// A registration posted while the registration period is closed is refused.
	const closed = await course('regclosed', { yaml: (y) => ({ ...y, accessible: true, registration: false }) });
	await loginAs('e2e_student2');
	expect((await act(page, `/register/${closed}`, { register_password: '' })).text).toContain('Invalid password.');
});

test('SITE-11 TASK-04 API submissions: unregistered users of preview courses, file problems without size limit', async ({
	page,
	loginAs
}) => {
	const c = await course('apisubmit', {
		students: ['e2e_student1'],
		yaml: (y) => ({
			...y,
			accessible: true,
			allow_preview: true,
			dispenser_data: {
				toc: [{ title: 'W', tasks_list: ['task1', 'up'] }],
				config: {
					task1: { accessibility: true },
					up: { accessibility: true, submission_limit: { amount: 5, period: -1 } }
				}
			}
		})
	});
	task(c, 'up', mcqTask(`{f: {type: file, name: Upload, header: Send a file, allowed_exts: ['.txt']}}`));
	const submit = (taskid: string, multipart: Record<string, unknown>) =>
		page.request.post(`/api/v0/courses/${c}/tasks/${taskid}/submissions`, { multipart, headers: { origin } });
	// Previewing is allowed, submitting is not.
	await loginAs('e2e_student2');
	const refused = await submit('task1', { mc1: '0' });
	expect(refused.status()).toBe(403);
	expect(await refused.text()).toContain('You are not allowed to submit for this task');
	// A registered student sees the default maximum size and submits a file (no token used yet).
	await loginAs('e2e_student1');
	expect(await (await page.request.get(`/course/${c}/up`)).text()).toContain('Upload');
	const accepted = await submit('up', { f: { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') } });
	expect(accepted.status()).toBe(200);
	// The editor of the file problem (extensions list).
	await loginAs('e2e_admin');
	expect(await (await page.request.get(`/admin/${c}/edit/task/up`)).text()).toContain('.txt');
	expect(await accepted.json()).toHaveProperty('submissionid');
});

test('CSTU-01 CSTU-07 CSTU-11 CADM-14 client states of the admin pages', async ({ page, loginAs }) => {
	// LTI courses have no group tab: the groups section of the page stays empty.
	const lti = await course('ltigroups', { yaml: (y) => ({ ...y, is_lti: true }) });
	// A course without any registration document lists no student.
	const fresh = await course('fresh');
	const grp = await course('groupsize', { students: ['e2e_student1', 'e2e_student2'] });
	await withDb((db) =>
		db
			.collection('groups')
			.insertOne({ courseid: grp, description: 'G', size: 2, students: ['e2e_student1'], audiences: [] })
	);
	// A course without tags: the settings show an empty tag list.
	const notags = await course('notags', { yaml: (y) => ({ ...y, tags: undefined }) });
	await loginAs('e2e_admin');
	const settings = await page.request.get(`/admin/${notags}/settings`);
	expect(await settings.text()).toContain('Tags');
	await page.goto(`/admin/${lti}/students?tab=groups`);
	await expect(page.getByRole('heading', { name: 'Groups' })).toHaveCount(0);
	await nav(page, `/admin/${lti}/students?tab=staff`);
	await nav(page, `/admin/${lti}/students?tab=groups`);
	await expect(page.getByRole('heading', { name: 'Teaching staff' })).toHaveCount(0);
	await nav(page, `/admin/${fresh}/students`);
	await expect(page.getByText('No student registered yet: add one below or let them register.')).toBeVisible();
	// Group size cleared while editing in the side panel, then cancelled: the card keeps its count.
	await nav(page, `/admin/${grp}/students?tab=groups`);
	await page.getByRole('button', { name: 'Edit group' }).click();
	const size = page.getByRole('spinbutton', { name: 'Max group size :' });
	await size.fill('');
	await expect(size).toHaveValue('');
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByText('1/2', { exact: true })).toBeVisible();
	// The last page of the submissions loaded directly.
	await withDb((db) =>
		db.collection('submissions').insertMany(
			[1, 2].map((i) => ({
				courseid: grp,
				taskid: 'task1',
				username: ['e2e_student1'],
				status: 'done',
				submitted_on: new Date(Date.now() - i * 1000),
				result: 'success',
				grade: 100,
				input: null
			}))
		)
	);
	await page.goto(`/admin/${grp}/submissions?limit=1&page=2`);
	await expect(page.getByText('2 / 2')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Next', exact: true })).toHaveCount(0);
	// Task files: the upload path follows the chosen file, and is emptied when the choice is cleared.
	await nav(page, `/admin/${grp}/edit/task/code1/files`);
	await page.getByTitle('Upload').click();
	const file = page.locator('input[type=file]');
	await file.setInputFiles({ name: 'up.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
	await expect(page.getByLabel('File path:')).toHaveValue('/up.txt');
	await file.setInputFiles([]);
	await expect(page.getByLabel('File path:')).toHaveValue('');
	// A file posted without path is stored under its own name.
	const upload = await page.request.post(`/admin/${grp}/edit/task/code1/files?/upload`, {
		multipart: { path: '', file: { name: 'named.txt', mimeType: 'text/plain', buffer: Buffer.from('n') } },
		headers: { origin, 'x-sveltekit-action': 'true', accept: 'application/json' }
	});
	expect(upload.status()).toBe(200);
	expect(readFileSync(join(TASKS, grp, 'code1', 'named.txt'), 'utf8')).toBe('n');
	// LTI course without any LTI 1.3 client.
	await nav(page, `/admin/${lti}/settings`);
	await expect(page.getByRole('heading', { name: 'LTI 1.3 clients' })).toBeVisible();
	// The danger zone reports a refused confirmation (the posted course id was altered).
	await nav(page, `/admin/${grp}/danger`);
	await page.getByRole('button', { name: 'Archive course data' }).click();
	const dialog = page.getByRole('alertdialog');
	await dialog.locator('input[name=courseid]').evaluate((i) => ((i as HTMLInputElement).value = 'other'));
	await dialog.getByRole('textbox').fill(grp);
	await dialog.getByRole('button', { name: 'Archive course data' }).click();
	await expect(page.getByText('Wrong course id.')).toBeVisible();
});
