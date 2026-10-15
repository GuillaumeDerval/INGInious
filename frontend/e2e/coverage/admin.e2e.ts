/**
 * Coverage-driven integration tests of the course administration (CADM-xx):
 * every UI flow of the settings, task list, task editor, task files and danger
 * zone pages, plus the server-side error branches reached with crafted requests
 * (bad payloads, foreign ids, tutor vs admin). Each test works on its own copy
 * of the `cov_admin` fixture course.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { ObjectId } from 'mongodb';
import type { Locator, Page } from '@playwright/test';
import { test, expect, installCourse, withDb } from '../fixtures.js';
import { useApp } from '../auth/helpers.js';
import { E2E } from '../setup-data.js';

const TASKS = E2E.tasksDir;
/** Parses a YAML file of an installed course (YAML 1.1 like PyYAML). */
const yaml = (...p: string[]) => parse(readFileSync(join(TASKS, ...p), 'utf8'), { version: '1.1' });
const raw = (...p: string[]) => readFileSync(join(TASKS, ...p), 'utf8');
let n = 0;
/** Installs a fresh copy of the fixture course, optionally merging keys into course.yaml. */
function course(name: string, patch: Record<string, unknown> = {}): string {
	const c = installCourse('cov_admin', `e2e_cova_${name}_${Date.now() % 100000}${n++}`);
	if (Object.keys(patch).length)
		writeFileSync(join(TASKS, c, 'course.yaml'), stringify({ ...yaml(c, 'course.yaml'), ...patch }));
	return c;
}

/** POSTs a form action like `use:enhance` (JSON answer, same origin) or a plain form (`html`); returns the answer text. */
async function act(page: Page, url: string, form: Record<string, string>, html = false) {
	const origin = new URL(page.url()).origin;
	const res = await page.request.post(url, {
		form,
		// HTML mode: the page is rendered on the server with the action result (like a no-JS browser).
		headers: html
			? { origin, accept: 'text/html' }
			: { origin, 'x-sveltekit-action': 'true', accept: 'application/json' }
	});
	return { status: res.status(), text: await res.text() };
}

/** Drags `src` onto `dst` with HTML5 drag & drop events. */
async function drag(page: Page, src: Locator, dst: Locator) {
	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await src.dispatchEvent('dragstart', { dataTransfer });
	await dst.dispatchEvent('dragover', { dataTransfer });
	await dst.dispatchEvent('drop', { dataTransfer });
}

/** An RSA key pair in PEM (LTI 1.3 client keys). */
const keys = () =>
	generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
	});

/** An LTI 1.3 client configuration. */
const client = (id: string, keySet = 'https://lms.example/jwks') => {
	const k = keys();
	return {
		default: true,
		client_id: id,
		auth_login_url: 'https://lms.example/auth',
		auth_token_url: 'https://lms.example/token',
		key_set_url: keySet,
		private_key: k.privateKey,
		public_key: k.publicKey,
		deployment_ids: ['dep1', 'dep2']
	};
};

/** Complete settings values as posted by the settings page. */
const settings = (more: Record<string, unknown> = {}) => ({
	name: 'COV',
	description: '',
	admins: [{ value: 'e2e_admin' }],
	tutors: [],
	groups_student_choice: false,
	allow_preview: false,
	is_lti: false,
	accessible: true,
	registration: true,
	allow_unregister: true,
	registration_password: '',
	registration_ac: '',
	registration_ac_accept: true,
	registration_ac_list: '',
	lti_url: '',
	lti_send_back_grade: false,
	lti_keys: '',
	lti_config: '',
	lti_secrets: {},
	tags: [],
	...more
});

/** A compiled gettext catalog (`.mo`) with the given entries, little or big endian. */
function mo(entries: [string, string][], bigEndian = false): Buffer {
	const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : 1));
	const n = sorted.length;
	const head = 28 + 16 * n;
	const strings: Buffer[] = [];
	const table = Buffer.alloc(16 * n);
	let offset = head;
	const w = (buf: Buffer, v: number, at: number) => (bigEndian ? buf.writeUInt32BE(v, at) : buf.writeUInt32LE(v, at));
	for (const [col, idx] of [
		[0, 0],
		[1, 8 * n]
	])
		sorted.forEach((e, i) => {
			const b = Buffer.from(e[col] + '\0');
			w(table, b.length - 1, idx + 8 * i);
			w(table, offset, idx + 8 * i + 4);
			strings.push(b);
			offset += b.length;
		});
	const header = Buffer.alloc(28);
	[0x950412de, 0, n, 28, 28 + 8 * n, 0, head].forEach((v, i) => w(header, v, 4 * i));
	return Buffer.concat([header, table, ...strings]);
}

