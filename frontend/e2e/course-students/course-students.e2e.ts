/**
 * Integration tests of the people & results administration (CSTU-01..18).
 * Every test works on its own copy of the `cstu_course` fixture (admins
 * superadmin/e2e_admin, tutor e2e_tutor) with data seeded in the database.
 */
import { GridFSBucket, ObjectId, BSON, Double } from 'mongodb';
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, installCourse, withDb } from '../fixtures.js';
import { E2E } from '../setup-data.js';

let n = 0;
/** Installs a fresh course copy with registered students. */
async function course(name: string, students = ['e2e_student1', 'e2e_student2']): Promise<string> {
	const c = installCourse('cstu_course', `e2e_cstu_${name}_${Date.now() % 100000}${n++}`);
	await withDb((db) => db.collection('courses').insertOne({ _id: c as never, students }));
	return c;
}

/** Seeds a graded submission (input in GridFS) and returns its id. */
async function sub(
	c: string,
	o: {
		user?: string;
		task?: string;
		result?: string;
		grade?: number;
		input?: Record<string, unknown>;
		date?: Date;
	} = {}
): Promise<string> {
	return withDb(async (db) => {
		const upload = new GridFSBucket(db).openUploadStream('input');
		upload.end(BSON.serialize(o.input ?? { answer: '21', '@lang': 'en', '@username': o.user ?? 'e2e_student1' }));
		await new Promise((r) => upload.on('finish', r));
		const doc = {
			courseid: c,
			taskid: o.task ?? 'answer',
			username: [o.user ?? 'e2e_student1'],
			input: upload.id,
			status: 'done',
			submitted_on: o.date ?? new Date(),
			grade: new Double(o.grade ?? 50),
			result: o.result ?? 'failed',
			text: 'Half',
			problems: { answer: ['failed', 'Try *again*'] },
			tests: { misc: true }
		};
		return String((await db.collection('submissions').insertOne(doc)).insertedId);
	});
}

/** POSTs a form action like a browser (same origin). */
const post = (page: import('@playwright/test').Page, url: string, form: Record<string, string>) =>
	page.request.post(url, { form, headers: { origin: `http://localhost:${E2E.port}` } });

test('CSTU-01 staff list students and staff with their progress and export a safe CSV', async ({
	page,
	loginAs,
	baseURL
}) => {
	const c = await course('list', ['e2e_student1', 'cstu_formula']);
	await withDb((db) =>
		db
			.collection('users')
			.updateOne(
				{ username: 'cstu_formula' },
				{ $set: { username: 'cstu_formula', realname: '=cmd()', email: 'f@x.org', bindings: {}, language: 'en' } },
				{ upsert: true }
			)
	);
	await withDb((db) =>
		db.collection('user_tasks').insertOne({
			courseid: c,
			username: 'e2e_student1',
			taskid: 'answer',
			tried: 2,
			succeeded: true,
			grade: 100,
			submissionid: null,
			state: ''
		})
	);
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/students`);
	await expect(page.getByText('Number of students : 2')).toBeVisible();
	const row = page.getByRole('row', { name: /E2E student1/i });
	await expect(row).toContainText('e2e_student1@inginious.local');
	await expect(row.getByRole('progressbar')).toHaveAttribute('value', '20');
	// The search placeholder fits in the box (390 px screens included).
	const search = page.getByRole('searchbox', { name: 'Search' });
	await expect(search).toHaveAttribute('placeholder', 'Name, username or email');
	await page.setViewportSize({ width: 390, height: 844 });
	const [text, box] = await search.evaluate((e: HTMLInputElement) => {
		const style = getComputedStyle(e);
		const ctx = document.createElement('canvas').getContext('2d')!;
		ctx.font = style.font;
		const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
		return [ctx.measureText(e.placeholder).width, e.clientWidth - padding];
	});
	expect(text).toBeLessThanOrEqual(box);
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.getByRole('link', { name: 'Teaching staff' }).click();
	await expect(page.getByRole('row', { name: /e2e_tutor/ })).toBeVisible();
	const csv = await (await page.request.get(`${baseURL}/admin/${c}/students/students.csv`)).text();
	expect(csv.split('\r\n')[0]).toContain('id,email,grade,realname');
	expect(csv).toContain(`'=cmd()`);
});

