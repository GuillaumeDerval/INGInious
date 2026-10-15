/**
 * Integration tests of the course administration (CADM-02..17). Every test
 * works on its own copy of the `cadm_main` fixture course.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { test, expect, installCourse, withDb } from '../fixtures.js';
import { E2E } from '../setup-data.js';

const TASKS = E2E.tasksDir;
/** Parses a YAML file of the course (YAML 1.1 like PyYAML). */
const yaml = (...p: string[]) => parse(readFileSync(join(TASKS, ...p), 'utf8'), { version: '1.1' });
const raw = (...p: string[]) => readFileSync(join(TASKS, ...p), 'utf8');
let n = 0;
/** Installs a fresh copy of the fixture course. */
const course = (name: string) => installCourse('cadm_main', `e2e_cadm_${name}_${Date.now() % 100000}${n++}`);

test('CADM-02 staff are redirected and get their admin menu; others get 403', async ({ page, loginAs }) => {
	const c = course('rights');
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}`);
	await expect(page).toHaveURL(`/admin/${c}/tasks`);
	const menu = page.getByRole('navigation', { name: 'Main menu' });
	await expect(menu.getByRole('link', { name: 'Statistics' })).toBeVisible();
	await expect(menu.getByRole('link', { name: 'Course settings' })).toHaveCount(0);
	expect((await page.goto(`/admin/${c}/settings`))?.status()).toBe(403);
	expect((await page.goto(`/admin/${c}/danger`))?.status()).toBe(403);
	expect((await page.goto(`/admin/${c}/edit/task/task1`))?.status()).toBe(403);
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}`);
	await expect(page).toHaveURL(`/admin/${c}/settings`);
	await expect(menu.getByRole('link', { name: 'Danger zone' })).toBeVisible();
	await loginAs('e2e_student1');
	expect((await page.goto(`/admin/${c}`))?.status()).toBe(403);
	expect((await page.request.get(`/admin/${c}/search_user?q=e2e`)).status()).toBe(403);
});

test('CADM-03 settings are validated before saving and written with legacy types', async ({ page, loginAs }) => {
	const c = course('settings');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/settings`);
	await page.getByLabel('Name', { exact: true }).first().fill('');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('alert').filter({ hasText: 'Invalid name' })).toBeVisible();
	expect(yaml(c, 'course.yaml').name).toBe('CADM course');
	await page.getByLabel('Name', { exact: true }).first().fill('Renamed course');
	// Staff pickers search the users by username or real name; no match says so.
	await page.getByRole('combobox', { name: 'Administrators' }).fill('nobody-matches-this');
	await expect(page.getByRole('listbox', { name: 'Administrators' })).toContainText('No result');
	await page.getByRole('combobox', { name: 'Administrators' }).fill('');
	await page.getByLabel('Tutors').fill('e2e_stu');
	await page.getByRole('option', { name: 'E2E Student1 (e2e_student1)' }).click();
	await page.getByLabel('Registration password').fill('');
	await page.getByLabel('Course accessibility').selectOption('custom');
	await page.getByLabel('Start').first().fill('2025-01-01 10:00:00+00:00');
	await page.getByLabel('Start').first().blur();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Settings saved.')).toBeVisible();
	const saved = yaml(c, 'course.yaml');
	expect(saved).toMatchObject({
		name: 'Renamed course',
		tutors: ['e2e_tutor', 'e2e_student1'],
		registration_password: null,
		accessible: '2025-01-01 10:00:00+00:00/',
		custom_key: 'kept',
		is_lti: false
	});
});

test('CADM-04 LTI settings: keys are validated and stored like legacy', async ({ page, loginAs }) => {
	const c = course('lti');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/settings`);
	await page.getByLabel('Enable LTI').check();
	await expect(page.getByText(`/lti/${c}/<taskid>`)).toBeVisible();
	await page.getByLabel('Consumer keys and secrets').fill('key-1:x');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('alert').filter({ hasText: 'LTI keys must be alphanumerical.' })).toBeVisible();
	await page.getByLabel('Consumer keys and secrets').fill('key1:secret1\nkey2:secret2');
	await page.getByLabel('External platform URL').fill('https://moodle.example');
	await page.getByLabel('Send back grades').check();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Settings saved.')).toBeVisible();
	expect(yaml(c, 'course.yaml')).toMatchObject({
		is_lti: true,
		lti_url: 'https://moodle.example',
		lti_keys: { key1: 'secret1', key2: 'secret2' },
		lti_send_back_grade: true,
		lti_config: {},
		lti_secrets: {}
	});
});

