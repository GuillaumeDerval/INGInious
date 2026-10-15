/**
 * Coverage-oriented integration tests of the people & results administration
 * (CSTU-01..18): edge cases of the student lists, audiences, groups editor,
 * submission queries, archives, statistics and the submission page. Every
 * test works on its own copy of the `cstu_course` fixture, sometimes with
 * extra tasks (hidden, broken, custom problems) written into the copy.
 */
import { GridFSBucket, ObjectId, BSON, Double, type Db } from 'mongodb';
import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pack as tarPack } from 'tar-stream';
import { test, expect, installCourse, withDb } from '../fixtures.js';
import { E2E } from '../setup-data.js';

/** Shared tasks directory (same as `installCourse`). */
const TASKS_DIR = E2E.tasksDir;

let n = 0;
/** Installs a fresh course copy with registered students. */
async function course(name: string, students = ['e2e_student1', 'e2e_student2']): Promise<string> {
	const c = installCourse('cstu_course', `e2e_covstu_${name}_${Date.now() % 100000}${n++}`);
	await withDb((db) => db.collection('courses').insertOne({ _id: c as never, students }));
	return c;
}

/** Rewrites course.yaml of an installed course copy. */
function patchCourse(c: string, fn: (yaml: string) => string): void {
	const path = join(TASKS_DIR, c, 'course.yaml');
	writeFileSync(path, fn(readFileSync(path, 'utf8')));
}

/** Writes a task (task.yaml text) into an installed course copy. */
function addTask(c: string, taskid: string, yaml: string): void {
	mkdirSync(join(TASKS_DIR, c, taskid), { recursive: true });
	writeFileSync(join(TASKS_DIR, c, taskid, 'task.yaml'), yaml);
}

/** A minimal valid task.yaml with the given problems block. */
const taskYaml = (problems: string) =>
	`accessible: true
author: cov
context: ''
environment_id: default
environment_parameters:
  limits: {time: '30', memory: '100', hard_time: ''}
environment_type: docker
name: Custom task
network_grading: false
problems: ${problems}
stored_submissions: 0
submission_limit: {amount: -1, period: -1}
weight: 1.0
`;

/** Stores a file in GridFS and returns its id. */
async function gridfs(db: Db, data: Uint8Array, name = 'input'): Promise<ObjectId> {
	const upload = new GridFSBucket(db).openUploadStream(name);
	upload.end(data);
	await new Promise((r) => upload.on('finish', r));
	return upload.id;
}

/** Seeds a submission (input in GridFS) and returns its id. */
async function sub(
	c: string,
	o: {
		users?: string[];
		task?: string;
		result?: string;
		status?: string;
		grade?: number | null;
		input?: Record<string, unknown>;
		inputId?: ObjectId;
		date?: Date;
		tests?: Record<string, unknown> | null;
		archive?: Uint8Array;
	} = {}
): Promise<string> {
	return withDb(async (db) => {
		const users = o.users ?? ['e2e_student1'];
		const input =
			o.inputId ??
			(await gridfs(db, BSON.serialize(o.input ?? { answer: '21', '@lang': 'en', '@username': users[0] })));
		const doc: Record<string, unknown> = {
			courseid: c,
			taskid: o.task ?? 'answer',
			username: users,
			input,
			status: o.status ?? 'done',
			submitted_on: o.date ?? new Date(),
			result: o.result ?? 'failed',
			text: 'Half',
			problems: { answer: ['failed', 'Try *again*'] }
		};
		if (o.grade !== null) doc.grade = new Double(o.grade ?? 50);
		if (o.tests !== null) doc.tests = o.tests ?? { misc: true };
		if (o.archive) doc.archive = await gridfs(db, o.archive, 'archive');
		return String((await db.collection('submissions').insertOne(doc)).insertedId);
	});
}

/** Creates (or resets) a user with the given fields only. */
const user = (username: string, fields: Record<string, unknown> = {}) =>
	withDb((db) =>
		db
			.collection('users')
			.replaceOne({ username }, { username, bindings: {}, language: 'en', ...fields }, { upsert: true })
	);

/** Marks a submission as the evaluation submission of its first user. */
const evalOf = (c: string, s: string, username = 'e2e_student1', taskid = 'answer') =>
	withDb((db) =>
		db.collection('user_tasks').insertOne({
			courseid: c,
			username,
			taskid,
			tried: 1,
			succeeded: true,
			grade: 100,
			submissionid: new ObjectId(s),
			state: ''
		})
	);

const origin = { origin: `http://localhost:${E2E.port}` };
/** Posts a form action like `use:enhance` does; returns the JSON action result as text. */
async function act(
	page: import('@playwright/test').Page,
	url: string,
	body: { form?: Record<string, string>; multipart?: Record<string, unknown> }
): Promise<string> {
	const res = await page.request.post(url, {
		...(body as object),
		headers: { ...origin, 'x-sveltekit-action': 'true', accept: 'application/json' }
	});
	return res.text();
}