test('CSTU-02 admins register and unregister students; tutors cannot', async ({ page, loginAs }) => {
	const c = await course('reg');
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/students`);
	await expect(page.getByRole('button', { name: 'Add student' })).toHaveCount(0);
	expect((await post(page, `/admin/${c}/students?/register`, { username: 'e2e_student3' })).status()).toBe(403);
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/students`);
	await page.getByRole('combobox', { name: 'Add student' }).fill('e2e_student3');
	await page.getByRole('option', { name: /e2e_student3/ }).click();
	await page.getByRole('button', { name: 'Add student' }).click();
	await expect(page.getByText('Number of students : 3')).toBeVisible();
	await page
		.getByRole('row', { name: /E2E student1/i })
		.getByRole('checkbox')
		.check();
	await page.getByRole('button', { name: 'Unregister selected' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
	await expect(page.getByText('Number of students : 2')).toBeVisible();
	expect((await withDb((db) => db.collection('courses').findOne({ _id: c as never })))!.students).toEqual([
		'e2e_student2',
		'e2e_student3'
	]);
});

test('CSTU-03 the user search is regex-safe and staff-only', async ({ page, loginAs }) => {
	const c = await course('search');
	await loginAs('e2e_tutor');
	const res = await (await page.request.get(`/admin/${c}/search_user?q=E2E Stud`)).json();
	expect(res.map((u: { value: string }) => u.value).sort()).toEqual(['e2e_student1', 'e2e_student2', 'e2e_student3']);
	expect(await (await page.request.get(`/admin/${c}/search_user?q=e2e.student`)).json()).toEqual([]);
	await loginAs('e2e_student1');
	expect((await page.request.get(`/admin/${c}/search_user?q=e2e`)).status()).toBe(403);
});

test('CSTU-04 staff create audiences and see their statistics', async ({ page, loginAs }) => {
	const c = await course('aud');
	await sub(c, { result: 'success' });
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/students?tab=audiences`);
	await page.getByRole('textbox', { name: 'New audience description' }).fill('Lab 1');
	await page.getByRole('button', { name: 'New audience' }).click();
	await expect(page.getByRole('link', { name: 'Lab 1' })).toBeVisible();
	const id = String((await withDb((db) => db.collection('audiences').findOne({ courseid: c })))!._id);
	await withDb((db) => db.collection('audiences').updateOne({ courseid: c }, { $set: { students: ['e2e_student1'] } }));
	await page.reload();
	await expect(page.getByRole('row', { name: /Lab 1/ })).toContainText('1');
	await expect(
		page.getByRole('row', { name: /Lab 1/ }).getByRole('link', { name: 'View submissions' })
	).toHaveAttribute('href', `/admin/${c}/submissions?audiences=${id}`);
	expect(await (await page.request.get(`/admin/${c}/students/audiences.csv`)).text()).toContain(
		'id,_id,courseid,description,done,students,tried,tutors'
	);
});

test('CSTU-05 audiences are edited within their course only; only admins enrol new students', async ({
	page,
	loginAs
}) => {
	const c = await course('audedit');
	const other = await course('audother');
	const [mine, foreign] = await withDb(async (db) => [
		(
			await db
				.collection('audiences')
				.insertOne({ courseid: c, description: 'A', students: ['e2e_student1'], tutors: [] })
		).insertedId,
		(await db.collection('audiences').insertOne({ courseid: other, description: 'F', students: [], tutors: [] }))
			.insertedId
	]);
	await loginAs('e2e_tutor');
	expect((await page.goto(`/admin/${c}/edit/audience/${foreign}`))?.status()).toBe(404);
	await page.goto(`/admin/${c}/edit/audience/${mine}`);
	await page.getByRole('textbox', { name: 'Audience description' }).fill('Renamed');
	await page.getByRole('checkbox', { name: /e2e_tutor/ }).check();
	await page.getByRole('button', { name: 'Update' }).click();
	await expect(page.getByText('Audience updated.').first()).toBeVisible();
	const addStudent3 = async () => {
		await page.getByRole('combobox', { name: 'Student list' }).fill('student3');
		await page.getByRole('option', { name: /e2e_student3/ }).click();
		await page.getByRole('button', { name: 'Update' }).click();
	};
	// A tutor cannot register a user through an audience; an admin can.
	await addStudent3();
	await expect(page.getByText('e2e_student3 is not registered to this course.').first()).toBeVisible();
	expect((await withDb((db) => db.collection('courses').findOne({ _id: c as never })))!.students).not.toContain(
		'e2e_student3'
	);
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/edit/audience/${mine}`);
	await addStudent3();
	await expect(page.getByText('Audience updated.').first()).toBeVisible();
	expect(await withDb((db) => db.collection('audiences').findOne({ _id: mine }))).toMatchObject({
		description: 'Renamed',
		students: ['e2e_student1', 'e2e_student3'],
		tutors: ['e2e_tutor']
	});
	expect((await withDb((db) => db.collection('courses').findOne({ _id: c as never })))!.students).toContain(
		'e2e_student3'
	);
	await page.getByRole('button', { name: 'Delete audience' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
	await expect(page).toHaveURL(`/admin/${c}/students?tab=audiences`);
	expect(await withDb((db) => db.collection('audiences').countDocuments({ _id: { $in: [mine, foreign] } }))).toBe(1);
});

test('CSTU-06 admins upload the audience structure (ids kept), everybody downloads it', async ({ page, loginAs }) => {
	const c = await course('audcsv');
	const id = await withDb(
		async (db) =>
			(
				await db
					.collection('audiences')
					.insertOne({ courseid: c, description: 'Group A', students: ['e2e_student1'], tutors: ['e2e_tutor'] })
			).insertedId
	);
	await loginAs('e2e_tutor');
	expect(
		await (await page.request.get(`/admin/${c}/students/audiences-structure.csv?preferred_field=email`)).text()
	).toBe('e2e_student1@inginious.local,email,student,Group A\r\ne2e_tutor@inginious.local,email,tutor,Group A\r\n');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/students?tab=audiences`);
	await page.getByText('Import / export').click();
	await page.locator('input[type=file]').setInputFiles({
		name: 'a.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from('e2e_student2,username,student,Group A\ne2e_student3@inginious.local,email,student,Group B\n')
	});
	await page.getByRole('button', { name: 'Upload (will erase current repartition)' }).click();
	await expect(page.getByText('Audiences updated.').first()).toBeVisible();
	const all = await withDb((db) => db.collection('audiences').find({ courseid: c }).toArray());
	expect(all.map((a) => [a.description, a.students])).toEqual([
		['Group A', ['e2e_student2']],
		['Group B', ['e2e_student3']]
	]);
	expect(String(all[0]._id)).toBe(String(id));
});

test('CSTU-07 the group editor saves groups with capacity checks', async ({ page, loginAs }) => {
	const c = await course('grp', ['e2e_student1', 'e2e_student2', 'e2e_student3']);
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/students?tab=groups`);
	await page.getByRole('button', { name: 'New group' }).click();
	const panel = page.getByRole('dialog', { name: 'Edit group' });
	for (const s of ['e2e_student1', 'e2e_student2']) {
		await panel.getByRole('combobox', { name: 'Add student' }).fill(s);
		await panel.getByRole('option', { name: new RegExp(s) }).click();
	}
	await panel.getByRole('button', { name: 'Update' }).click();
	await expect(page.getByText('Groups updated.').first()).toBeVisible();
	await expect(page.getByText('2/2')).toBeVisible();
	expect(await withDb((db) => db.collection('groups').find({ courseid: c }).toArray())).toMatchObject([
		{ description: 'New group', size: 2, students: ['e2e_student1', 'e2e_student2'], audiences: [] }
	]);
	const foreign = new ObjectId();
	expect(
		(
			await post(page, `/admin/${c}/students?/groups`, {
				groups: JSON.stringify([{ id: String(foreign), description: 'x', size: 1 }])
			})
		).status()
	).toBe(400);
});

test('CSTU-08 groups are exported and imported as YAML', async ({ page, loginAs }) => {
	const c = await course('yaml');
	await withDb((db) =>
		db
			.collection('groups')
			.insertOne({ courseid: c, description: 'G1', size: 2, students: ['e2e_student1'], audiences: [] })
	);
	await loginAs('e2e_admin');
	const yaml = await (await page.request.get(`/admin/${c}/students/groups.yaml`)).text();
	expect(yaml).toBe('- audiences: []\n  description: G1\n  size: 2\n  students:\n  - e2e_student1\n');
	await page.goto(`/admin/${c}/students?tab=groups`);
	await page.getByText('Import / export').click();
	await page
		.locator('input[type=file]')
		.setInputFiles({ name: 'g.yaml', mimeType: 'text/yaml', buffer: Buffer.from(yaml.replace('G1', 'Imported')) });
	await page.getByRole('button', { name: 'Upload (will erase current settings)' }).click();
	await expect(page.getByText('Groups updated.').first()).toBeVisible();
	expect(await withDb((db) => db.collection('groups').find({ courseid: c }).toArray())).toMatchObject([
		{ description: 'Imported', students: ['e2e_student1'] }
	]);
});

test('CSTU-09 the student page shows the status of every task', async ({ page, loginAs }) => {
	const c = await course('info');
	const s = await sub(c);
	await withDb((db) =>
		db.collection('user_tasks').insertMany([
			{
				courseid: c,
				username: 'e2e_student1',
				taskid: 'answer',
				tried: 2,
				succeeded: false,
				grade: 50,
				submissionid: new ObjectId(s),
				state: 'x'
			},
			{
				courseid: c,
				username: 'e2e_student1',
				taskid: '03_tasks',
				tried: 0,
				succeeded: false,
				grade: 0,
				submissionid: null,
				state: ''
			}
		])
	);
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/student/e2e_student1`);
	await expect(page.getByRole('link', { name: 'Failed (50%)' })).toHaveAttribute('href', `/submission/${s}`);
	await expect(page.getByRole('cell', { name: 'Not attempted (viewed)' })).toBeVisible();
	await expect(page.getByText('Not viewed').first()).toBeVisible();
	// Every task is counted while all are open; a task that is not open yet is listed but not counted
	// in "Tasks succeeded" (same count as the course page of the student).
	const kpi = page.locator('.panel', { hasText: 'Tasks succeeded' });
	await expect(kpi).toContainText('0 / 5');
	const yaml = join(E2E.tasksDir, c, 'course.yaml');
	writeFileSync(
		yaml,
		readFileSync(yaml, 'utf8').replace(
			'grp_mcq:\n      accessibility: true',
			"grp_mcq:\n      accessibility: '2099-01-01 00:00:00'"
		)
	);
	await page.reload();
	await expect(kpi).toContainText('0 / 4');
	await expect(page.getByRole('cell', { name: /Grp/ })).toBeVisible();
	expect(
		(await (await page.request.get(`/admin/${c}/students/student.csv?username=e2e_student1`)).text()).split('\r\n')[0]
	).toBe('id,grade,name,status,submissionid,taskid,tried,url,visible');
});

test('CSTU-10 staff reset the state of a task', async ({ page, loginAs }) => {
	const c = await course('reset');
	await withDb((db) =>
		db.collection('user_tasks').insertOne({
			courseid: c,
			username: 'e2e_student1',
			taskid: 'answer',
			tried: 1,
			succeeded: true,
			grade: 100,
			submissionid: null,
			state: 'saved'
		})
	);
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/student/e2e_student1`);
	await page
		.getByRole('row', { name: /Answer task/ })
		.getByRole('button', { name: 'Reset state' })
		.click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
	await expect(page.getByText('Task state reset.')).toBeVisible();
	expect(await withDb((db) => db.collection('user_tasks').findOne({ courseid: c, taskid: 'answer' }))).toMatchObject({
		state: '',
		grade: 100,
		succeeded: true
	});
});