test('CADM-05 tags editor keeps categories and validates ids', async ({ page, loginAs }) => {
	const c = course('tags');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/settings`);
	const tags = page.getByRole('group', { name: 'Tags' });
	await tags.getByRole('button', { name: 'Add' }).click();
	await tags.getByLabel('Id').last().fill('my tag');
	await tags.getByLabel('Name').last().fill('Misc');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('alert').filter({ hasText: 'Invalid tag id: my tag' })).toBeVisible();
	await tags.getByLabel('Id').last().fill('misc1');
	await tags.getByLabel('Type').last().selectOption('1');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Settings saved.')).toBeVisible();
	expect(yaml(c, 'course.yaml').tags).toEqual({
		skill1: { name: 'Skill one', description: 'desc 1', visible: true, type: 0 },
		cat1: { name: 'Category one', description: '', visible: false, type: 2 },
		misc1: { name: 'Misc', description: '', visible: false, type: 1 }
	});
});

test('CADM-06 task list: legacy migration and dispenser switch', async ({ page, loginAs }) => {
	const c = course('tasklist');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/tasks`);
	await expect(page.getByText('WebDAV access')).toHaveCount(0);
	await page.getByRole('button', { name: 'Migrate tasks' }).click();
	await expect(page.getByText('Changes saved.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Migrate tasks' })).toHaveCount(0);
	expect(yaml(c, 'legacy1', 'task.yaml')).toEqual({
		name: 'Legacy one',
		environment_type: 'mcq',
		environment_id: 'mcq',
		custom_key: 'keep me',
		problems: {}
	});
	await page.getByRole('radio', { name: /Combinatory test/ }).check();
	await page.getByRole('button', { name: 'Change layout' }).click();
	await expect(page.getByText('Combinatory tests')).toBeVisible();
	expect(yaml(c, 'course.yaml')).toMatchObject({ task_dispenser: 'combinatory_test', dispenser_data: {} });
	await loginAs('e2e_tutor');
	expect((await page.goto(`/admin/${c}/tasks`))?.status()).toBe(200);
});