test('CADM-03 settings: missing defaults, field errors and every server-side check', async ({ page, loginAs }) => {
	const c = course('settings');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/settings`);
	// Defaults of a descriptor without accessible/registration/tag fields.
	await expect(page.getByLabel('Course accessibility')).toHaveValue('true');
	const tags = page.getByRole('group', { name: 'Tags' });
	await expect(tags.getByLabel('Name')).toHaveValue('Tag one');
	await expect(tags.getByLabel('Type')).toHaveValue('0');
	// Anchor list of the sections.
	await page.setViewportSize({ width: 1400, height: 900 });
	await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Tags' }).click();
	// Registration ACL: list fields appear with a method.
	await page.getByLabel('Access control method').selectOption('username');
	await page.getByLabel('Access control list').fill('e2e_*\n\nfoo');
	await page.getByLabel('Accept the users of the list (deny them otherwise)').uncheck();
	await page.getByLabel('Registration', { exact: true }).selectOption('false');
	await page.getByLabel('Course accessibility').selectOption('custom');
	await page.getByLabel('Course accessibility').selectOption('true');
	// Tags: a second tag without name, then deleted.
	await tags.getByRole('button', { name: 'Add' }).click();
	await tags.getByLabel('Id').last().fill('t2');
	await expect(page.getByText('Unsaved changes')).toBeVisible();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('alert').filter({ hasText: 'Some tag fields were missing.' })).toBeVisible();
	await tags.getByRole('button', { name: 'Delete' }).last().click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Settings saved.')).toBeVisible();
	expect(yaml(c, 'course.yaml')).toMatchObject({
		registration_ac: 'username',
		registration_ac_list: ['e2e_*', 'foo'],
		registration_ac_accept: false,
		registration: false,
		accessible: true,
		tags: { t1: { name: 'Tag one', description: '', visible: false, type: 0 } }
	});

	// Server-side checks of crafted submissions (nothing is written).
	const url = `/admin/${c}/settings`;
	const cases: [Record<string, unknown> | string, string][] = [
		['not json', 'Invalid form'],
		[settings({ admins: [] }), 'You cannot remove yourself from the administrators of this course'],
		[settings({ accessible: 'garbage/dates' }), 'Invalid accessibility dates'],
		[settings({ registration: 'nope/x' }), 'Invalid registration dates'],
		[settings({ registration_ac: 'ip' }), 'Invalid ACL value'],
		[settings({ lti_keys: 'a:b:c\nnosecret' }), 'Each LTI key line must have the form key:secret.'],
		[settings({ lti_secrets: { x: 'not alnum!' } }), 'LTI deployment secrets must be alphanumerical.'],
		[
			settings({
				tags: [
					{ id: 'a', name: 'A' },
					{ id: 'a', name: 'B' }
				]
			}),
			'Some datas have the same id! The id must be unique.'
		],
		[settings({ lti_config: '{bad' }), "LTI config couldn't parse as JSON"],
		[settings({ lti_config: '[1]' }), 'LTI config is incorrect - Not a JSON object'],
		[settings({ lti_config: 'null' }), 'LTI config is incorrect - Not a JSON object'],
		[settings({ lti_config: '{"iss": {}}' }), 'Issuer iss must have a list of client_id configuration'],
		[settings({ lti_config: '{"iss": [null]}' }), 'Missing default in client config 0 of issuer iss'],
		[settings({ lti_config: '{"iss": [{"client_id": "x"}]}' }), 'Missing default in client config 0 of issuer iss'],
		[
			settings({ lti_config: JSON.stringify({ iss: [{ ...client('k'), private_key: 'x', public_key: 'y' }] }) }),
			'Error in private key of client config 0 of issuer iss'
		]
	];
	for (const [posted, message] of cases) {
		const res = await act(page, url, { settings: typeof posted === 'string' ? posted : JSON.stringify(posted) }, true);
		expect(res.text, message).toContain(message.slice(0, 40));
	}
	// Superadmins may leave the administrators.
	await loginAs('superadmin');
	expect((await act(page, url, { settings: JSON.stringify(settings({ admins: [] })) })).text).toContain(
		'Settings saved.'
	);
	expect(yaml(c, 'course.yaml').admins).toEqual([]);
});

test('CADM-04 LTI 1.3 clients: URLs, keys, deployment secrets and registration conflicts', async ({
	page,
	loginAs,
	context
}) => {
	const iss = `https://lms-${Date.now()}.example`;
	const c1 = client('client1');
	const c = course('lti13', {
		is_lti: true,
		lti_config: { [iss]: [c1, { client_id: 'bare' }], [`${iss}/dict`]: client('dict') },
		lti_secrets: { [`${iss}/client1/dep1`]: 'abc123' }
	});
	const other = course('lti13other', {
		is_lti: true,
		lti_config: { [iss]: [client('client2', 'https://other/jwks')] }
	});
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await loginAs('e2e_admin');
	// A non-LTI course has no LTI card.
	const plain = course('lti13plain');
	await page.goto(`/admin/${plain}/settings`);
	await expect(page.getByText('LTI 1.3 clients')).toHaveCount(0);
	await page.getByLabel('Enable LTI').check();
	await expect(page.getByText('No LTI 1.3 client')).toBeVisible();
	await page.goto(`/admin/${c}/settings`);
	await expect(page.getByText('Access and registration are managed by the LTI platform.')).toBeVisible();
	const lti = page.locator('section').filter({ hasText: 'client1' });
	await expect(lti.getByText(`/lti1.3/launch/${c}`).first()).toBeVisible();
	await expect(lti.getByText('taskid, secret').first()).toBeVisible();
	await lti.getByText('Public key', { exact: true }).click();
	await expect(lti.getByText('BEGIN PUBLIC KEY')).toBeVisible();
	await lti
		.getByRole('button', { name: /^Copy OIDC Login URL/ })
		.first()
		.click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/lti1.3/oidc_login/${c}`);
	// dep1 has a secret (removed), dep2 gets one.
	await lti.getByRole('button', { name: 'Delete' }).click();
	await expect(lti.getByText('No secret yet')).toHaveCount(2);
	await lti.getByRole('button', { name: 'Generate secret' }).last().click();
	await expect(lti.getByText('No secret yet')).toHaveCount(1);
	// The hand-written clients without keys or list are refused on save: keep the valid one.
	await page.getByLabel('Additional raw configuration').fill(JSON.stringify({ [iss]: [c1] }));
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Settings saved.')).toBeVisible();
	const saved = yaml(c, 'course.yaml');
	expect(Object.keys(saved.lti_secrets)).toEqual([`${iss}/client1/dep2`]);
	expect(saved.lti_secrets[`${iss}/client1/dep2`]).toMatch(/^[0-9a-f]{32}$/);
	// The same client id with other platform keys in another course is refused.
	const conflict = settings({ is_lti: true, lti_config: JSON.stringify({ [iss]: [client('client2')] }) });
	expect((await act(page, `/admin/${c}/settings`, { settings: JSON.stringify(conflict) })).text).toContain(
		`Client client2 of issuer ${iss} is already registered in course ${other}`
	);
});

test('CADM-06 task list: broken and missing tasks, legacy migration errors, crafted actions', async ({
	page,
	loginAs
}) => {
	const c = course('tasklist');
	writeFileSync(join(TASKS, c, 'task1', 'task.yaml'), raw(c, 'task1', 'task.yaml') + 'weight: -3\n');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/tasks`);
	await expect(page.getByText(/Error in task with id odd1/)).toBeVisible();
	await expect(page.getByText('No valid task with id: ghost')).toBeVisible();
	await expect(page.locator('#unplaced-tasks option')).toHaveCount(3);
	// The legacy task has an invalid weight: migration is refused.
	await page.getByRole('button', { name: 'Migrate tasks' }).click();
	await expect(page.getByText(/In taskid task1 : The weight value must be a numeric >= 0/).first()).toBeVisible();
	const url = `/admin/${c}/tasks`;
	expect((await act(page, `${url}?/dispenser`, { dispenser: 'nope' }, true)).text).toContain('Invalid task dispenser');
	expect((await act(page, `${url}?/save`, { data: '{}' }, true)).text).toContain('Invalid form');
	// Creating an existing task is reported, the rest is saved.
	const data = (structure: unknown, created: string[] = []) =>
		JSON.stringify({ structure, created, deleted: [], wiped: [] });
	expect(
		(
			await act(page, `${url}?/save`, {
				data: data({ toc: [{ title: 'S', tasks_list: ['task1'] }], config: { task1: {} } }, ['task1'])
			})
		).text
	).toContain("Couldn't create task task1 : Task with id task1 already exists.");
	// Invalid structures and settings, with the legacy messages.
	const sec = (config: Record<string, unknown>) => ({
		toc: [{ title: 'S', tasks_list: ['task1'] }],
		config: { task1: config }
	});
	const bad: [unknown, string][] = [
		[{ toc: 'x' }, 'Invalid dispenser data structure'],
		[{ toc: { a: 1 } }, 'Invalid dispenser data structure'],
		[{ toc: [1] }, "One section don't contain a sections list nor a tasks list"],
		[{ toc: [{ title: 'S' }] }, "One section don't contain a sections list nor a tasks list"],
		[{ toc: [{ title: '', tasks_list: [] }] }, 'No title for one section'],
		[{ toc: [{ title: 'S', tasks_list: ['a b'] }] }, 'One task id contains non alphanumerical characters'],
		[sec({ weight: 'x' }), 'The weight value must be a numeric'],
		[sec({ no_stored_submissions: 1.5 }), 'The store submission must be an integer > 1 '],
		[sec({ no_stored_submissions: -1 }), 'The store submission must be an integer > 1'],
		[sec({ evaluation_mode: 'worst' }), 'The evaluation mode must be either best or last but is worst'],
		[sec({ categories: [''] }), 'All categories must have a name'],
		[sec({ categories: 'x' }), 'All categories must have a name'],
		[sec({ submission_limit: { amount: 'x', period: 1 } }), 'Invalid submission limit'],
		[sec({ submission_limit: { amount: -1, period: 3 } }), 'You have given a period but no amount'],
		[
			sec({ submission_limit: { amount: -5, period: -1 } }),
			'Submission limit values must be higher than or equal to -1'
		],
		[sec({ group_submission: 'yes' }), 'Invalid submission mode'],
		[sec({ accessibility: 'not a date' }), 'Invalid task accessibility']
	];
	for (const [structure, message] of bad)
		expect((await act(page, `${url}?/save`, { data: data(structure) }, true)).text, message).toContain(message);
	// No toc at all, or a section with an unreadable task list, give empty structures.
	expect((await act(page, `${url}?/save`, { data: data({ config: {} }) })).text).toContain('Changes saved.');
	expect(yaml(c, 'course.yaml').dispenser_data.toc).toEqual([]);
	expect((await act(page, `${url}?/save`, { data: data({ toc: [{ title: 'S', tasks_list: 'x' }] }) })).text).toContain(
		'Changes saved.'
	);
	// Descriptors: legacy list structure, invalid structure (course unloadable).
	const list = course('tasklistlist', {
		dispenser_data: [{ title: 'L', tasks_list: ['task1', 'code1'] }]
	});
	await page.goto(`/admin/${list}/tasks`);
	await expect(page.getByText('Task one')).toBeVisible();
	const broken = course('tasklistbroken', { dispenser_data: { foo: 1 } });
	expect((await page.goto(`/admin/${broken}/tasks`))?.status()).toBe(404);
	await page.goto(`/admin/${c}/tasks`);
	// Nested sections and a {taskid: rank} mapping are accepted.
	expect(
		(
			await act(page, `${url}?/save`, {
				data: data({
					toc: [{ title: 'Outer', sections_list: [{ title: 'Inner', tasks_list: { task1: 0, code1: 1 } }] }],
					imported: true
				})
			})
		).text
	).toContain('Changes saved.');
	expect(yaml(c, 'course.yaml').dispenser_data).toMatchObject({ imported: true, config: { task1: {}, code1: {} } });
	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Section title' })).toHaveCount(2);
	// Tutors see the list but cannot change it.
	await loginAs('e2e_tutor');
	expect((await act(page, `${url}?/save`, { data: data({}) })).status).toBe(403);
});

