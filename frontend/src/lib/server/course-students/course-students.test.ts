/** Unit tests of the people & results administration modules (CSTU-01..17). */
// Naive query dates are in the server timezone: pin it.
process.env.TZ = 'UTC';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { gunzipSync, gzipSync } from 'node:zlib';
import { extract, pack } from 'tar-stream';
import { ObjectId } from 'mongodb';
import { parse } from 'yaml';
import { addSub, setupCstu, type CstuEnv } from '../../../../tests/fixtures/cstu/setup.js';
import { getCourse } from '../courses/course.js';
import { audiencesPerStudent } from '../courses/members.js';
import { taskConfig } from '../courses/dispenser.js';
import { registerUser } from '../courses/access.js';
import * as csv from './csv.js';
import * as people from './people.js';
import * as aud from './audiences.js';
import * as grp from './groups.js';
import * as qry from './query.js';
import { archiveStream } from './archive.js';
import { submissionStats } from './stats.js';
import type { Submission } from '../submissions/manager.js';

let env: CstuEnv;
beforeAll(async () => (env = await setupCstu()));
afterAll(() => env.cleanup());
beforeEach(async () => {
	for (const c of ['courses', 'audiences', 'groups', 'user_tasks', 'submissions'])
		await env.db.db.collection(c).deleteMany({});
	await env.db.c.courses.insertOne({ _id: 'cstu', students: ['cstu_bob', 'cstu_eve', 'cstu_admin', 'cstu_unknown'] });
});
const course = () => getCourse('cstu');
const ut = (username: string, taskid: string, o: Record<string, unknown> = {}) =>
	env.db.c.userTasks.insertOne({
		courseid: 'cstu',
		username,
		taskid,
		tried: 1,
		succeeded: false,
		grade: 50,
		submissionid: null,
		state: 'S',
		...o
	} as never);

describe('csv', () => {
	it('CSTU-18 escapes formulas and formats like make_csv', () => {
		expect(
			csv.toCsv([['=1+1', '-x', -3, '@a', 'a,"b"', true, false, ['a', 1], null, new Date(0), { k: 1 }, '\tz']])
		).toBe(`'=1+1,'-x,-3,'@a,"a,""b""",True,False,"['a', 1]",,1970-01-01T00:00:00.000Z,"{""k"":1}",'\tz\r\n`);
		expect(csv.dictCsv({ u1: { b: 1, sub: { x: 2 }, l: [] }, u2: { a: 'y', d: new Date(0) } })).toBe(
			'id,a,b,d,l,sub[x]\r\nu1,,1,,[],2\r\nu2,y,,1970-01-01T00:00:00.000Z,,\r\n'
		);
	});
	it('parses CSV files', () => {
		expect(csv.parseCsv('a,"b ""q"", c"\r\n\r\nx,y\nlast,"multi\nline"')).toEqual([
			['a', 'b "q", c'],
			['x', 'y'],
			['last', 'multi\nline']
		]);
		expect(csv.parseCsv('a,b\n')).toEqual([['a', 'b']]);
	});
	it('builds attachments', () => {
		const r = csv.csvDownload('x');
		expect([r.headers.get('content-type'), r.headers.get('content-disposition')]).toEqual([
			'text/csv; charset=utf-8',
			`attachment; filename="export.csv"; filename*=UTF-8''export.csv`
		]);
	});
});