test('CADM-07 TOC editor: sections, new tasks, deletion with wipe', async ({ page, loginAs }) => {
	const c = course('toc');
	await withDb((db) =>
		db.collection('submissions').insertOne({ courseid: c, taskid: 'code1', username: ['e2e_student1'], status: 'done' })
	);
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/tasks`);
	await page.getByRole('button', { name: 'Add section' }).click();
	await page.getByLabel('Section title').last().fill('Week 2');
	await page.getByLabel('Task id').last().fill('new1');
	await page.getByRole('button', { name: 'Add task' }).last().click();
	// Keyboard reordering: the section's "Move up" button appears when its header has the focus.
	const title = page.getByLabel('Section title').last();
	const up = title.locator('xpath=..').getByRole('button', { name: 'Move up' });
	await page.mouse.move(0, 0);
	await expect(up).toHaveCSS('opacity', '0');
	await title.focus();
	await expect(up).toHaveCSS('opacity', '1');
	await up.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByLabel('Section title').first()).toHaveValue('Week 2');
	const row = page.getByRole('listitem').filter({ hasText: 'Code one' });
	await row.getByLabel('Delete', { exact: true }).click();
	await row.getByRole('button', { name: 'Delete task files and all submissions' }).click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Changes saved.')).toBeVisible();
	expect(yaml(c, 'course.yaml').dispenser_data.toc).toEqual([
		{ title: 'Week 2', config: {}, tasks_list: ['new1'] },
		{ title: 'Week 1', config: { closed: false }, tasks_list: ['task1'] }
	]);
	expect(yaml(c, 'new1', 'task.yaml')).toEqual({ environment_type: 'mcq', name: 'new1', problems: {} });
	expect(existsSync(join(TASKS, c, 'code1'))).toBe(false);
	expect(await withDb((db) => db.collection('submissions').countDocuments({ courseid: c }))).toBe(0);
});

test('CADM-08 per-task settings are edited in a dialog and validated', async ({ page, loginAs }) => {
	const c = course('config');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/tasks`);
	await page
		.getByRole('listitem')
		.filter({ hasText: 'Task one' })
		.getByRole('button', { name: 'Task settings' })
		.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Grade weight (in comparison to other tasks)').fill('2.5');
	await dialog.getByLabel('Evaluation submission').selectOption('last');
	await dialog.getByLabel('Per group').check();
	await dialog.getByLabel('Categories').fill('cat1,cat2');
	await dialog.getByLabel('Submission limit (-1 = no limitation)').fill('5');
	await dialog.getByLabel('Every ... hour(s) (-1 = never refilled)').fill('24');
	await dialog.getByLabel('Accessibility').selectOption('custom');
	await dialog.getByLabel('Start').fill('2026-01-01 00:00:00+00:00');
	await dialog.getByRole('button', { name: 'Apply' }).click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Changes saved.')).toBeVisible();
	expect(yaml(c, 'course.yaml').dispenser_data.config.task1).toEqual({
		weight: 2.5,
		no_stored_submissions: 0,
		evaluation_mode: 'last',
		group_submission: true,
		categories: ['cat1', 'cat2'],
		submission_limit: { amount: 5, period: 24 },
		accessibility: '2026-01-01 00:00:00+00:00//'
	});
	await page
		.getByRole('listitem')
		.filter({ hasText: 'Task one' })
		.getByRole('button', { name: 'Task settings' })
		.click();
	await dialog.getByLabel('Grade weight (in comparison to other tasks)').fill('-1');
	await dialog.getByRole('button', { name: 'Apply' }).click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(
		page.getByRole('alert').filter({ hasText: 'In taskid task1 : The weight value must be a numeric >= 0' })
	).toBeVisible();
	expect(yaml(c, 'course.yaml').dispenser_data.config.task1.weight).toBe(2.5);
});

test('CADM-09 combinatory test pools store an integer amount', async ({ page, loginAs }) => {
	const c = course('combi');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/tasks`);
	await page.getByRole('radio', { name: /Combinatory test/ }).check();
	await page.getByRole('button', { name: 'Change layout' }).click();
	await expect(page.getByText('Combinatory tests')).toBeVisible();
	await page.getByRole('button', { name: 'Add section' }).click();
	await page.getByLabel('Section title').fill('Pool A');
	await page.getByLabel('Amount of tasks to be displayed').fill('1');
	await page.getByLabel('Task id').fill('task1');
	await page.getByRole('button', { name: 'Add task' }).click();
	await expect(page.getByRole('button', { name: 'Add subsection' })).toHaveCount(0);
	await page.getByRole('listitem').getByRole('button', { name: 'Task settings' }).click();
	await expect(page.getByRole('dialog').getByLabel('Per group')).toHaveCount(0);
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	// The toast of the layout switch may still be shown: wait for the file itself.
	await expect
		.poll(() => yaml(c, 'course.yaml').dispenser_data.toc)
		.toEqual([{ title: 'Pool A', config: { amount: 1 }, tasks_list: ['task1'] }]);
});

test('CADM-10 task editor saves basic settings and keeps unknown keys', async ({ page, loginAs }) => {
	const c = course('editor');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/edit/task/task1`);
	await page.getByLabel('Name', { exact: true }).first().fill('Renamed task');
	await page.getByRole('radio', { name: 'Markdown' }).first().click();
	await page.getByLabel('Random inputs').fill('-1');
	expect(await page.getByLabel('Random inputs').evaluate((e) => (e as HTMLInputElement).validity.valid)).toBe(false);
	await page.getByLabel('Random inputs').fill('2');
	await page.getByLabel('Regenerate input random').check();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Task saved.')).toBeVisible();
	expect(yaml(c, 'task1', 'task.yaml')).toMatchObject({
		name: 'Renamed task',
		context: '#MD\nA *task*.',
		input_random: 2,
		regenerate_input_random: true,
		custom_task_key: 'keep me'
	});
	expect((await page.goto(`/admin/${c}/edit/task/nope`))?.status()).toBe(404);
	expect(existsSync(join(TASKS, c, 'nope'))).toBe(false);
});