test('CADM-07 TOC editor: arrows, drag & drop, subsections, bulk settings and removal', async ({ page, loginAs }) => {
	const c = course('toc');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/tasks`);
	const titles = page.getByRole('textbox', { name: 'Section title' });
	const rows = () => page.locator('li[draggable="true"] code');
	await expect(titles).toHaveCount(2);
	// Badges of the settings, defaults for a task without config entry.
	const task1 = page.getByRole('listitem').filter({ hasText: 'Task one' });
	await expect(task1.getByText('Weight 2')).toBeVisible();
	await expect(task1.getByText('Limited submissions')).toBeVisible();
	await expect(task1.getByText('Group', { exact: true })).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'No config' }).getByText('Hidden')).toBeVisible();
	// Arrows reorder tasks and sections.
	await task1.getByRole('button', { name: 'Move down' }).click();
	await expect(rows().nth(0)).toHaveText('code1');
	const secs = page.locator('section:has(> header > input[aria-label="Section title"])');
	const head = (i: number) => secs.nth(i).locator('xpath=./header');
	await head(1).getByRole('button', { name: 'Move up' }).click(); // Week 2 before Week 1
	await expect(titles.first()).toHaveValue('Week 2');
	// Week 2 is empty: it becomes a group of two subsections.
	await secs.nth(0).getByRole('button', { name: 'Add subsection' }).click();
	await expect(titles).toHaveCount(3);
	await secs.nth(0).getByRole('button', { name: 'Add subsection' }).last().click();
	await expect(titles).toHaveCount(4);
	// Drag & drop: a task into a subsection, a section into its own subsection (refused),
	// a task onto a section (ignored), Week 1 back to the top.
	const sub = secs.nth(1);
	await sub.getByLabel('Task id').fill('empty1');
	await sub.getByRole('button', { name: 'Add task' }).click();
	await drag(
		page,
		page.getByRole('listitem').filter({ hasText: 'Code one' }),
		sub.getByRole('listitem').filter({ hasText: 'Empty one' })
	);
	await expect(sub.getByText('Code one')).toBeVisible();
	await drag(page, head(0), head(1));
	await expect(titles.first()).toHaveValue('Week 2');
	await drag(page, page.getByRole('listitem').filter({ hasText: 'Task one' }), head(1));
	await drag(page, head(3), head(0));
	await expect(titles.first()).toHaveValue('Week 1');
	// Invalid id, then a new task.
	await page.getByLabel('Task id').last().fill('bad id');
	await page.getByRole('button', { name: 'Add task' }).last().click();
	await expect(page.getByRole('alert').filter({ hasText: 'Task id should only contain' })).toBeVisible();
	await page.getByLabel('Task id').last().fill('fresh1');
	await page.getByRole('button', { name: 'Add task' }).last().click();
	await expect(page.getByText('New task with id: fresh1')).toBeVisible();
	await expect(page.getByRole('status').filter({ hasText: 'Pending changes' })).toContainText('create [fresh1]');
	// Bulk settings of the selected tasks.
	await page.getByRole('listitem').filter({ hasText: 'fresh1' }).getByRole('checkbox', { name: 'Select' }).check();
	await page.getByRole('listitem').filter({ hasText: 'No config' }).getByRole('checkbox', { name: 'Select' }).check();
	await page.getByRole('button', { name: 'Edit settings of the selected tasks' }).click();
	const dialog = page.getByRole('dialog', { name: 'Task settings' });
	await expect(dialog.getByRole('heading')).toContainText('noconf, fresh1');
	await dialog.getByLabel('Accessibility').selectOption('true');
	await dialog.getByLabel('Grade weight (in comparison to other tasks)').fill('');
	await dialog.getByLabel('Grade weight (in comparison to other tasks)').fill('3');
	await dialog.getByRole('button', { name: 'Apply' }).click();
	await expect(page.getByRole('listitem').filter({ hasText: 'No config' }).getByText('Weight 3')).toBeVisible();
	await page
		.getByRole('listitem')
		.filter({ hasText: 'Error in task with id odd1' })
		.getByRole('button', { name: 'Task settings' })
		.click();
	await dialog.getByRole('button', { name: 'Close' }).click();
	// Remove the selected tasks from the list (kept files), then a section.
	await page.getByText('Delete selected tasks').click();
	await page.getByRole('button', { name: 'Keep files' }).click();
	await expect(page.getByText('New task with id: fresh1')).toHaveCount(0);
	const ghost = page.getByRole('listitem').filter({ hasText: 'ghost' });
	await ghost.getByLabel('Delete', { exact: true }).click();
	await ghost.getByRole('button', { name: 'Delete task files', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Pending changes' })).toContainText('delete [ghost]');
	await page.getByRole('button', { name: 'Delete section' }).last().click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Changes saved.')).toBeVisible();
	expect(existsSync(join(TASKS, c, 'noconf', 'task.yaml'))).toBe(true);
});

test('CADM-09 combinatory and contest layouts keep their own data', async ({ page, loginAs }) => {
	const c = course('combi', {
		task_dispenser: 'combinatory_test',
		dispenser_data: { toc: [{ title: 'Pool', config: { amount: '1' }, tasks_list: ['task1', 'code1'] }], config: {} }
	});
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/tasks`);
	await expect(page.getByLabel('Amount of tasks to be displayed')).toHaveValue('1');
	await expect(page.getByRole('button', { name: 'Add subsection' })).toHaveCount(0);
	await page.getByLabel('Amount of tasks to be displayed').fill('2');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Changes saved.')).toBeVisible();
	expect(yaml(c, 'course.yaml').dispenser_data.toc[0].config).toEqual({ amount: 2 });
	// Pool settings: missing config and amounts that are not integers.
	const pools = (config?: unknown) =>
		act(page, `/admin/${c}/tasks?/save`, {
			data: JSON.stringify({
				structure: { toc: [{ title: 'P', tasks_list: ['task1'], ...(config ? { config } : {}) }] },
				created: [],
				deleted: [],
				wiped: []
			})
		});
	expect((await pools()).text).toContain('Changes saved.');
	expect((await pools({ amount: true })).text).toContain('Changes saved.');
	expect(yaml(c, 'course.yaml').dispenser_data.toc[0].config).toEqual({ amount: 1 });
	expect((await pools({ amount: 'abc' })).text).toContain('invalid literal for int()');
	// Students get a random subset of the pool.
	await loginAs('e2e_student1');
	await withDb((db) => db.collection('courses').insertOne({ _id: c as never, students: ['e2e_student1'] }));
	await page.goto(`/course/${c}`);
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/tasks`);
	await page.getByRole('radio', { name: /Contest/ }).check();
	await page.getByRole('button', { name: 'Change layout' }).click();
	await expect(page.getByText('No section yet')).toBeVisible();
	await page.getByRole('button', { name: 'Add section' }).click();
	await page.getByLabel('Task id').fill('task1');
	await page.getByRole('button', { name: 'Add task' }).click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	// The toast of the layout change may still be shown.
	await expect(page.getByText('Changes saved.').last()).toBeVisible();
	await expect
		.poll(() => yaml(c, 'course.yaml').dispenser_data)
		.toMatchObject({
			toc_data: { toc: [{ tasks_list: ['task1'] }] },
			contest_settings: { enabled: false }
		});
	// A running contest opens its tasks at the contest start; an empty contest descriptor is valid.
	const running = course('contestrun', {
		task_dispenser: 'contest',
		dispenser_data: {
			toc_data: { toc: [{ title: 'C', tasks_list: ['task1'] }], config: { task1: { accessibility: true } } },
			contest_settings: { enabled: true, start: '2020-01-01 00:00:00', end: '2099-01-01 00:00:00' }
		}
	});
	await withDb((db) => db.collection('courses').insertOne({ _id: running as never, students: ['e2e_student1'] }));
	const empty = course('contestempty', { task_dispenser: 'contest', dispenser_data: null });
	await page.goto(`/admin/${empty}/tasks`);
	await expect(page.getByText('No section yet')).toBeVisible();
	await loginAs('e2e_student1');
	await page.goto(`/course/${running}`);
	await expect(page.getByText('Task one')).toBeVisible();
});

test('CADM-10 task editor: server validation errors are shown in their tab', async ({ page, loginAs }) => {
	const c = course('editor');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/edit/task/code1`);
	await page.locator('form[action="?/save"]').evaluate((f) => ((f as HTMLFormElement).noValidate = true));
	await page.getByRole('tab', { name: 'Grading environment' }).click();
	await page.getByLabel('Memory limit (in megabytes)').fill('0');
	await page.getByLabel('Hard timeout limit (in seconds)').fill('30');
	await page.getByRole('tab', { name: 'General' }).click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('The task was not saved')).toBeVisible();
	await expect(page.getByRole('tab', { name: 'Grading environment' })).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByText('Memory limit (in megabytes): a number >= 1 is expected.').first()).toBeVisible();
	await page.getByLabel('Memory limit (in megabytes)').fill('64');
	// A code problem with an invalid line offset.
	await page.getByRole('tab', { name: 'Problems' }).click();
	const card = page.locator('details[data-problem="c"]');
	await card.evaluate((d) => ((d as HTMLDetailsElement).open = true));
	await card.getByLabel('Code line offset').fill('0');
	await page.getByRole('tab', { name: 'General' }).click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('tab', { name: 'Problems' })).toHaveAttribute('aria-selected', 'true');
	await expect(card.getByText('Error', { exact: true })).toBeVisible();
	await card.getByLabel('Code line offset').fill('');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Task saved.')).toBeVisible();
	expect(yaml(c, 'code1', 'task.yaml').environment_parameters.limits).toEqual({ time: 10, memory: 64, hard_time: 30 });
	// Crafted submissions.
	const url = `/admin/${c}/edit/task/code1?/save`;
	const post = (values: Record<string, unknown>, problems: unknown[] = []) =>
		act(page, url, { task: JSON.stringify({ values, problems }) }, true);
	expect((await act(page, url, { task: 'x' }, true)).text).toContain('Invalid form');
	const base = { name: 'X', environment_type: 'docker', environment_id: 'default' };
	expect((await post({ ...base, environment_id: '' })).text).toContain('Grading environment is required.');
	expect((await post({ ...base, input_random: 'abc' })).text).toContain('Random inputs: a number >= 0 is expected.');
	expect((await post({ ...base, input_random: 1.5 })).text).toContain('Random inputs: a number >= 0 is expected.');
	expect((await post(base, [{ id: 'a b', type: 'code' }])).text).toContain('Invalid problem: a b');
	expect((await post(base, [{ id: 'p', type: 'nope' }])).text).toContain('Invalid problem: p');
	expect(
		(
			await post(base, [
				{ id: 'p', type: 'match' },
				{ id: 'p', type: 'match' }
			])
		).text
	).toContain('Invalid problem: p');
	expect((await post({ ...base, environment_type: 'gpu' })).text).toContain(
		'Invalid data: Environment type gpu is unknown'
	);
	const mcq = {
		values: { ...base, environment_type: 'mcq' },
		problems: [{ id: 'f', type: 'file', allowed_exts: ['.py'] }]
	};
	expect((await act(page, url, { task: JSON.stringify(mcq) })).text).toContain('Task saved.');
	expect(yaml(c, 'code1', 'task.yaml')).toMatchObject({
		environment_parameters: {},
		problems: { f: { allowed_exts: ['.py'] } }
	});
	// Missing task and tutors.
	expect((await act(page, `/admin/${c}/edit/task/nope?/save`, { task: 'x' })).status).toBe(404);
	await loginAs('e2e_tutor');
	expect((await post(base)).status).toBe(403);
});