describe('people', () => {
	it('CSTU-01 lists staff and students separately with their progress', async () => {
		await ut('cstu_bob', 'answer', { succeeded: true, grade: 100, tried: 2 });
		await ut('cstu_bob', '02_courses', { tried: 0, grade: 0 });
		expect((await people.staffList(course())).map((r) => r.username)).toEqual([
			'cstu_admin',
			'superadmin',
			'cstu_tutor'
		]);
		const list = await people.studentPage(course(), '', 1);
		expect(list.rows.map((r) => r.username)).toEqual(['cstu_unknown', 'cstu_bob', 'cstu_eve']);
		expect(list.rows[1]).toMatchObject({
			realname: 'Bob Cstu',
			task_tried: 1,
			task_succeeded: 1,
			total_tries: 2,
			grade: 20,
			task_grades: { answer: 100, '02_courses': 0 }
		});
		expect(await people.memberCounts(course())).toEqual({ students: 3, staff: 3, audiences: 0, groups: 0 });
		const text = await people.membersCsv(course());
		expect(text.split('\r\n')[0]).toBe(
			'id,email,grade,realname,task_grades[02_courses],task_grades[answer],task_succeeded,task_tried,total_tries,username'
		);
		expect(text.split('\r\n').map((l) => l.split(',')[0])).toEqual([
			'id',
			'cstu_admin',
			'superadmin',
			'cstu_tutor',
			'cstu_unknown',
			'cstu_bob',
			'cstu_eve',
			''
		]);
	});
	it('CSTU-01 searches and paginates the students on the server', async () => {
		const many = Array.from({ length: 60 }, (_, i) => `cstu_x${i}`);
		await env.db.c.courses.updateOne({ _id: 'cstu' }, { $push: { students: { $each: many } } });
		const first = await people.studentPage(course(), '', 'nope');
		expect([first.rows.length, first.matching, first.page, first.pages]).toEqual([people.PAGE_SIZE, 63, 1, 2]);
		const last = await people.studentPage(course(), '', 9);
		expect([last.rows.length, last.page]).toEqual([13, 2]);
		// Username, real name or email, case-insensitive.
		expect((await people.studentPage(course(), ' BOB ', 1)).rows.map((r) => r.username)).toEqual(['cstu_bob']);
		expect((await people.studentPage(course(), 'eve@x', 1)).rows.map((r) => r.username)).toEqual(['cstu_eve']);
		expect(await people.matchingStudents(course(), 'cstu_x5')).toEqual([
			'cstu_x5',
			'cstu_x50',
			'cstu_x51',
			'cstu_x52',
			'cstu_x53',
			'cstu_x54',
			'cstu_x55',
			'cstu_x56',
			'cstu_x57',
			'cstu_x58',
			'cstu_x59'
		]);
		expect(people.matches('', 'a')).toBe(true);
		expect(people.matches('z', 'a', undefined)).toBe(false);
	});
	it('CSTU-02 registers and unregisters students', async () => {
		expect(await registerUser(course(), 'cstu_dan', null, true)).toBe(true);
		expect(await registerUser(course(), 'cstu_dan', null, true)).toBe(false);
		expect(await registerUser(course(), 'nobody', null, true)).toBe(false);
		expect(await registerUser(course(), 'cstu_tutor', null, true)).toBe(false);
		await env.db.c.audiences.insertOne({
			courseid: 'cstu',
			description: 'A',
			students: ['cstu_dan', 'cstu_bob'],
			tutors: ['cstu_tutor']
		});
		await env.db.c.groups.insertOne({
			courseid: 'cstu',
			description: 'G',
			size: 2,
			students: ['cstu_dan'],
			audiences: []
		});
		await people.unregister(course(), ['cstu_dan']);
		expect((await env.db.c.courses.findOne({ _id: 'cstu' }))!.students).not.toContain('cstu_dan');
		await people.unregister(course(), null);
		expect((await env.db.c.courses.findOne({ _id: 'cstu' }))!.students).toEqual([]);
		expect(await env.db.c.audiences.findOne({})).toMatchObject({ students: [], tutors: ['cstu_tutor'] });
		expect((await env.db.c.groups.findOne({}))!.students).toEqual([]);
	});
	it('CSTU-09/10 computes the student task status and resets states', async () => {
		const sid = new ObjectId();
		await ut('cstu_eve', '02_courses', { submissionid: sid });
		await ut('cstu_eve', 'answer', { succeeded: true, grade: 100, submissionid: sid });
		await ut('cstu_eve', '03_tasks', { tried: 0 });
		const page = (o: Partial<{ q: string; status: string; page: unknown }> = {}) =>
			people.studentTaskPage(course(), 'cstu_eve', { lang: 'en', q: '', status: '', page: 1, ...o });
		const { rows, totals, matching, pages } = await page();
		expect(rows.map((r) => r.status)).toEqual(['failed', 'notattempted', 'succeeded', 'notviewed', 'notviewed']);
		expect(rows[0]).toMatchObject({
			taskid: '02_courses',
			name: '2. Courses',
			grade: 50,
			submissionid: String(sid),
			visible: true
		});
		expect([totals, matching, pages]).toEqual([{ tasks: 5, succeeded: 1, attempted: 2, submissions: 2 }, 5, 1]);
		// A task not open yet is listed but not counted in succeeded / total (like the course page).
		const d = course().dispenser;
		const saved = taskConfig(d, 'answer');
		d.config.answer = { ...saved, accessibility: { start: Infinity, end: Infinity, softEnd: Infinity } };
		try {
			const future = await page();
			expect(future.totals).toEqual({ tasks: 4, succeeded: 0, attempted: 2, submissions: 2 });
			expect(future.rows.find((r) => r.taskid === 'answer')).toMatchObject({ status: 'succeeded', visible: false });
		} finally {
			d.config.answer = saved; // same settings as before (the defaults when it had none)
		}
		expect((await page({ status: 'notviewed' })).rows.map((r) => r.taskid)).toEqual(['05_fetching_input', 'grp_mcq']);
		expect((await page({ status: 'bogus' })).matching).toBe(5);
		// Search on the task id or name.
		expect((await page({ q: 'answer TASK' })).rows.map((r) => r.taskid)).toEqual(['answer']);
		expect((await page({ q: '03_' })).rows.map((r) => r.taskid)).toEqual(['03_tasks']);
		expect((await people.studentTasksCsv(course(), 'cstu_eve', 'en')).split('\r\n')[0]).toBe(
			'id,grade,name,status,submissionid,taskid,tried,url,visible'
		);
		expect(await people.resetState(course(), 'cstu_eve', 'answer')).toBe(true);
		expect(await env.db.c.userTasks.findOne({ username: 'cstu_eve', taskid: 'answer' })).toMatchObject({
			state: '',
			grade: 100,
			tried: 1,
			succeeded: true
		});
		expect(await people.resetState(course(), 'cstu_eve', '05_fetching_input')).toBe(false);
		expect(people.taskName(course(), 'nope', 'en')).toBe('nope');
	});
	it('CSTU-16 counts the progress of the students only', async () => {
		await ut('cstu_bob', 'answer', { tried: 1 });
		await ut('cstu_eve', 'answer', { tried: 3, succeeded: true });
		await ut('cstu_unknown', 'answer', { tried: 0 });
		await ut('cstu_admin', 'answer', { tried: 5 });
		const { rows, pages } = await people.progress(course(), 'en');
		expect(pages).toBe(1);
		expect((await people.progress(course(), 'en', 1)).rows).toEqual(rows);
		expect(rows.find((r) => r.id === 'answer')).toEqual({
			id: 'answer',
			name: 'Answer task',
			viewed: 3,
			attempted: 2,
			succeeded: 1,
			attempts: 4
		});
		expect(rows[0]).toMatchObject({ id: '02_courses', viewed: 0 });
	});
});