/**
 * Client-side navigation (SvelteKit router, same document): the browser coverage
 * of a document is lost when another document replaces it, so the tests that
 * check client-side behaviour navigate within the app instead of reloading.
 */
async function nav(page: import('@playwright/test').Page, url: string): Promise<void> {
	const target = new URL(url, 'http://x');
	await page.evaluate((href) => {
		const a = document.createElement('a');
		a.href = href;
		document.body.append(a);
		a.click();
		a.remove();
	}, url);
	await page.waitForURL((u) => u.pathname === target.pathname && u.search === target.search);
}

/** Lists the members of a gzipped tar: name -> content (directories: null). */
async function untar(body: Buffer): Promise<Record<string, string | null>> {
	const { extract } = await import('tar-stream');
	const { Readable } = await import('node:stream');
	const ex = extract();
	Readable.from([gunzipSync(body)]).pipe(ex);
	const out: Record<string, string | null> = {};
	for await (const e of ex) {
		const chunks: Uint8Array[] = [];
		for await (const ch of e) chunks.push(ch as Uint8Array);
		out[e.header.name] = e.header.type === 'directory' ? null : Buffer.concat(chunks).toString();
	}
	return out;
}

/** A gzipped grader archive with a file, a directory and malicious members. */
async function graderArchive(): Promise<Uint8Array> {
	const p = tarPack();
	p.entry({ name: 'answer.txt' }, 'answer=42');
	p.entry({ name: 'dir', type: 'directory' });
	p.entry({ name: '../evil.txt' }, 'evil');
	p.entry({ name: '/abs/x.txt' }, 'abs');
	p.entry({ name: 'link', type: 'symlink', linkname: '/etc/passwd' });
	p.entry({ name: './', type: 'directory' });
	p.finalize();
	const chunks: Uint8Array[] = [];
	for await (const ch of p) chunks.push(ch as Uint8Array);
	return gzipSync(Buffer.concat(chunks));
}