test('CADM-11 task editor loads legacy and SSH environments', async ({ page, loginAs }) => {
	const c = course('legacyenv');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/edit/task/legacy6`);
	await expect(page.getByLabel('Author')).toHaveValue('Ada, Bob');
	await page.getByRole('tab', { name: 'Grading environment' }).click();
	await expect(page.getByLabel('Timeout limit (in seconds)', { exact: true })).toHaveValue('5');
	await page.goto(`/admin/${c}/edit/task/ssh1`);
	await expect(page.getByRole('heading', { name: 'ssh1' })).toBeVisible();
	await page.getByRole('tab', { name: 'Grading environment' }).click();
	await expect(page.getByLabel('Grading environment type')).toHaveValue('docker-ssh');
	await page.getByLabel('Grading environment type').selectOption('nvidia');
	await page.getByLabel('Memory limit (in megabytes)').fill('128');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Task saved.')).toBeVisible();
	expect(yaml(c, 'ssh1', 'task.yaml').environment_type).toBe('nvidia');
});

test('CADM-12 a problem of an unknown type is shown without editor and refused', async ({ page, loginAs }) => {
	const c = course('oddproblem');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/edit/task/odd1`);
	await page.getByRole('tab', { name: 'Problems' }).click();
	await expect(page.locator('details[data-problem="w"]')).toContainText('custom_widget');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Invalid problem: w').first()).toBeVisible();
});