describe('audiences', () => {
	it('CSTU-04 lists audiences with statistics and exports them', async () => {
		await aud.createAudience('cstu', 'A10');
		await env.db.c.audiences.insertOne({
			courseid: 'cstu',
			description: 'A2',
			students: ['cstu_bob'],
			tutors: ['cstu_tutor']
		});
		await env.db.c.audiences.insertOne({
			courseid: 'cstu_other',
			description: 'A1',
			students: ['cstu_bob'],
			tutors: []
		});
		await addSub(env.db, { username: ['cstu_bob'], result: 'success' });
		await addSub(env.db, { username: ['cstu_bob'], taskid: '02_courses' });
		// A group submission counts for its members of the audience only.
		await addSub(env.db, { username: ['cstu_eve', 'cstu_bob'], taskid: '03_tasks', result: 'success' });
		const list = await aud.audiencePage(course(), 'cstu_tutor', '', 1);
		expect(list.rows.map((r) => [r.description, r.tried, r.done, r.mine])).toEqual([
			['A2', 3, 2, true],
			['A10', 0, 0, false]
		]);
		expect([list.ids.length, list.matching, list.page, list.pages]).toEqual([2, 2, 1, 1]);
		expect((await aud.audiencePage(course(), 'cstu_tutor', 'a1', 1)).rows.map((r) => r.description)).toEqual(['A10']);
		const csvText = await aud.audiencesCsv(course(), 'cstu_tutor');
		expect(csvText.split('\r\n')[0]).toBe('id,_id,courseid,description,done,students,tried,tutors');
		expect(csvText).toContain(",cstu,A2,2,['cstu_bob'],3,['cstu_tutor']");
	});
	it('CSTU-04 paginates the audiences', async () => {
		for (let i = 1; i <= aud.AUDIENCE_PAGE_SIZE + 1; i++) await aud.createAudience('cstu', `L${i}`);
		const last = await aud.audiencePage(course(), 'x', '', 2);
		expect([last.rows.map((r) => r.description), last.ids.length, last.pages]).toEqual([
			[`L${aud.AUDIENCE_PAGE_SIZE + 1}`],
			aud.AUDIENCE_PAGE_SIZE + 1,
			2
		]);
	});
	it('CSTU-05 scopes, updates and deletes audiences', async () => {
		const { insertedId: id } = await env.db.c.audiences.insertOne({
			courseid: 'cstu',
			description: 'A',
			students: [],
			tutors: []
		});
		const { insertedId: foreign } = await env.db.c.audiences.insertOne({
			courseid: 'cstu_other',
			description: 'F',
			students: [],
			tutors: []
		});
		expect(await aud.findAudience('cstu', String(id))).toMatchObject({ description: 'A' });
		expect(await aud.findAudience('cstu', String(foreign))).toBeNull();
		expect(await aud.findAudience('cstu', 'bad')).toBeNull();
		expect(await aud.updateAudience(course(), id, { description: 'B', students: ['nobody'], tutors: [] }, true)).toBe(
			'User not found : nobody'
		);
		const update = {
			description: 'B',
			students: ['cstu_dan', 'cstu_bob', 'cstu_dan'],
			tutors: ['cstu_tutor', 'cstu_bob']
		};
		// Only admins may add (and thereby register) users who are not registered yet.
		expect(await aud.updateAudience(course(), id, update, false)).toBe('cstu_dan is not registered to this course.');
		expect((await env.db.c.courses.findOne({ _id: 'cstu' }))?.students ?? []).not.toContain('cstu_dan');
		expect(await aud.updateAudience(course(), id, update, true)).toBeNull();
		expect(await env.db.c.audiences.findOne({ _id: id })).toMatchObject({
			description: 'B',
			students: ['cstu_dan', 'cstu_bob'],
			tutors: ['cstu_tutor']
		});
		expect((await env.db.c.courses.findOne({ _id: 'cstu' }))!.students).toContain('cstu_dan');
		await aud.updateAudience(course(), foreign, { description: 'X', students: [], tutors: [] }, true);
		expect((await env.db.c.audiences.findOne({ _id: foreign }))!.description).toBe('F');
		await env.db.c.groups.insertOne({ courseid: 'cstu', description: 'G', size: 1, students: [], audiences: [id] });
		await aud.deleteAudiences('cstu', [id, foreign]);
		expect(await env.db.c.audiences.countDocuments()).toBe(1);
		expect((await env.db.c.groups.findOne({}))!.audiences).toEqual([]);
	});
	it('CSTU-06 downloads and uploads the structure', async () => {
		const { insertedId: kept } = await env.db.c.audiences.insertOne({
			courseid: 'cstu',
			description: 'Group A',
			students: ['cstu_eve', 'gone'],
			tutors: ['cstu_tutor']
		});
		await env.db.c.audiences.insertOne({ courseid: 'cstu', description: 'Old', students: [], tutors: [] });
		expect(await aud.structureCsv('cstu', 'email')).toBe(
			'cstu_eve@x.org,email,student,Group A\r\ncstu_tutor@x.org,email,tutor,Group A\r\n'
		);
		expect(await aud.structureCsv('cstu', 'username')).toContain('cstu_eve,username,student,Group A');
		expect(await aud.importStructure(course(), 'a,b,c')).toBe('File wrongly formatted.');
		const file =
			'cstu_dan,username,student,Group A\ncstu_bob@x.org,email,student,New\ncstu_tutor,username,tutor,TutorsOnly\nx,phone,student,A\nx,username,boss,A\nnobody,username,student,A\n';
		expect(await aud.importStructure(course(), file)).toBe('User was not found: nobody');
		const all = await env.db.c.audiences.find({ courseid: 'cstu' }).toArray();
		expect(all.map((a) => [a.description, a.students])).toEqual([
			['Group A', ['cstu_dan']],
			['New', ['cstu_bob']]
		]);
		expect(all[0]._id).toEqual(kept);
		expect((await env.db.c.courses.findOne({ _id: 'cstu' }))!.students).toContain('cstu_dan');
		expect(await aud.importStructure(course(), 'x,phone,student,A\nx,username,boss,A\n')).toBe('Unknown role: boss');
		expect(await aud.importStructure(course(), 'x,phone,student,A\n')).toBe('Field was not recognized: phone');
		expect(await aud.importStructure(course(), 'cstu_tutor,username,tutor,T\n')).toBeNull();
		expect(await env.db.c.audiences.find({ courseid: 'cstu' }).toArray()).toMatchObject([
			{ description: 'T', tutors: ['cstu_tutor'], students: [] }
		]);
	});
});