test('CSTU-11 submissions are filtered, starred and paginated', async ({ page, loginAs }) => {
	const c = await course('subs');
	for (let i = 0; i < 3; i++) await sub(c, { user: 'e2e_student1', date: new Date(Date.now() - i * 1000) });
	const best = await sub(c, { user: 'e2e_student2', result: 'success', grade: 100 });
	await withDb((db) =>
		db.collection('user_tasks').insertOne({
			courseid: c,
			username: 'e2e_student2',
			taskid: 'answer',
			tried: 1,
			succeeded: true,
			grade: 100,
			submissionid: new ObjectId(best),
			state: ''
		})
	);
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/submissions?limit=2`);
	await expect(page.getByRole('heading', { name: '4 submissions selected' })).toBeVisible();
	await page.getByRole('link', { name: 'Next', exact: true }).click();
	await expect(page.getByText('2 / 2')).toBeVisible();
	await page.goto(`/admin/${c}/submissions`);
	await page.getByText('Filters', { exact: true }).click();
	await page.getByRole('checkbox', { name: /E2E student2/i }).check();
	await page.getByRole('button', { name: 'Filter' }).click();
	await expect(page.getByRole('heading', { name: '1 submissions selected' })).toBeVisible();
	await expect(page.getByTitle('Evaluation submission')).toBeVisible();
	// With the "show names" options, names are shown with the ids under them.
	await page.goto(`/admin/${c}/submissions?show_stud_name=on&show_task_name=on`);
	const row = page.getByRole('row').filter({ hasText: 'E2E student2' });
	await expect(row).toContainText('e2e_student2');
	await expect(row.getByText('answer', { exact: true })).toBeVisible();
	await page.goto(`/admin/${c}/submissions?date_after=bad`);
	await expect(page.getByText('Invalid dates')).toBeVisible();
});

test('CSTU-12 the CSV export covers the whole selection', async ({ page, loginAs }) => {
	const c = await course('csv');
	await sub(c);
	await sub(c, { user: 'e2e_student2' });
	await loginAs('e2e_tutor');
	const res = await page.request.get(`/admin/${c}/submissions/submissions.csv?limit=1`);
	expect(res.headers()['content-type']).toContain('text/csv');
	expect((await res.text()).trim().split('\r\n')).toHaveLength(3);
});

test('CSTU-13 archives follow the legacy layout and stay in the course', async ({ page, loginAs }) => {
	const c = await course('tgz');
	const other = await course('tgzother');
	const s = await sub(c, { input: { answer: '1', upload: { filename: 'f.txt', value: Buffer.from('hello') } } });
	const foreign = await sub(other);
	await loginAs('e2e_tutor');
	const tgz = gunzipSync(
		await (await page.request.get(`/admin/${c}/submissions/submissions.tgz?download_type=taskid/username`)).body()
	).toString('latin1');
	expect(tgz).toMatch(/answer\/e2e_student1\/\d{4}-\d\d-\d\dT[^/]+\+00:00\/submission\.test/);
	expect(tgz).toContain('/uploaded_files/upload.txt');
	const one = gunzipSync(
		await (await page.request.get(`/admin/${c}/submissions/submissions.tgz?submission=${s}`)).body()
	).toString('latin1');
	expect(one.startsWith('submission.test')).toBe(true);
	expect((await page.request.get(`/admin/${c}/submissions/submissions.tgz?submission=${foreign}`)).status()).toBe(404);
});

test('CSTU-14 TASK-24 admins replay submissions in place; tutors cannot', async ({ page, loginAs }) => {
	const c = await course('replay');
	const s = await sub(c, { task: '03_tasks', input: { q1: ['0', '1'], '@lang': 'en', '@username': 'e2e_student1' } });
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/submissions`);
	await expect(page.getByRole('button', { name: 'Replay submission' })).toHaveCount(0);
	expect((await post(page, `/admin/${c}/submissions?/replay`, { submissionid: s })).status()).toBe(403);
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/submissions`);
	await page.getByRole('button', { name: 'Replay submission' }).click();
	await expect(page.getByText('1 selected submissions were set for replay.')).toBeVisible();
	const doc = await withDb((db) => db.collection('submissions').findOne({ _id: new ObjectId(s) }));
	expect(doc!.last_replay).toBeTruthy();
	await expect
		.poll(async () => (await withDb((db) => db.collection('submissions').findOne({ _id: new ObjectId(s) })))!.status, {
			timeout: 45_000
		})
		.not.toBe('waiting');
});

test('CSTU-15 staff view a submission of their course, split input / feedback', async ({ page, loginAs }) => {
	const c = await course('view');
	const s = await sub(c);
	await loginAs('e2e_student1');
	expect((await page.goto(`/submission/${s}`))?.status()).toBe(403);
	expect((await page.goto('/submission/nothing'))?.status()).toBe(404);
	await loginAs('e2e_tutor');
	await page.goto(`/submission/${s}`);
	await expect(page.getByRole('region', { name: 'Answers' })).toContainText('21');
	await expect(page.getByRole('region', { name: 'Feedback' })).toContainText('Try again');
	await page.getByText('Replay', { exact: true }).click(); // replay actions menu
	await expect(page.getByRole('button', { name: 'Replay submission' })).toHaveCount(0);
	await page.getByRole('button', { name: /Replay as/ }).click();
	await expect(page).toHaveURL(`/course/${c}/answer`);
	expect(
		await withDb((db) => db.collection('submissions').countDocuments({ courseid: c, username: 'e2e_tutor' }))
	).toBe(1);
});

test('CSTU-16 the progress table counts students per task', async ({ page, loginAs }) => {
	const c = await course('progress');
	await withDb((db) =>
		db.collection('user_tasks').insertMany([
			{
				courseid: c,
				username: 'e2e_student1',
				taskid: 'answer',
				tried: 1,
				succeeded: true,
				grade: 100,
				submissionid: null,
				state: ''
			},
			{
				courseid: c,
				username: 'e2e_student2',
				taskid: 'answer',
				tried: 3,
				succeeded: false,
				grade: 0,
				submissionid: null,
				state: ''
			}
		])
	);
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/stats?tab=progress`);
	await expect(page.getByRole('row', { name: /Answer task/ }).last()).toContainText(/2\s*2\s*1\s*4/);
	expect((await (await page.request.get(`/admin/${c}/students/progress.csv`)).text()).split('\r\n')[0]).toBe(
		'id,attempted,attempts,name,succeeded,viewed'
	);
});