test('CSTU-01 member lists: staff tab, users without name/email, sorting, search and CSV quoting', async ({
	page,
	loginAs
}) => {
	await user('covstu_bare');
	await user('covstu_quote', { realname: 'Doe, "Jo"', email: 'q@x.org' });
	const c = await course('members', ['e2e_student1', 'covstu_bare', 'covstu_quote']);
	const empty = await course('nomembers', []);
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/students?tab=staff`);
	await expect(page.getByRole('heading', { name: 'Teaching staff' })).toBeVisible();
	await expect(page.getByRole('row', { name: /e2e_tutor/ })).toBeVisible();
	await page
		.getByRole('navigation', { name: 'Sections' })
		.getByRole('link', { name: /Students/ })
		.click();
	const bare = page.getByRole('row', { name: /covstu_bare/ });
	await expect(bare.getByRole('link', { name: 'covstu_bare' })).toBeVisible();
	await expect(bare).toContainText('—');
	await page.getByRole('button', { name: 'Name' }).click();
	await page.getByRole('button', { name: 'Name' }).click();
	await page.getByRole('searchbox', { name: 'Search' }).fill('zzzz');
	await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
	await expect(page.getByText('Nothing matches your search.')).toBeVisible();
	await page.getByRole('searchbox', { name: 'Search' }).fill('Doe');
	await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
	await expect(page.getByRole('row')).toHaveCount(2);
	const csv = await (await page.request.get(`/admin/${c}/students/students.csv`)).text();
	expect(csv).toContain('"Doe, ""Jo"""');
	expect((await page.request.get(`/admin/${c}/students/nothing.csv`)).status()).toBe(404);
	await nav(page, `/admin/${empty}/students`);
	await expect(page.getByText('No student registered yet: add one below or let them register.')).toBeVisible();
});

test('CSTU-02 admins unregister all students, bulk selection bar, unknown user registration', async ({
	page,
	loginAs
}) => {
	const c = await course('unregall', ['e2e_student1', 'e2e_student2']);
	await withDb(async (db) => {
		await db
			.collection('audiences')
			.insertOne({ courseid: c, description: 'A', students: ['e2e_student1'], tutors: [] });
		await db
			.collection('groups')
			.insertOne({ courseid: c, description: 'G', size: 2, students: ['e2e_student2'], audiences: [] });
	});
	await loginAs('e2e_admin');
	expect(await act(page, `/admin/${c}/students?/register`, { form: { username: 'nobody_here' } })).toContain(
		'Unknown or already registered user.'
	);
	await page.goto(`/admin/${c}/students`);
	await page.getByTitle('More actions').click();
	await page.getByRole('button', { name: 'Unregister all' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
	await expect(page.getByText('Number of students : 0')).toBeVisible();
	const [courseDoc, aud, grp] = await withDb((db) =>
		Promise.all([
			db.collection('courses').findOne({ _id: c as never }),
			db.collection('audiences').findOne({ courseid: c }),
			db.collection('groups').findOne({ courseid: c })
		])
	);
	expect([courseDoc!.students, aud!.students, grp!.students]).toEqual([[], [], []]);
});

test('CSTU-02 the bulk selection bar of the student list', async ({ page, loginAs }) => {
	const c = await course('bulkbar', ['e2e_student1', 'e2e_student2']);
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/students`);
	await page
		.getByRole('row', { name: /E2E student1/i })
		.getByRole('checkbox')
		.check();
	const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
	await expect(bar).toContainText('1 selected');
	await expect(page.getByRole('checkbox', { name: 'Select all' })).toHaveJSProperty('indeterminate', true);
	await bar.getByRole('button', { name: 'Clear selection' }).click();
	await expect(bar).toHaveCount(0);
	await page.getByRole('checkbox', { name: 'Select all' }).check();
	await expect(bar).toContainText('2 selected');
	await page.getByRole('checkbox', { name: 'Select all' }).uncheck();
	await page
		.getByRole('row', { name: /E2E student2/i })
		.getByRole('checkbox')
		.check();
	// The posted unregistration itself is tested by CSTU-02: here the submission is cancelled to stay on the page.
	await page.evaluate(() =>
		document.addEventListener(
			'submit',
			(e) => {
				e.preventDefault();
				document.body.dataset.posted = String(new FormData(e.target as HTMLFormElement).getAll('selected'));
			},
			{ capture: true }
		)
	);
	await bar.getByRole('button', { name: 'Unregister selected' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
	await expect(page.locator('body')).toHaveAttribute('data-posted', 'e2e_student2');
});

test('CSTU-03 the user search without query lists users', async ({ page, loginAs }) => {
	const c = await course('searchall');
	await loginAs('e2e_tutor');
	const res = await (await page.request.get(`/admin/${c}/search_user`)).json();
	expect(res.length).toBeGreaterThan(0);
});

test('CSTU-05 audience edition rejects unknown users and malformed ids; tutored audiences are starred', async ({
	page,
	loginAs
}) => {
	const c = await course('audunknown');
	const id = await withDb(
		async (db) =>
			(
				await db
					.collection('audiences')
					.insertOne({ courseid: c, description: 'Mine', students: ['e2e_student1'], tutors: ['e2e_tutor'] })
			).insertedId
	);
	await loginAs('e2e_tutor');
	expect((await page.goto(`/admin/${c}/edit/audience/not-an-id`))?.status()).toBe(404);
	expect(
		await act(page, `/admin/${c}/edit/audience/${id}?/update`, {
			form: { description: 'Mine', students: 'covstu_ghost_user' }
		})
	).toContain('User not found : covstu_ghost_user');
	await page.goto(`/admin/${c}/students?tab=audiences`);
	await expect(page.getByTitle('You tutor this audience')).toBeVisible();
});

test('CSTU-06 the audience structure upload parses quoted CSV and reports bad rows', async ({ page, loginAs }) => {
	const c = await course('audparse');
	const old = await withDb(
		async (db) =>
			(await db.collection('audiences').insertOne({ courseid: c, description: 'Old', students: [], tutors: [] }))
				.insertedId
	);
	await loginAs('e2e_admin');
	const upload = (text: string) =>
		act(page, `/admin/${c}/students?/audiences`, {
			multipart: { file: { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from(text) } }
		});
	expect(await upload('a,b,c\n')).toContain('File wrongly formatted.');
	expect(await act(page, `/admin/${c}/students?/audiences`, { multipart: { other: 'x' } })).toContain(
		'An error occurred while parsing the data.'
	);
	// Quoted fields with "" escapes and commas, CRLF line endings, blank lines, no final newline.
	const csv = [
		'e2e_student1,username,student,"Group ""A"", morning"',
		'',
		'"e2e_student2@inginious.local",email,student,"Group ""A"", morning"',
		'e2e_tutor,username,tutor,"Group ""A"", morning"',
		'e2e_student3,phone,student,X',
		'e2e_student3,username,boss,X',
		'nobody_at_all,username,student,X',
		'e2e_tutor,username,tutor,Tutors only'
	].join('\r\n');
	expect(await upload(csv)).toContain('User was not found: nobody_at_all');
	const all = await withDb((db) => db.collection('audiences').find({ courseid: c }).toArray());
	expect(all.map((a) => [a.description, a.students, a.tutors])).toEqual([
		['Group "A", morning', ['e2e_student1', 'e2e_student2'], ['e2e_tutor']]
	]);
	expect(all.some((a) => String(a._id) === String(old))).toBe(false);
	// Only tutors: audiences without students are kept.
	expect(await upload('e2e_tutor,username,tutor,T1\n')).not.toContain('failure');
	expect(
		(await withDb((db) => db.collection('audiences').find({ courseid: c }).toArray())).map((a) => a.description)
	).toEqual(['T1']);
	expect(await upload('e2e_tutor,username,manager,T1\n')).toContain('Unknown role: manager');
	expect(await upload('e2e_tutor,mail,tutor,T1\n')).toContain('Field was not recognized: mail');
});

test('CSTU-07 the group editor: side panel, capacity meter, audiences, clean and delete', async ({ page, loginAs }) => {
	const c = await course('grpui', ['e2e_student1', 'e2e_student2', 'e2e_student3']);
	const aud = await withDb(async (db) => {
		await db
			.collection('groups')
			.insertOne({ courseid: c, description: 'G1', size: 3, students: ['e2e_student1', 'covstu_ghost'] });
		return (
			await db
				.collection('audiences')
				.insertOne({ courseid: c, description: 'Aud1', students: ['e2e_student2'], tutors: [] })
		).insertedId;
	});
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/students?tab=groups`);
	const g1 = page.getByRole('article', { name: 'G1' });
	await expect(g1.getByRole('list', { name: 'Members' })).toContainText('covstu_ghost');
	await expect(g1.getByText('2/3')).toBeVisible();
	const panel = page.getByRole('dialog', { name: 'Edit group' });
	await g1.getByRole('button', { name: 'Edit group' }).click();
	await panel.getByRole('button', { name: 'Remove covstu_ghost (covstu_ghost)' }).click();
	await panel.getByRole('spinbutton', { name: 'Max group size :' }).fill('3');
	await panel.getByRole('button', { name: 'Update' }).click();
	await expect(g1.getByText('1/3')).toBeVisible();
	// A new group restricted to Aud1: e2e_student3 (not in Aud1) is rejected; the size grows to fit the members.
	await page.getByRole('button', { name: 'New group' }).click();
	for (const s of ['e2e_student2', 'e2e_student3']) {
		await panel.getByRole('combobox', { name: 'Add student' }).fill(s);
		await panel.getByRole('option', { name: new RegExp(s) }).click();
	}
	await expect(panel.getByRole('spinbutton', { name: 'Max group size :' })).toHaveValue('2');
	await panel.getByText('Aud1').click();
	await panel.getByRole('button', { name: 'Update' }).click();
	await expect(
		page.getByText("Changes couldn't be applied for following students : e2e_student3").first()
	).toBeVisible();
	await expect(page.getByRole('article', { name: 'New group' })).toContainText('Aud1');
	const groups = await withDb((db) => db.collection('groups').find({ courseid: c }).toArray());
	expect(groups.map((g) => [g.description, g.students, g.audiences.map(String)])).toEqual([
		['G1', ['e2e_student1'], []],
		['New group', ['e2e_student2'], [String(aud)]]
	]);
	await page.getByRole('button', { name: 'Clean groups' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
	await expect(page.getByText('No member yet.')).toHaveCount(2);
	await page.getByRole('article', { name: 'New group' }).getByRole('button', { name: 'Delete group' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
	await expect(page.getByRole('article', { name: 'New group' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Delete all groups' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
	await expect(page.getByText('No group yet: click "New group" to create one.')).toBeVisible();
});

test('CSTU-07 the group editor renders full, over-full, empty and restricted groups', async ({ page, loginAs }) => {
	const c = await course('grpstates', ['e2e_student1', 'e2e_student2', 'e2e_student3']);
	await withDb(async (db) => {
		const aud = (
			await db
				.collection('audiences')
				.insertOne({ courseid: c, description: 'AudR', students: ['e2e_student1'], tutors: [] })
		).insertedId;
		await db.collection('groups').insertMany([
			{ courseid: c, description: 'Full', size: 1, students: ['e2e_student1'], audiences: [aud] },
			{ courseid: c, description: 'Over', size: 1, students: ['e2e_student2', 'e2e_student3'], audiences: [] },
			{ courseid: c, description: 'Empty', size: 2, students: [], audiences: [] }
		]);
	});
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/students?tab=groups`);
	await expect(page.getByText('1/1', { exact: true })).toBeVisible();
	await expect(page.getByText('2/1', { exact: true })).toBeVisible();
	await expect(page.getByText('0/2', { exact: true })).toBeVisible();
	await expect(page.getByText('No member yet.')).toBeVisible();
	await expect(page.getByRole('article', { name: 'Full' })).toContainText('AudR');
	await page.getByRole('article', { name: 'Full' }).getByRole('button', { name: 'Edit group' }).click();
	await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'AudR', checked: true })).toHaveCount(1);
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
});