describe('groups', () => {
	it('CSTU-07 saves the structure with validation and course scoping', async () => {
		const { insertedId: a } = await env.db.c.audiences.insertOne({
			courseid: 'cstu',
			description: 'A',
			students: ['cstu_bob'],
			tutors: []
		});
		const { insertedId: old } = await env.db.c.groups.insertOne({
			courseid: 'cstu',
			description: 'Old',
			size: 3,
			students: ['cstu_bob', 'cstu_eve'],
			audiences: []
		});
		const { insertedId: gone } = await env.db.c.groups.insertOne({
			courseid: 'cstu',
			description: 'Gone',
			size: 3,
			students: [],
			audiences: []
		});
		const { insertedId: foreign } = await env.db.c.groups.insertOne({
			courseid: 'cstu_other',
			description: 'F',
			size: 3,
			students: [],
			audiences: []
		});
		expect(
			await grp.saveGroups(course(), [{ id: String(foreign), description: 'x', size: 1, students: [], audiences: [] }])
		).toBe(`group with id ${foreign} not found.`);
		const view = await grp.groupPage(course(), '', 1);
		expect(view.groups.map((g) => [g.description, g.members.map((m) => m.label)])).toEqual([
			['Gone', []],
			['Old', ['Bob Cstu (cstu_bob)', 'Eve Cstu (cstu_eve)']]
		]);
		expect([view.ungrouped, view.audiences, view.matching, view.pages]).toEqual([
			1,
			[{ id: String(a), description: 'A' }],
			2,
			1
		]);
		// Search on the description or a member.
		expect((await grp.groupPage(course(), 'cstu_eve', 1)).groups.map((g) => g.description)).toEqual(['Old']);
		expect((await grp.studentOptions(course(), 'cstu')).map((o) => o.value)).toEqual(['cstu_bob', 'cstu_eve']);
		expect(await grp.studentOptions(course(), 'eve.*')).toEqual([]);
		const msg = await grp.saveGroups(course(), [
			{ id: null, description: 'New', size: 2, students: ['cstu_bob', 'cstu_eve'], audiences: [String(a), 'zzz'] },
			{ id: String(old), description: 'Old2', size: 1, students: ['cstu_eve'], audiences: [] },
			{ id: null, description: 'Big', size: 1, students: ['cstu_unknown', 'cstu_admin'], audiences: [] }
		]);
		expect(msg).toBe(
			"Changes couldn't be applied for following students : cstu_eve cstu_unknown, cstu_admin".replace(
				' cstu_unknown',
				', cstu_unknown'
			)
		);
		const groups = await env.db.c.groups.find({ courseid: 'cstu' }).toArray();
		expect(groups.map((g) => [g.description, g.students, g.audiences])).toEqual([
			['Old2', ['cstu_eve'], []],
			['New', ['cstu_bob'], [a]],
			['Big', [], []]
		]);
		expect(await env.db.c.groups.findOne({ _id: gone })).toBeNull();
		expect(await env.db.c.groups.findOne({ _id: foreign })).not.toBeNull();
		expect(
			await grp.saveGroups(course(), [
				{ id: String(old), description: 'Old2', size: 2, students: ['cstu_bob'], audiences: [] }
			])
		).toBeNull();
		expect((await env.db.c.groups.findOne({ _id: old }))!.students).toEqual(['cstu_bob']);
		// Without `replace`, the other groups are kept (editor saving one group).
		expect(
			await grp.saveGroups(course(), [{ id: null, description: 'One', size: 1, students: [], audiences: [] }], false)
		).toBeNull();
		expect(await env.db.c.groups.countDocuments({ courseid: 'cstu' })).toBe(2);
	});
	it('CSTU-07 paginates, cleans and deletes groups', async () => {
		await env.db.c.groups.insertMany(
			Array.from({ length: grp.GROUP_PAGE_SIZE + 1 }, (_, i) => ({
				courseid: 'cstu',
				description: `G${i + 1}`,
				size: 2,
				students: i ? [] : ['cstu_bob'],
				audiences: []
			}))
		);
		const last = await grp.groupPage(course(), '', 2);
		expect([last.groups.map((g) => g.description), last.pages, last.ungrouped]).toEqual([
			[`G${grp.GROUP_PAGE_SIZE + 1}`],
			2,
			2
		]);
		await grp.cleanGroups('cstu');
		expect(await env.db.c.groups.countDocuments({ courseid: 'cstu', 'students.0': { $exists: true } })).toBe(0);
		const one = await env.db.c.groups.findOne({ courseid: 'cstu' });
		await grp.deleteGroups('cstu', 'malformed');
		await grp.deleteGroups('cstu_other', String(one!._id));
		expect(await env.db.c.groups.countDocuments({ courseid: 'cstu' })).toBe(grp.GROUP_PAGE_SIZE + 1);
		await grp.deleteGroups('cstu', String(one!._id));
		expect(await env.db.c.groups.countDocuments({ courseid: 'cstu' })).toBe(grp.GROUP_PAGE_SIZE);
		await grp.deleteGroups('cstu', null);
		expect(await env.db.c.groups.countDocuments({ courseid: 'cstu' })).toBe(0);
	});
	it('CSTU-08 dumps and parses YAML', async () => {
		const id = new ObjectId();
		await env.db.c.groups.insertOne({
			courseid: 'cstu',
			description: 'G1',
			size: 2,
			students: ['cstu_eve', 'cstu_bob'],
			audiences: [id]
		});
		const text = await grp.groupsYaml('cstu');
		expect(text).toBe(
			`- audiences:\n  - ${id}\n  description: G1\n  size: 2\n  students:\n  - cstu_eve\n  - cstu_bob\n`
		);
		expect(grp.parseGroups(text.replace('- audiences', `- _id: ${id}\n  audiences`))).toEqual([
			{ id: null, description: 'G1', size: 2, students: ['cstu_eve', 'cstu_bob'], audiences: [String(id)] }
		]);
		expect(grp.parseGroups('- description: x')).toBeNull();
		expect(grp.parseGroups('a: [')).toBeNull();
	});
});