test('CSTU-17 statistics show KPIs, the chart and the tables', async ({ page, loginAs }) => {
	const c = await course('stats');
	await sub(c, { result: 'success', grade: 100 });
	await sub(c, { user: 'e2e_student2' });
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/stats`);
	await expect(page.getByText('Success rate')).toBeVisible();
	await expect(page.getByText('50%', { exact: true })).toBeVisible();
	await expect(page.getByRole('img', { name: '2 submissions, 1 valid' })).toBeVisible();
	// Users and tasks by name, with their ids in muted text; the running day is marked.
	await expect(page.getByRole('link', { name: 'E2E student2' })).toHaveAttribute(
		'href',
		`/admin/${c}/student/e2e_student2`
	);
	const cell = (name: string) => page.getByRole('row').filter({ hasText: name }).getByRole('cell').first();
	await expect(cell('E2E student2').getByText('e2e_student2', { exact: true })).toBeVisible();
	await expect(cell('Answer task').getByText('answer', { exact: true })).toBeVisible();
	await expect(page.getByText('The dashed part is the current period, still in progress.')).toBeVisible();
	await expect(page.getByText('Misconception')).toBeVisible();
});

test('CSTU-18 students and foreign staff are rejected everywhere', async ({ page, loginAs }) => {
	const c = await course('perm');
	const s = await sub(c);
	await loginAs('e2e_student1');
	for (const path of [
		'students',
		'student/e2e_student1',
		'submissions',
		'stats',
		'students/students.csv',
		'submissions/submissions.csv'
	])
		expect((await page.request.get(`/admin/${c}/${path}`)).status(), path).toBe(403);
	await loginAs('e2e_tutor');
	expect((await post(page, `/admin/${c}/students?/audiences`, {})).status()).toBe(403);
	expect((await post(page, `/submission/${s}?/debug`, {})).status()).toBe(403);
});