test('CSTU-07 group saves reject oversize groups; groups are unavailable for LTI courses', async ({
	page,
	loginAs
}) => {
	const c = await course('grpsrv', ['e2e_student1', 'e2e_student2', 'e2e_student3']);
	const existing = await withDb(
		async (db) =>
			(
				await db
					.collection('groups')
					.insertOne({ courseid: c, description: 'Old', size: 1, students: ['e2e_student3'], audiences: [] })
			).insertedId
	);
	await loginAs('e2e_admin');
	const res = await act(page, `/admin/${c}/students?/groups`, {
		form: {
			groups: JSON.stringify([
				{ id: String(existing), description: 'Old', size: 1, students: ['e2e_student3'], audiences: [] },
				{ id: null, description: 'Big', size: 1, students: ['e2e_student1', 'e2e_student2'], audiences: [] }
			])
		}
	});
	expect(res).toContain('e2e_student1, e2e_student2');
	expect(
		(await withDb((db) => db.collection('groups').find({ courseid: c }).toArray())).map((g) => [
			g.description,
			g.students
		])
	).toEqual([
		['Old', ['e2e_student3']],
		['Big', []]
	]);
	expect(await act(page, `/admin/${c}/students?/groups`, { form: { groups: '{' } })).toContain(
		'An error occurred while parsing the data.'
	);
	const yaml = (text: string) =>
		act(page, `/admin/${c}/students?/uploadGroups`, {
			multipart: { file: { name: 'g.yaml', mimeType: 'text/yaml', buffer: Buffer.from(text) } }
		});
	expect(await yaml('- description: [unclosed')).toContain('An error occurred while parsing the data.');
	expect(await yaml('- size: -3\n')).toContain('An error occurred while parsing the data.');
	expect(await act(page, `/admin/${c}/students?/uploadGroups`, { multipart: { other: 'x' } })).toContain(
		'An error occurred while parsing the data.'
	);
	const lti = await course('grplti');
	patchCourse(lti, (y) => y.replace('is_lti: false', 'is_lti: true'));
	await page.goto(`/admin/${lti}/students`);
	const sections = page.getByRole('navigation', { name: 'Sections' });
	await expect(sections.getByRole('link', { name: /Audiences/ })).toBeVisible();
	await expect(sections.getByRole('link', { name: /Groups/ })).toHaveCount(0);
	expect(
		(await page.request.post(`/admin/${lti}/students?/groups`, { form: { groups: '[]' }, headers: origin })).status()
	).toBe(403);
});