describe('query', () => {
	it('CSTU-11 sanitises the parameters', () => {
		const q = qry.parseQuery(
			new URLSearchParams(
				'users=a,b&users=c&tasks=&grade_min=abc&grade_max=50&sort_by=evil&order=1&limit=x&page=2&eval=on&stat=pond_stat'
			)
		);
		expect(q).toMatchObject({
			users: ['a', 'b', 'c'],
			tasks: [],
			grade_min: null,
			grade_max: 50,
			sort_by: 'submitted_on',
			order: 1,
			limit: null,
			page: 2,
			eval: true,
			crashes_only: false,
			stat: 'pond_stat',
			date_after: ''
		});
		expect(qry.parseIso('2026-10-14 05:31:00+0200')).toEqual(new Date('2026-10-14T03:31:00Z'));
		expect(qry.parseIso('2026-10-14T05:31')).toEqual(new Date('2026-10-14T05:31:00Z'));
		expect(qry.parseIso('2026-10-14')).toEqual(new Date('2026-10-14T00:00:00Z'));
		expect([qry.parseIso(''), qry.parseIso('nope'), qry.parseIso('2026-13-45')]).toEqual([null, false, false]);
	});
	it('CSTU-11 selects, sorts and paginates submissions', async () => {
		const { insertedId: a } = await env.db.c.audiences.insertOne({
			courseid: 'cstu',
			description: 'A',
			students: ['cstu_eve', 'cstu_gone'],
			tutors: ['cstu_tutor']
		});
		const ids = [];
		for (const [i, [u, task, result, grade]] of (
			[
				['cstu_bob', 'answer', 'success', 100],
				['cstu_eve', '02_courses', 'failed', 50],
				['cstu_eve', '03_tasks', 'crash', 0],
				['cstu_gone', 'answer', 'timeout', 0],
				['cstu_dan', 'answer', 'failed', 0]
			] as const
		).entries())
			ids.push(
				await addSub(env.db, {
					username: [u],
					taskid: task,
					result,
					grade,
					date: `2026-10-1${i}T10:00:00Z`,
					tests: { good: true, misc: false, org1: true, '*auto-tag-1': 'x'.repeat(40) }
				})
			);
		await addSub(env.db, { courseid: 'cstu_other', username: ['cstu_bob'] });
		await ut('cstu_eve', '02_courses', { submissionid: ids[1] });
		const run = async (s: string) => await qry.listSubmissions(course(), qry.parseQuery(new URLSearchParams(s)), 'en');
		const users = async (s: string) => (await run(s)).rows.map((r) => r.users.join('+'));
		expect(await users('')).toEqual(['cstu_eve', 'cstu_eve', 'cstu_bob']);
		expect(await users('users=cstu_bob,nobody')).toEqual(['cstu_bob']);
		expect(await users('users=nobody')).toHaveLength(3);
		expect(await users(`audiences=${a}`)).toEqual(['cstu_gone', 'cstu_eve', 'cstu_eve']);
		expect(await users(`audiences=${a}&users=cstu_eve&tasks=03_tasks,unknown`)).toEqual(['cstu_eve']);
		expect(await users('org_categories=catA&order=1&sort_by=grade')).toEqual(['cstu_eve', 'cstu_bob']);
		expect(await users('grade_min=50&grade_max=50')).toEqual(['cstu_eve']);
		expect(await users('crashes_only=on')).toEqual(['cstu_eve']);
		expect(await users('grade_min=1000')).toEqual([]);
		expect(await users('eval=on')).toEqual(['cstu_eve']);
		expect(await users('date_after=2026-10-11&date_before=2026-10-11 23:00')).toEqual(['cstu_eve']);
		const bad = await run('date_after=nope');
		expect([bad.error, bad.rows.length]).toEqual(['Invalid dates', 3]);
		const p = await run('limit=2&page=2&show_stud_name=on&show_task_name=on&show_tags=on');
		expect([p.count, p.page, p.pages]).toEqual([3, 2, 2]);
		expect(p.rows[0]).toMatchObject({
			users: ['Bob Cstu'],
			task: 'Answer task',
			userIds: ['cstu_bob'],
			taskid: 'answer',
			result: 'success',
			grade: 100,
			eval: false,
			lastReplay: null
		});
		expect(p.rows[0].tags).toEqual([
			{ label: 'Good answer', tone: 'success', title: 'The answer was right' },
			{ label: `${'x'.repeat(30)}…`, tone: 'warning', title: 'x'.repeat(40) }
		]);
		expect((await run('limit=2&page=9')).page).toBe(2);
		expect((await run('eval=on')).rows[0].eval).toBe(true);
		const text = await qry.submissionsCsv(course(), qry.parseQuery(new URLSearchParams('')));
		expect(text.split('\r\n')[0]).toBe(
			'id,courseid,eval,grade,last_replay,result,status,submitted_on,taskid,tests[*auto-tag-1],tests[good],tests[misc],tests[org1],username'
		);
		expect(text.split('\r\n')).toHaveLength(5);
		const options = await qry.queryOptions(course(), 'cstu_tutor', 'en');
		expect(options.users.find((u) => u.value === 'cstu_eve')).toEqual({
			value: 'cstu_eve',
			label: 'Eve Cstu (cstu_eve)',
			mine: true
		});
		expect(options.audiences).toEqual([{ value: String(a), label: 'A', mine: true }]);
		expect(options.org_categories.map((c) => c.value)).toEqual(['catA', 'catB']);
		expect(options.tasks[0]).toEqual({ value: '02_courses', label: '2. Courses' });
		expect(options.search).toEqual([]);
		// Long lists: only the selected and tutored choices are sent, the others are searched.
		const q = qry.parseQuery(new URLSearchParams('users=cstu_bob&tasks=answer&org_categories=catB'));
		const long = await qry.queryOptions(course(), 'cstu_tutor', 'en', q, 0);
		expect(long.search).toEqual(['users', 'audiences', 'tasks', 'org_categories']);
		expect(long.users.map((u) => u.value).sort()).toEqual(['cstu_bob', 'cstu_eve']);
		expect([long.audiences.length, long.tasks, long.org_categories.map((c) => c.value)]).toEqual([
			1,
			[{ value: 'answer', label: 'Answer task' }],
			['catB']
		]);
		expect((await qry.queryOptions(course(), 'cstu_bob', 'en', undefined, 0)).audiences).toEqual([]);
		const find = (list: qry.ListName, text: string) => qry.searchOptions(course(), list, text, 'en');
		expect(await find('users', 'EVE')).toEqual([{ value: 'cstu_eve', label: 'Eve Cstu (cstu_eve)' }]);
		expect(await find('users', 'nobody')).toEqual([]);
		expect(await find('audiences', 'a')).toEqual([{ value: String(a), label: 'A' }]);
		expect(await find('tasks', 'COURSES')).toEqual([{ value: '02_courses', label: '2. Courses' }]);
		expect(await find('org_categories', 'catb')).toEqual([{ value: 'catB', label: 'catB' }]);
	});
});