test('CADM-11 SITE-24 environment tab stores typed limits', async ({ page, loginAs }) => {
	const c = course('env');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/edit/task/code1`);
	await page.getByRole('tab', { name: 'Grading environment' }).click();
	await expect(page.getByLabel('Grading environment type')).toHaveValue('docker');
	await page.getByLabel('Timeout limit (in seconds)', { exact: true }).fill('15');
	await page.getByLabel('Memory limit (in megabytes)').fill('256');
	await page.getByLabel('Allow internet access inside the grading container?').check();
	await page.getByLabel('Custom command to be run in container').fill('python3 run.py');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Task saved.')).toBeVisible();
	expect(yaml(c, 'code1', 'task.yaml')).toMatchObject({
		environment_type: 'docker',
		environment_id: 'default',
		environment_parameters: { limits: { time: 15, memory: 256 }, network_grading: true, run_cmd: 'python3 run.py' }
	});
	await page.getByLabel('Grading environment type').selectOption('mcq');
	await expect(page.getByLabel('Timeout limit (in seconds)', { exact: true })).toHaveCount(0);
});

test('CADM-12 subproblems of every type are added, reordered and saved', async ({ page, loginAs }) => {
	const c = course('problems');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/edit/task/task1`);
	await page.getByRole('tab', { name: 'Problems' }).click();
	const add = async (id: string, type: string) => {
		await page.getByLabel('New problem id').fill(id);
		await page.getByLabel('Problem type').selectOption(type);
		await page.getByRole('button', { name: 'Add', exact: true }).last().click();
	};
	await add('q1', 'match');
	await expect(page.getByText('This problem id is already used.')).toBeVisible();
	await add('m1', 'match');
	// A new problem card opens on its own.
	const card = page.locator('details[data-problem="m1"]');
	await card.getByLabel('Answer').fill('42');
	await card.getByLabel('Count error only at top of the page?').check();
	await add('f1', 'file');
	const f1 = page.locator('details[data-problem="f1"]');
	await f1.getByLabel(/Allowed file extensions/).fill('.py, .txt');
	await f1.getByLabel(/Allowed file extensions/).blur();
	await f1.getByRole('button', { name: 'Move up' }).click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Task saved.')).toBeVisible();
	const saved = yaml(c, 'task1', 'task.yaml');
	expect(Object.keys(saved.problems)).toEqual(['q1', 'f1', 'm1']);
	expect(saved.problems.m1).toEqual({ type: 'match', name: '', header: '', answer: '42', centralize: true });
	expect(saved.problems.f1).toEqual({ type: 'file', name: '', header: '', allowed_exts: ['.py', '.txt'] });
	expect(raw(c, 'task1', 'task.yaml')).toMatch(/answer: ['"]42['"]/); // quoted: stays a string for PyYAML
});

test('CADM-13 without the example plugin the editor has no plugin tab and adds no key', async ({ page, loginAs }) => {
	const c = course('plugin');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/edit/task/task1`);
	await expect(page.getByText('Example tab')).toHaveCount(0);
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Task saved.')).toBeVisible();
	expect(yaml(c, 'task1', 'task.yaml').example_field).toBeUndefined();
});

test('CADM-14 task files: create, edit, move, download, delete; traversal refused', async ({ page, loginAs }) => {
	const c = course('files');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/edit/task/code1/files`);
	await expect(page.getByRole('link', { name: 'task.yaml', exact: true })).toHaveCount(0);
	/** Creates a file from the "Create a new file" menu (opened when needed). */
	const create = async (path: string) => {
		const input = page.getByLabel('Enter the path to the file');
		if (!(await input.isVisible())) await page.getByTitle('Create a new file').click();
		await input.fill(path);
		await page.getByRole('button', { name: 'Create a new file' }).click();
	};
	await create('/dir/a.txt');
	await expect(page.getByRole('link', { name: 'a.txt', exact: true })).toBeVisible();
	await create('/./task.yaml');
	await expect(page.getByText('Invalid path: /./task.yaml')).toBeVisible();
	await page.goto(`/admin/${c}/edit/task/code1/files?open=%2Frun`);
	await expect(page.getByText('echo ok')).toBeVisible();
	await page.getByRole('textbox', { name: '/run' }).click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type('\necho edited');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Changes saved.')).toBeVisible();
	expect(raw(c, 'code1', 'run')).toContain('echo edited');
	const row = page.getByRole('listitem').filter({ hasText: 'a.txt' });
	await row.getByTitle('More actions').click();
	await row.getByLabel('Enter the new path').fill('/moved/b.txt');
	await row.getByRole('button', { name: 'Move' }).click();
	await expect(page.getByRole('link', { name: 'b.txt', exact: true })).toBeVisible();
	const download = await page.request.get(`/admin/${c}/edit/task/code1/files/download?path=%2Frun`);
	expect(download.headers()['content-disposition']).toContain('attachment');
	expect(await download.text()).toContain('echo edited');
	expect(
		(await page.request.get(`/admin/${c}/edit/task/code1/files/download?path=%2F..%2F..%2Fcourse.yaml`)).status()
	).toBe(404);
	const moved = page.getByRole('listitem').filter({ hasText: 'b.txt' });
	await moved.getByTitle('More actions').click();
	await moved.getByRole('button', { name: 'Delete' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByRole('link', { name: 'b.txt', exact: true })).toHaveCount(0);
	expect(existsSync(join(TASKS, c, 'code1', 'moved', 'b.txt'))).toBe(false);
});

test('CADM-15 danger zone archives the course data into a new course', async ({ page, loginAs }) => {
	const c = course('archive');
	await withDb(async (db) => {
		await db
			.collection('submissions')
			.insertOne({ courseid: c, taskid: 'task1', username: ['e2e_student1'], status: 'done' });
		await db.collection('courses').insertOne({ _id: c as never, students: ['e2e_student1'] });
	});
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/danger`);
	await page.getByRole('button', { name: 'Archive course data' }).click();
	const dialog = page.getByRole('alertdialog');
	await dialog.getByLabel(`Type "${c}" to confirm.`).fill(c);
	await dialog.getByRole('button', { name: 'Archive course data' }).click();
	await expect(page.getByText(`Course archived as : ${c}_archive_`)).toBeVisible();
	const archive = (await page.getByText('Course archived as : ').textContent())!.split(': ')[1].trim();
	expect(yaml(archive, 'course.yaml')).toMatchObject({ archived: true, name: 'CADM course' });
	expect(await withDb((db) => db.collection('submissions').countDocuments({ courseid: archive }))).toBe(1);
	expect(await withDb((db) => db.collection('courses').findOne({ _id: archive as never }))).toMatchObject({
		students: ['e2e_student1']
	});
	await page.goto(`/admin/${archive}/danger`);
	await expect(page.getByText('This course is already an archive course. You cannot archive it again.')).toBeVisible();
});

test('CADM-16 danger zone deletes the course and its data', async ({ page, loginAs }) => {
	const c = course('delete');
	await withDb((db) =>
		db.collection('submissions').insertOne({ courseid: c, taskid: 'task1', username: ['e2e_student1'], status: 'done' })
	);
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/danger`);
	await page.getByRole('button', { name: 'Delete course' }).click();
	const dialog = page.getByRole('alertdialog');
	await dialog.getByLabel(`Type "${c}" to confirm.`).fill(c);
	await dialog.getByRole('button', { name: 'Delete course' }).click();
	await expect(page).not.toHaveURL(/danger/);
	expect(existsSync(join(TASKS, c))).toBe(false);
	expect(await withDb((db) => db.collection('submissions').countDocuments({ courseid: c }))).toBe(0);
});

test('CADM-17 descriptors are written in the legacy YAML style', async ({ page, loginAs }) => {
	const c = course('yaml');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/settings`);
	await page.getByRole('textbox', { name: 'Description', exact: true }).first().click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type('Line 1   \nLine 2');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Settings saved.')).toBeVisible();
	const text = raw(c, 'course.yaml');
	expect(text).toMatch(/description: \|-\n\s+Line 1\n\s+Line 2\n/); // trailing spaces stripped
	expect(text.indexOf('name:')).toBeLessThan(text.indexOf('custom_key:'));
	expect(text).toMatch(/registration_password: 'pwd'|registration_password: null/);
});