test('CSTU-09 the student page: no real name, hidden and broken tasks, reset of a never viewed task', async ({
	page,
	loginAs
}) => {
	await user('covstu_noname');
	const c = await course('studpage', ['covstu_noname']);
	addTask(c, 'zz_broken', 'name: [unclosed\n');
	patchCourse(c, (y) =>
		y
			.replace('grp_mcq: 4\n', 'grp_mcq: 4\n        zz_broken: 5\n')
			.replace(
				'05_fetching_input:\n      accessibility: true',
				"05_fetching_input:\n      accessibility: '2099-01-01 00:00:00'"
			)
	);
	const s = await sub(c, { users: ['covstu_noname'], task: '03_tasks' });
	await evalOf(c, s, 'covstu_noname', '03_tasks');
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/student/covstu_noname`);
	await expect(page.getByRole('heading', { name: 'covstu_noname' }).first()).toBeVisible();
	await expect(page.getByText('Not served by the task dispenser').first()).toBeVisible();
	await expect(page.getByRole('row', { name: /zz_broken/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /\(100%\)/ })).toHaveAttribute('href', `/submission/${s}`);
	const reset = () =>
		page
			.getByRole('row', { name: /Answer task/ })
			.getByRole('button', { name: 'Reset state' })
			.click();
	await reset();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
	await expect(page.getByText('This task was never viewed by the student.').first()).toBeVisible();
	await reset();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

/** Seeds the submissions of the CSTU-11 coverage tests (tutor e2e_tutor tutors A1 = e2e_student1). */
async function filterCourse(name: string) {
	await user('covstu_anon');
	const c = await course(name, ['e2e_student1', 'e2e_student2', 'covstu_anon']);
	const day = 86_400_000;
	const aud = await withDb(
		async (db) =>
			(
				await db
					.collection('audiences')
					.insertOne({ courseid: c, description: 'A1', students: ['e2e_student1'], tutors: ['e2e_tutor'] })
			).insertedId
	);
	const best = await sub(c, {
		grade: 100,
		result: 'success',
		date: new Date(Date.now() - 3 * day),
		tests: {
			good: true,
			misc: false,
			org1: true,
			'*auto-tag-short': 'short value',
			'*auto-tag-long': 'x'.repeat(40),
			'*auto-tag-empty': '',
			unknown: true
		}
	});
	await evalOf(c, best);
	await sub(c, {
		users: ['e2e_student2'],
		task: '02_courses',
		result: 'crash',
		grade: 0,
		date: new Date(Date.now() - day)
	});
	await sub(c, { users: ['covstu_anon'], task: '03_tasks', status: 'waiting', grade: null, tests: null });
	return { c, aud, best, day };
}

test('CSTU-11 the submission filters select the expected submissions', async ({ page, loginAs }) => {
	const { c, aud, day } = await filterCourse('filters');
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/submissions?tasks=unknown_task`);
	await expect(page.getByText('No submission matches the filters.')).toBeVisible();
	const count = async (qs: string, n: number) => {
		await nav(page, `/admin/${c}/submissions?${qs}`);
		await expect(page.getByRole('heading', { name: /submissions selected/ })).toHaveText(`${n} submissions selected`);
	};
	const iso = (ago: number) => new Date(Date.now() - ago).toISOString();
	await count('tasks=answer,unknown_task', 1);
	await count('org_categories=catA', 2);
	await count(`audiences=${aud}`, 1);
	await count(`audiences=${aud}&users=e2e_student2`, 0);
	await count('grade_min=10&grade_max=100', 1);
	await count('grade_max=50', 1);
	await count(`date_after=${iso(2 * day)}`, 2);
	await count(`date_before=${iso(2 * day)}`, 1);
	await count(`date_after=${iso(2 * day)}&date_before=${iso(day / 2)}`, 1);
	await count('crashes_only=on', 1);
	await count('eval=on', 1);
	await count('users=nobody', 3);
	await count('sort_by=grade&order=1&page=99&limit=0', 3);
	await expect(page.getByRole('row').nth(1)).toContainText('—');
	// Filter panel shortcuts: everything, nothing, the tutored students only, then filter.
	await page.getByText('Filters', { exact: true }).click();
	await page.getByRole('button', { name: 'All (Students)' }).click();
	await expect(page.getByRole('checkbox', { name: /covstu_anon/ })).toBeChecked();
	await page.getByRole('button', { name: 'None (Students)' }).click();
	await expect(page.getByRole('checkbox', { name: /covstu_anon/ })).not.toBeChecked();
	await page.getByRole('button', { name: 'Tutored only (Students)' }).click();
	await expect(page.getByRole('checkbox', { name: /E2E student1/ })).toBeChecked();
	await page.getByRole('button', { name: 'Filter' }).click();
	await expect(page.getByRole('heading', { name: /submissions selected/ })).toHaveText('1 submissions selected');
});