/** Lists the entries of a gzipped tar stream: name -> content (directories: null). */
async function untar(stream: ReadableStream): Promise<Record<string, string | null>> {
	const buf = gunzipSync(Buffer.from(await new Response(stream).arrayBuffer()));
	const ex = extract();
	Readable.from([buf]).pipe(ex);
	const out: Record<string, string | null> = {};
	for await (const e of ex) {
		const chunks: Uint8Array[] = [];
		for await (const c of e) chunks.push(c as Uint8Array);
		out[e.header.name] = e.header.type === 'directory' ? null : Buffer.concat(chunks).toString();
	}
	return out;
}

/** Builds a grader archive with a normal file, a directory and malicious members. */
async function graderArchive(): Promise<Uint8Array> {
	const p = pack();
	p.entry({ name: 'answer.txt' }, 'answer=42');
	p.entry({ name: 'dir', type: 'directory' });
	p.entry({ name: '../evil.txt' }, 'evil');
	p.entry({ name: '/abs/x.txt' }, 'abs');
	p.entry({ name: 'link', type: 'symlink', linkname: '/etc/passwd' });
	p.entry({ name: './', type: 'directory' });
	p.finalize();
	const chunks: Uint8Array[] = [];
	for await (const c of p) chunks.push(c as Uint8Array);
	return gzipSync(Buffer.concat(chunks));
}