test('CADM-12 subproblem editors of every type, drag & drop and deletion', async ({ page, loginAs }) => {
	const c = course('problems');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/edit/task/empty1`);
	await page.getByRole('tab', { name: 'Problems' }).click();
	await expect(page.getByText('No problem yet')).toBeVisible();
	const add = async (id: string, type: string) => {
		await page.getByLabel('New problem id').fill(id);
		await page.getByLabel('Problem type').selectOption(type);
		await page.getByRole('button', { name: 'Add', exact: true }).last().click();
	};
	await add('bad id', 'code');
	await expect(page.getByText('Problem id should only contain')).toBeVisible();
	await add('c1', 'code');
	const c1 = page.locator('details[data-problem="c1"]');
	await c1.getByRole('textbox', { name: 'Language' }).fill('python');
	await c1.getByRole('textbox', { name: 'Default value' }).click();
	await page.keyboard.type('print(42)');
	await c1.getByLabel('Optional?').check();
	await c1.getByLabel('Code line offset').fill('3');
	await add('s1', 'code_single_line');
	await page.locator('details[data-problem="s1"]').getByLabel('Default value').fill('x = 1');
	await add('mc', 'multiple_choice');
	const mc = page.locator('details[data-problem="mc"]');
	await mc.getByLabel('Can select multiple answers').check();
	await mc.getByLabel('Number of choices to display (0 = all choices)').fill('2');
	const choices = mc.getByRole('group', { name: 'Choices' });
	await choices.getByRole('button', { name: 'Add' }).click();
	await choices.getByRole('button', { name: 'Add' }).click();
	await expect(choices.getByText('Choice 2')).toBeVisible();
	await choices.getByLabel('Valid answer').first().check();
	await choices.getByRole('button', { name: 'Delete' }).last().click();
	await add('f1', 'file');
	const f1 = page.locator('details[data-problem="f1"]');
	await f1.getByLabel('Maximum file size (in bytes)').fill('1000');
	await add('del', 'match');
	await page.locator('details[data-problem="del"] summary').getByRole('button', { name: 'Delete' }).click();
	await expect(page.locator('details[data-problem="del"]')).toHaveCount(0);
	// Drag the file problem to the top, then move it down with the arrow.
	await drag(page, f1.locator('summary'), c1.locator('summary'));
	await page.locator('details[data-problem="s1"] summary').getByRole('button', { name: 'Move down' }).click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Task saved.')).toBeVisible();
	const saved = yaml(c, 'empty1', 'task.yaml').problems;
	expect(Object.keys(saved).sort()).toEqual(['c1', 'f1', 'mc', 's1']);
	expect(saved.c1).toMatchObject({ type: 'code', language: 'python', optional: true, offset: 3 });
	expect(saved.c1.default).toContain('print(42)');
	expect(saved.s1).toMatchObject({ type: 'code_single_line', default: 'x = 1' });
	expect(saved.mc).toMatchObject({ multiple: true, limit: 2, choices: [{ valid: true }] });
	expect(saved.f1).toMatchObject({ max_size: 1000 });
});

test('CADM-14 task files: upload, folders, binary files, zips and every error', async ({ page, loginAs }) => {
	const c = course('files');
	await loginAs('e2e_tutor');
	const base = `/admin/${c}/edit/task/code1/files`;
	expect((await page.request.get(base)).status()).toBe(403);
	await loginAs('e2e_admin');
	// An empty task folder, a missing file, a text file opened by URL.
	await page.goto(`/admin/${c}/edit/task/empty1/files`);
	await expect(page.getByText('This task has no file besides task.yaml.')).toBeVisible();
	await page.goto(`${base}?open=%2Fmissing.txt`);
	await expect(page.getByText('Invalid path: /missing.txt')).toBeVisible();
	await page.goto(`${base}?open=%2Fdata.bin`);
	await expect(page.getByText("INGInious can't read this file.")).toBeVisible();
	// Downloads: the whole task, a folder.
	const zip = await page.request.get(`${base}/download?path=%2F`);
	expect(zip.headers()['content-disposition']).toContain('code1.zip');
	expect((await page.request.get(`${base}/download?path=%2Flib`)).headers()['content-disposition']).toContain(
		'lib.zip'
	);
	expect((await page.request.get(`${base}/download`)).headers()['content-disposition']).toContain('code1.zip');
	// Crafted actions: errors of every operation.
	const cases: [string, Record<string, string>, string][] = [
		['save', { path: '/lib', content: 'x' }, 'Invalid path: /lib'],
		['rename', { path: '/lib', new_path: '/lib/deep/inner' }, 'Invalid path: /lib/deep/inner'],
		['rename', { path: '/nothing', new_path: '/x' }, 'Invalid path: /nothing'],
		['create', { path: '/' }, 'Invalid path: /'],
		['create', { path: '/../../escape' }, 'Invalid path: /../../escape'],
		['create', { path: '/run/inside' }, 'An error occurred while writing the file'],
		['upload', { path: '/x' }, 'No file'],
		['delete', { path: '/task.yaml' }, 'Invalid path: /task.yaml']
	];
	for (const [action, form, message] of cases)
		expect((await act(page, `${base}?/${action}`, form)).text, `${action} ${message}`).toContain(message);
	// Client-side flows (last, so that a full page load does not drop their browser coverage).
	await page.goto(`${base}?open=%2Flib%2Fhelper.py`);
	await expect(page.getByText('def helper')).toBeVisible();
	await expect(page.getByRole('link', { name: 'x.txt' })).toBeVisible();
	// Delete a file (the confirmation posts a plain form: done before the client-side flows).
	const row = page.getByRole('listitem').filter({ hasText: 'x.txt' });
	await row.getByTitle('More actions').click();
	await row.getByRole('button', { name: 'Delete' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByRole('link', { name: 'x.txt' })).toHaveCount(0);
	// Upload with the default path (file name), then another path.
	await page.getByTitle('Upload').click();
	await page
		.locator('input[type=file]')
		.setInputFiles({ name: 'up.txt', mimeType: 'text/plain', buffer: Buffer.from('uploaded') });
	await expect(page.getByLabel('File path:')).toHaveValue('/up.txt');
	await page.getByLabel('File path:').fill('/sub/up2.txt');
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByRole('link', { name: 'up2.txt' })).toBeVisible();
	expect(raw(c, 'code1', 'sub', 'up2.txt')).toBe('uploaded');
	await page.keyboard.press('Escape');
	// Folder creation.
	await page.getByTitle('Create a new file').click();
	await page.getByLabel('Enter the path to the file').fill('/newdir/');
	await page.getByRole('button', { name: 'Create a new file' }).click();
	await expect(page.getByText('newdir', { exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	// Binary file opened from the list, then the run script.
	await page.getByRole('link', { name: 'data.bin' }).click();
	await expect(page.getByText("INGInious can't read this file.")).toBeVisible();
	await page.getByRole('link', { name: 'run', exact: true }).click();
	await expect(page.getByText('echo ok')).toBeVisible();
});

test('CADM-15 danger zone: wrong confirmation, archive of an archive', async ({ page, loginAs }) => {
	const c = course('danger');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/danger`);
	const url = `/admin/${c}/danger`;
	expect((await act(page, `${url}?/archive`, { courseid: 'other' }, true)).text).toContain('Wrong course id.');
	expect((await act(page, `${url}?/delete`, { courseid: 'other' })).text).toContain('Wrong course id.');
	const archived = course('dangerarch', { archived: true });
	expect((await act(page, `/admin/${archived}/danger?/archive`, { courseid: archived }, true)).text).toContain(
		'This course is already an archive course.'
	);
	// Archive success rendered by the server, then through the page.
	const ssr = course('dangerssr');
	expect((await act(page, `/admin/${ssr}/danger?/archive`, { courseid: ssr }, true)).text).toContain(
		'Open the archive'
	);
	// Archive through the page (without a courses document): success message with a link.
	await page.getByRole('button', { name: 'Archive course data' }).click();
	const dialog = page.getByRole('alertdialog');
	await dialog.getByLabel(`Type "${c}" to confirm.`).fill(c);
	await dialog.getByRole('button', { name: 'Archive course data' }).click();
	await expect(page.getByRole('link', { name: 'Open the archive' })).toBeVisible();
	// An existing archive folder is never overwritten.
	const other = course('dangerexists');
	const dirs = [0, 1, 2, 3, 4].map((i) =>
		join(TASKS, `${other}_archive_${new Date(Date.now() + i * 1000).toISOString().slice(0, 19).replace(/[-T:]/g, '_')}`)
	);
	dirs.forEach((d) => mkdirSync(d, { recursive: true }));
	expect((await act(page, `/admin/${other}/danger?/archive`, { courseid: other })).text).toContain('already exists');
	dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

test('CADM-18 course and task names are translated with the course catalogs', async ({ page, loginAs }) => {
	const c = course('i18n');
	mkdirSync(join(TASKS, c, '$i18n'), { recursive: true });
	writeFileSync(
		join(TASKS, c, '$i18n', 'fr.mo'),
		mo([
			['', 'Project-Id: x'],
			['ctx\u0004Task one', 'no'],
			['Task one', 'Tâche un']
		])
	);
	writeFileSync(join(TASKS, c, '$i18n', 'de.mo'), mo([['Task one', 'Aufgabe eins']], true));
	writeFileSync(join(TASKS, c, '$i18n', 'es.mo'), Buffer.from('not a catalog file'));
	await loginAs('e2e_admin');
	const id = (await page.context().cookies()).find((k) => k.name === 'inginious_session_id')!.value.split('.')[0];
	const setLang = (lang: string) =>
		withDb((db) => db.collection('sessions').updateOne({ _id: new ObjectId(id) }, { $set: { language: lang } }));
	for (const [lang, name] of [
		['fr', 'Tâche un'],
		['de', 'Aufgabe eins'],
		['es', 'Task one']
	]) {
		await setLang(lang);
		await page.goto(`/admin/${c}/tasks`);
		await expect(page.getByText(name, { exact: true })).toBeVisible();
	}
});

// These pages are only requested (server rendering): browser coverage of an extra server would be
// merged with the main one and hide the client-side coverage of the same components.
test.describe('with WebDAV, the editor example plugin and a global LTI client', () => {
	const iss = `https://global-${Date.now()}.example`;
	useApp(11, {
		webdav_host: 'https://dav.example',
		plugins: [{ plugin_module: 'inginious.frontend.plugins.task_editor_hook_example' }],
		lti_config: { [iss]: [client('gclient')] }
	});
	const html = async (page: Page, url: string) => (await page.request.get(url)).text();

	test('CADM-06 WebDAV credentials are shown to course admins only', async ({ page, loginAs }) => {
		const c = course('webdav');
		await loginAs('e2e_admin');
		const admin = await html(page, `/admin/${c}/tasks`);
		expect(admin).toContain('WebDAV access');
		expect(admin).toContain(`https://dav.example/${c}`);
		// The contests plugin is disabled: no contest layout.
		expect(admin).not.toContain('value="contest"');
		await loginAs('e2e_tutor');
		expect(await html(page, `/admin/${c}/tasks`)).not.toContain('WebDAV access');
	});

	test('CADM-13 plugin tabs add fields and may refuse the task', async ({ page, loginAs }) => {
		const c = course('plugintab');
		await loginAs('e2e_admin');
		const url = `/admin/${c}/edit/task/task1`;
		expect(await html(page, url)).toContain('This is a test');
		await page.goto('/');
		const save = (hint?: string) =>
			act(
				page,
				`${url}?/save`,
				{
					task: JSON.stringify({
						values: { name: 'T', environment_type: 'mcq', environment_id: 'mcq', example_task_hint: hint },
						problems: []
					})
				},
				true
			);
		expect((await save()).text).toContain('You must provide a task hint in Example tab 2');
		expect((await save('Think')).status).toBe(200);
		expect(yaml(c, 'task1', 'task.yaml')).toMatchObject({ example_task_hint: 'Think', example_field: 'test' });
	});

	test('CADM-04 global LTI 1.3 clients are listed with the course ones', async ({ page, loginAs }) => {
		const c = course('ltiglobal', { is_lti: true });
		await loginAs('e2e_admin');
		const text = await html(page, `/admin/${c}/settings`);
		expect(text).toContain('gclient');
		expect(text).toContain('courseid, taskid, secret');
		// Declaring the same client with other keys in the course is refused.
		await page.goto('/');
		const posted = settings({
			is_lti: true,
			lti_config: JSON.stringify({ [iss]: [client('gclient', 'https://x/jwks')] })
		});
		expect((await act(page, `/admin/${c}/settings`, { settings: JSON.stringify(posted) }, true)).text).toContain(
			`Client gclient of issuer ${iss} is already registered in configuration.yaml`
		);
	});
});