test('CSTU-11 the display options show names, task names, ids and tags', async ({ page, loginAs }) => {
	const { c, best } = await filterCourse('display');
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/submissions?show_stud_name=on&show_task_name=on&show_tags=on&show_id=on&sort_by=taskid`);
	const table = page.getByRole('table');
	await expect(table).toContainText('E2E student1');
	await expect(table).toContainText('?');
	await expect(table).toContainText('Answer task');
	await expect(table.getByText('Good answer')).toBeVisible();
	await expect(table.getByText('Org tag')).toHaveCount(0);
	await expect(table.getByText('short value')).toBeVisible();
	await expect(table.getByText(`${'x'.repeat(30)}…`)).toBeVisible();
	await expect(table.getByRole('link', { name: best })).toHaveAttribute('href', `/submission/${best}`);
	await page.getByRole('button', { name: 'Grade' }).click();
	await page.getByRole('button', { name: 'Grade' }).click();
	await page
		.getByRole('row', { name: /Answer task/ })
		.getByRole('checkbox')
		.check();
	await expect(page.getByRole('checkbox', { name: 'Select all' })).toHaveJSProperty('indeterminate', true);
	await expect(page.getByRole('button', { name: 'Download checked' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Replay checked' })).toHaveCount(0);
});

test('CSTU-11 pagination and the bulk bar of admins', async ({ page, loginAs }) => {
	const { c } = await filterCourse('pages');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/submissions?limit=1&page=2`);
	await expect(page.getByText('2 / 3')).toBeVisible();
	await page.getByRole('link', { name: 'Previous', exact: true }).click();
	await expect(page.getByText('1 / 3')).toBeVisible();
	await page.getByRole('link', { name: 'Next', exact: true }).click();
	await expect(page.getByText('2 / 3')).toBeVisible();
	await page.getByRole('link', { name: 'Next', exact: true }).click();
	await expect(page.getByText('3 / 3')).toBeVisible();
	await page.getByRole('link', { name: 'Previous', exact: true }).click();
	await expect(page.getByText('2 / 3')).toBeVisible();
	await page.getByRole('checkbox', { name: 'Select all' }).check();
	await expect(page.getByRole('button', { name: 'Replay checked' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Download checked' })).toBeVisible();
});

test('CSTU-12 the CSV export flattens tests (lists, objects) and handles missing fields', async ({ page, loginAs }) => {
	const c = await course('csvx');
	await sub(c, { tests: { list: [1, 'a'], obj: { a: { b: 1 } } } });
	await sub(c, { users: ['e2e_student2'], tests: null, grade: null });
	await loginAs('e2e_tutor');
	const csv = await (await page.request.get(`/admin/${c}/submissions/submissions.csv`)).text();
	expect(csv).toContain(`"[1, 'a']"`);
	expect(csv).toContain('"{""a"":{""b"":1}}"');
	expect((await page.request.get(`/admin/${c}/submissions/other.csv`)).status()).toBe(404);
});

test('CSTU-13 archives: grader archives, layouts, simplified trees, odd names', async ({ page, loginAs }) => {
	const c = await course('tgzx', ['e2e_student1', 'e2e_student2']);
	await withDb((db) =>
		db.collection('audiences').insertOne({ courseid: c, description: 'Aud X', students: ['e2e_student1'], tutors: [] })
	);
	const date = new Date('2026-01-02T03:04:05Z');
	const s1 = await sub(c, {
		date,
		archive: await graderArchive(),
		input: {
			answer: '1',
			upload: { filename: 'up.tar.gz', value: Buffer.from('data') },
			noext: { filename: 'README' },
			submission: { filename: 'x.test', value: Buffer.from('t') }
		}
	});
	await evalOf(c, s1);
	const s2 = await sub(c, { date: new Date(date.getTime() + 1000), archive: Buffer.from('not gzip') });
	const s3 = await sub(c, { users: ['..', 'e2e_student2'], date });
	await loginAs('e2e_tutor');
	const get = async (qs: string) =>
		untar(await (await page.request.get(`/admin/${c}/submissions/submissions.tgz?${qs}`)).body());
	const full = await get(`submission=${s1}&submission=${s2}`);
	const base = 'answer/e2e_student1/2026-01-02T03:04:05+00:00';
	expect(full[`${base}/archive/answer.txt`]).toBe('answer=42');
	expect(full[`${base}/archive/evil.txt`]).toBe('evil');
	expect(full[`${base}/archive/abs/x.txt`]).toBe('abs');
	expect(full[`${base}/archive/dir`]).toBeNull();
	expect(full[`${base}/uploaded_files/upload.tar.gz`]).toBe('data');
	expect(full[`${base}/uploaded_files/noext`]).toBe('');
	expect(Object.keys(full).some((k) => k.includes('link'))).toBe(false);
	expect(Object.keys(full).filter((k) => /\d\/submission\.test$/.test(k))).toHaveLength(2);
	// Simplified evaluation tree: no date folder, duplicates suffixed.
	const simple = await get(`submission=${s1}&submission=${s2}&eval_dl=on&simplify=on&download_type=username/taskid`);
	expect(simple['e2e_student1/answer/upload.tar.gz']).toBe('data');
	expect(simple['e2e_student1/answer/uploaded_files/submission.test']).toBe('t');
	expect(simple['e2e_student1/answer-1/submission.test']).toBeTruthy();
	const byAud = await get(`submission=${s1}&submission=${s3}&download_type=audience/taskid`);
	const names = Object.keys(byAud);
	expect(names.some((k) => /^Aud_X_\([0-9a-f]{24}\)\/answer\//.test(k))).toBe(true);
	expect(names.some((k) => k.startsWith('..-e2e_student2/answer/'))).toBe(true);
	const byUser = await get(`submission=${s3}&submission=${s1}&download_type=bogus`);
	expect(Object.keys(byUser).some((k) => k.startsWith('answer/_/'))).toBe(true);
	const all = await get('');
	expect(Object.keys(all).filter((k) => k.endsWith('submission.test')).length).toBeGreaterThan(2);
	expect((await page.request.get(`/admin/${c}/submissions/other.tgz`)).status()).toBe(404);
});

test('CSTU-13 an archive with a missing input aborts the download', async ({ page, loginAs }) => {
	const c = await course('tgzbroken');
	const s = await sub(c, { inputId: new ObjectId() });
	const ok = await sub(c);
	await loginAs('e2e_tutor');
	const res = await page.request
		.get(`/admin/${c}/submissions/submissions.tgz?submission=${s}&submission=${ok}`)
		.then((r) => r.body())
		.catch(() => null);
	expect(res === null || res.length < 200).toBe(true);
});

test('CSTU-14 bulk and selection replays; replays of removed tasks are skipped', async ({ page, loginAs }) => {
	const c = await course('replayx');
	const s = await sub(c, { task: '03_tasks', input: { q1: ['0', '1'], '@lang': 'en', '@username': 'e2e_student1' } });
	const gone = await sub(c, { task: 'removed_task' });
	await loginAs('e2e_admin');
	expect(await act(page, `/admin/${c}/submissions?/replay`, { form: { query: 'tasks=unknown_task' } })).toContain(
		'No submission selected.'
	);
	expect(await act(page, `/admin/${c}/submissions?/replay`, { form: { submissionid: gone } })).toContain(
		'0 selected submissions were set for replay.'
	);
	await page.goto(`/admin/${c}/submissions?tasks=03_tasks`);
	await page
		.getByRole('row', { name: /03_tasks/ })
		.getByRole('checkbox')
		.check();
	await page.getByRole('button', { name: 'Replay checked' }).click();
	await expect(page.getByText('1 selected submissions were set for replay.')).toBeVisible();
	await withDb((db) => db.collection('submissions').updateOne({ _id: new ObjectId(s) }, { $set: { status: 'done' } }));
	await page.goto(`/admin/${c}/submissions?tasks=03_tasks`);
	await page.getByText('Whole selection').click();
	await page.getByRole('button', { name: 'Replay current selection' }).click();
	await expect(page.getByText('1 selected submissions were set for replay.').first()).toBeVisible();
	await page.goto(`/admin/${c}/submissions?tasks=03_tasks`);
	await page.getByRole('checkbox', { name: 'Select all' }).check();
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download checked' }).click();
	expect((await download).suggestedFilename()).toBe('submissions.tgz');
});

/** Course with a task without problem names, a task without problems and two submissions. */
async function submissionCourse(name: string) {
	await user('covstu_subnoname');
	const c = await course(name, ['covstu_subnoname']);
	addTask(c, 'zz_custom', taskYaml('{plain: {type: code_single_line}}'));
	addTask(c, 'zz_empty', taskYaml('{}'));
	const s = await sub(c, {
		users: ['covstu_subnoname'],
		task: 'zz_custom',
		grade: null,
		input: { plain: '', extra: { filename: 'f.bin', value: Buffer.from('x') }, list: ['a', 1], '@lang': 'en' }
	});
	const waiting = await sub(c, { status: 'waiting', task: 'zz_empty', input: { '@lang': 'en' } });
	return { s, waiting };
}

test('CSTU-15 the submission page shows inputs (files, undefined problems) and waiting submissions', async ({
	page,
	loginAs
}) => {
	const { s, waiting } = await submissionCourse('subpage');
	await loginAs('e2e_tutor');
	await page.goto(`/submission/${waiting}`);
	await expect(page.getByText('This submission is being graded.')).toBeVisible();
	await expect(page.getByText('Nothing to show.')).toBeVisible();
	await nav(page, `/submission/${s}`);
	const answers = page.getByRole('region', { name: 'Answers' });
	await expect(answers).toContainText('Question 1: plain');
	await expect(answers).toContainText('File: f.bin');
	await expect(answers).toContainText('["a",1]');
	await expect(answers.getByText('This problem id is not defined in the task.')).toHaveCount(2);
	await expect(page.getByText('Debug information')).toHaveCount(0);
	await expect(page.getByRole('link', { name: /covstu_subnoname/ }).first()).toBeVisible();
	await nav(page, `/submission/${waiting}`);
	await expect(page.getByText('This submission is being graded.')).toBeVisible();
	await expect(page.getByText('Nothing to show.')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Download full submission' })).toHaveCount(0);
});

test('CSTU-15 admins see the debug information and replay a submission in place', async ({ page, loginAs }) => {
	const { s } = await submissionCourse('subadmin');
	await loginAs('e2e_admin');
	await page.goto(`/submission/${s}`);
	await page.getByText('Debug information').click();
	await expect(page.getByText('"courseid"')).toBeVisible();
	await page.getByText('Replay', { exact: true }).click();
	await page.getByRole('button', { name: 'Replay submission' }).click();
	await expect(page.getByText('Submission set for replay.').first()).toBeVisible();
	expect(
		(await withDb((db) => db.collection('submissions').findOne({ _id: new ObjectId(s) })))!.last_replay
	).toBeTruthy();
});

test('CSTU-17 statistics: weighted ratios, hourly range, limits, invalid dates, dark mode', async ({
	page,
	loginAs
}) => {
	const c = await course('statsx');
	const now = Date.now();
	const s = await sub(c, { result: 'success', grade: 100, tests: { good: true, misc: true } });
	await evalOf(c, s);
	await sub(c, { users: ['e2e_student2'], task: '03_tasks', tests: { good: true } });
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/stats?date_before=garbage`);
	await expect(page.getByText('Invalid dates')).toBeVisible();
	await nav(page, `/admin/${c}/stats?limit=1`);
	await expect(page.getByText('Per day')).toBeVisible();
	await expect(page.getByRole('img', { name: '1 submissions, 0 valid' })).toBeVisible();
	await nav(page, `/admin/${c}/stats?stat=pond_stat&date_after=${new Date(now - 86_400_000).toISOString()}`);
	await expect(page.getByText('Per hour')).toBeVisible();
	await expect(page.getByText('Misconception')).toBeVisible();
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.emulateMedia({ colorScheme: 'light' });
	// Leaving the page destroys the charts.
	await nav(page, `/admin/${c}/submissions`);
	await expect(page.getByRole('heading', { name: /submissions selected/ })).toBeVisible();
});

test('CSTU-17 statistics count the most recent `limit` submissions, 500 by default', async ({ page, loginAs }) => {
	const c = await course('statstiny');
	const input = await withDb((db) => gridfs(db, BSON.serialize({ answer: '1' })));
	await withDb((db) =>
		db.collection('submissions').insertMany(
			Array.from({ length: 1001 }, (_, i) => ({
				courseid: c,
				taskid: 'answer',
				username: ['e2e_student1'],
				input,
				status: 'done',
				submitted_on: new Date(Date.now() - i * 1000),
				result: 'failed',
				grade: 0,
				tests: i ? {} : { misc: true }
			}))
		)
	);
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/stats`);
	// 1001 submissions: the 500 most recent are counted by default, all of them with a larger limit.
	await expect(page.getByText('Number of submissions').locator('..')).toContainText('500');
	await page.goto(`/admin/${c}/stats?limit=2000`);
	await expect(page.getByText('Number of submissions').locator('..')).toContainText('1001');
});