describe('archive', () => {
	it('CSTU-13 builds the legacy layouts with sanitised names', async () => {
		await env.db.c.audiences.insertOne({
			courseid: 'cstu',
			description: 'Group A/..',
			students: ['cstu_eve'],
			tutors: []
		});
		const file = { filename: 'up.tar.gz', value: Buffer.from('data') };
		const i1 = await addSub(env.db, {
			username: ['cstu_eve', 'cstu_bob'],
			date: '2026-10-14T05:31:16.070Z',
			archive: await graderArchive(),
			input: {
				answer: '1',
				upload: file,
				'../x': { filename: 'a.txt', value: Buffer.from('y') },
				submission: { filename: '.test' }
			}
		});
		const i2 = await addSub(env.db, { username: ['cstu_eve'], archive: new Uint8Array([1, 2, 3]) });
		const docs = (await env.db.c.submissions.find({}).sort({ submitted_on: -1 }).toArray()) as Submission[];
		const auds = await audiencesPerStudent('cstu');
		const a = await untar(archiveStream(docs, ['taskid', 'username', 'submissiondateid'], false, auds));
		const base = 'answer/cstu_eve/2026-10-14T05:31:16.070000+00:00';
		expect(
			Object.keys(a)
				.filter((k) => k.startsWith(base))
				.map((k) => k.slice(base.length + 1))
				.sort()
		).toEqual([
			'archive',
			'archive/abs/x.txt',
			'archive/answer.txt',
			'archive/dir',
			'archive/evil.txt',
			'submission.test',
			'uploaded_files/.._x.txt',
			'uploaded_files/submission.test',
			'uploaded_files/upload.tar.gz'
		]);
		expect(a[`${base}/archive/answer.txt`]).toBe('answer=42');
		expect(Object.keys(a).some((k) => k.startsWith('answer/cstu_bob/2026-10-14'))).toBe(true);
		expect(parse(a[`${base}/submission.test`]!)).toMatchObject({
			_id: String(i1),
			courseid: 'cstu',
			username: ['cstu_eve', 'cstu_bob']
		});
		const s = await untar(archiveStream(docs, ['audience', 'taskid'], true, auds));
		expect(Object.keys(s)).toContain(
			`Group_A_.._(${(await env.db.c.audiences.findOne({}))!._id})/answer/upload.tar.gz`
		);
		expect(Object.keys(s)).toContain('cstu_bob-cstu_eve/answer/submission.test');
		expect(Object.keys(s).filter((k) => /\/answer(-1)?\/submission\.test$/.test(k))).toHaveLength(3);
		const one = await untar(archiveStream([docs[1]], [], false, {}));
		expect(Object.keys(one)).toEqual(['submission.test']);
		expect(String(docs[1]._id)).toBe(String(i2));
		const dup = await untar(archiveStream([docs[1], docs[1]], ['taskid'], false, {}));
		expect(Object.keys(dup)).toEqual(['answer/submission.test', 'answer-1/submission.test']);
	});
});

describe('stats', () => {
	it('CSTU-17 computes the submission statistics', async () => {
		const now = new Date('2026-10-14T12:00:00Z');
		const ids = [];
		for (const [u, task, result, date, tests] of [
			[['cstu_bob'], 'answer', 'success', '2026-10-14T10:30:00Z', { good: true }],
			[['cstu_bob'], 'answer', 'failed', '2026-10-13T10:00:00Z', { misc: true }],
			[['cstu_eve', 'cstu_bob'], 'grp_mcq', 'failed', '2026-10-01T09:00:00Z', {}],
			[['cstu_eve'], 'answer', 'failed', '2026-09-01T09:00:00Z', {}]
		] as const)
			ids.push(await addSub(env.db, { username: [...u], taskid: task, result, date, tests }));
		await ut('cstu_bob', 'answer', { submissionid: ids[0] });
		const s = await submissionStats(course(), qry.parseQuery(new URLSearchParams('')), 'en', now);
		expect(s.query.date_after).toBe('2026-09-30T00:00');
		expect([s.hourly, s.chart.labels.length, s.chart.labels[0]]).toEqual([false, 15, '2026-09-30T00:00:00.000Z']);
		expect([s.chart.all.reduce((a, b) => a + b), s.chart.valid[14], s.chart.all[1]]).toEqual([3, 1, 1]);
		expect(s.global).toEqual({ total: 3, evalTotal: 1, evalSucceeded: 1 });
		expect(s.tasks).toEqual([
			{ key: 'Answer task', id: 'answer', submissions: 2, valid: 1 },
			{ key: 'Grp MCQ (group task)', id: 'grp_mcq', submissions: 1, valid: 0 }
		]);
		expect(s.users).toEqual([
			{ key: 'cstu_bob', name: 'Bob Cstu', submissions: 3, valid: 1 },
			{ key: 'cstu_eve', name: 'Eve Cstu', submissions: 1, valid: 0 }
		]);
		// The last day (today) is still running; a range ending at a past midnight is complete.
		expect(s.chart.partial).toBe(true);
		const past = qry.parseQuery(new URLSearchParams('date_after=2026-10-01T00:00&date_before=2026-10-09T23:59'));
		expect((await submissionStats(course(), past, 'en', now)).chart.partial).toBe(false);
		expect(s.tags).toEqual([
			{ name: 'Good answer', description: 'The answer was right', misconception: false, all: '25', best: '100' },
			{ name: 'Misconception', description: 'Some misconception', misconception: true, all: '25', best: '0' }
		]);
		const w = await submissionStats(
			course(),
			qry.parseQuery(new URLSearchParams('stat=pond_stat&date_after=2026-10-13T00:00&limit=1')),
			'en',
			now
		);
		expect([w.hourly, w.chart.labels.length, w.global.total, w.tags[0].all]).toEqual([true, 37, 1, '100']);
		const p = await submissionStats(course(), qry.parseQuery(new URLSearchParams('stat=pond_stat')), 'en', now);
		expect(p.tags[0].all).toBe('16.6');
		const many = await submissionStats(
			course(),
			qry.parseQuery(new URLSearchParams('date_after=2026-01-01')),
			'en',
			now
		);
		expect(many.tags[0].all).toBe('20');
		const empty = await submissionStats(
			course(),
			qry.parseQuery(new URLSearchParams('date_before=bad&tasks=02_courses')),
			'en',
			now
		);
		expect([empty.error, empty.tags]).toEqual(['Invalid dates', []]);
		// A user without account (deleted) is shown by username.
		await addSub(env.db, {
			username: ['cstu_unknown'],
			taskid: 'answer',
			result: 'failed',
			date: '2026-10-14T11:00:00Z'
		});
		const gone = await submissionStats(course(), qry.parseQuery(new URLSearchParams('')), 'en', now);
		expect(gone.users.find((u) => u.key === 'cstu_unknown')?.name).toBe('cstu_unknown');
	});
});

describe('edge cases', () => {
	it('CSTU-11/12/13 handles incomplete documents', async () => {
		const input = await env.db.putInput({
			'': { filename: 'archive.tar.bz2', value: Buffer.from('z') },
			x: { filename: 'noext' }
		});
		await env.db.c.submissions.insertOne({
			courseid: 'cstu',
			taskid: 'answer',
			username: ['cstu_unknown'],
			input,
			status: 'error',
			submitted_on: new Date('2026-10-10T00:00:00Z'),
			last_replay: new Date('2026-10-11T00:00:00Z'),
			tests: { misc: true, '*auto-tag-2': 'short' }
		} as never);
		await env.db.c.groups.insertOne({ courseid: 'cstu', description: 'NoAud', size: 1, students: [] } as never);
		const q = qry.parseQuery(new URLSearchParams('show_stud_name=on&show_tags=on&order=1'));
		const { rows } = await qry.listSubmissions(course(), q, 'en');
		expect(rows[0]).toMatchObject({
			users: ['?'],
			result: 'crash',
			grade: 0,
			lastReplay: '2026-10-11T00:00:00.000Z',
			tags: [
				{ label: 'Misconception', tone: 'error' },
				{ label: 'short', tone: 'warning' }
			]
		});
		expect(await qry.submissionsCsv(course(), q)).toContain('tests[misc]');
		const { docs } = await qry.selectedSubmissions(course(), q);
		const files = gunzipSync(Buffer.from(await new Response(archiveStream(docs, [], true, {})).arrayBuffer())).toString(
			'latin1'
		);
		expect(files).toContain('.tar.bz2');
		expect(files).toContain('x\0');
		expect(await grp.groupsYaml('cstu')).toContain('audiences: []');
	});
});
