/** Unit tests of the people & results routes (CSTU-01..18): guards, loads, actions and downloads. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ObjectId } from 'mongodb';
import { addSub, setupCstu, type CstuEnv } from '../../../../../tests/fixtures/cstu/setup.js';
import { outcome } from '../../../../../tests/fixtures/nav/setup.js';
import { services } from '#lib/server/app.js';
import * as students from './+page.server.js';
import { GET as studentFiles } from './[file]/+server.js';
import * as audience from '../edit/audience/[audienceid]/+page.server.js';
import * as student from '../student/[username]/+page.server.js';
import * as submissions from '../submissions/+page.server.js';
import { GET as submissionFiles } from '../submissions/[file]/+server.js';
import * as stats from '../stats/+page.server.js';
import * as submission from '../../../submission/[submissionid]/+page.server.js';

let env: CstuEnv;
beforeAll(async () => (env = await setupCstu()));
afterAll(() => env.cleanup());
beforeEach(async () => {
	for (const c of ['courses', 'audiences', 'groups', 'user_tasks', 'submissions'])
		await env.db.db.collection(c).deleteMany({});
	await env.db.c.courses.insertOne({ _id: 'cstu', students: ['cstu_bob', 'cstu_eve'] });
});

/** Fake request event: `form` entries make it a POST (repeated keys and files allowed). */
function ev(
	username: string | null,
	params: Record<string, string>,
	opts: { url?: string; form?: [string, string | File][] } = {}
) {
	const url = new URL(`http://localhost/x${opts.url ?? ''}`);
	let body: FormData | undefined;
	if (opts.form) {
		body = new FormData();
		for (const [k, v] of opts.form) body.append(k, v);
	}
	return {
		locals: {
			user: username
				? {
						username,
						realname: username,
						email: `${username}@x.org`,
						language: 'en',
						timezone: 'UTC',
						codeIndentation: '4',
						superadmin: username === 'superadmin'
					}
				: null,
			lang: 'en',
			session: { doc: {} }
		},
		params,
		url,
		cookies: { get: () => undefined, set: () => {}, delete: () => {} },
		getClientAddress: () => '127.0.0.1',
		request: new Request(url, body ? { method: 'POST', body } : {})
	} as never;
}
const C = { courseid: 'cstu' };
const text = async (r: Response) =>
	r.headers.get('content-type')?.includes('gzip')
		? gunzipSync(Buffer.from(await r.arrayBuffer())).toString('latin1')
		: r.text();

describe('user management', () => {
	it('CSTU-01/18 lists the members for the staff only', async () => {
		const load = (url: string, courseid = 'cstu') =>
			outcome(() => students.load(ev('cstu_tutor', { courseid }, { url })));
		const data = await load('?tab=audiences&q=zz');
		expect([data.tab, data.q, data.counts, data.audiences.matching, data.students]).toEqual([
			'audiences',
			'zz',
			{ students: 2, staff: 3, audiences: 0, groups: 0 },
			0,
			null
		]);
		expect((await load('')).students.rows).toHaveLength(2);
		expect((await load('?tab=staff')).staff).toHaveLength(3);
		expect((await load('?tab=groups')).groups.ungrouped).toBe(2);
		// Unknown tabs and the groups of LTI courses show the students.
		expect((await load('?tab=bogus')).tab).toBe('students');
		const lti = await load('?tab=groups', 'cstu_lti');
		expect([lti.tab, lti.counts.groups, lti.groups]).toEqual(['students', null, null]);
		expect(await outcome(() => students.load(ev('cstu_bob', C)))).toMatchObject({ status: 403 });
		expect(await outcome(() => students.load(ev('other_tutor', C)))).toMatchObject({ status: 403 });
		expect(await outcome(() => students.load(ev(null, C)))).toMatchObject({ status: 302 });
	});
	it('CSTU-02 registration is admin-only', async () => {
		const act = (u: string, name: 'register' | 'unregister', form: [string, string][]) =>
			outcome(() => students.actions[name](ev(u, C, { form })));
		expect(await act('cstu_tutor', 'register', [['username', 'cstu_dan']])).toMatchObject({ status: 403 });
		expect(await act('cstu_admin', 'register', [['username', 'cstu_dan']])).toEqual({ message: 'User registered.' });
		expect(await act('cstu_admin', 'register', [['username', 'nobody']])).toMatchObject({ status: 400 });
		expect(await act('cstu_tutor', 'unregister', [['all', '1']])).toMatchObject({ status: 403 });
		await act('cstu_admin', 'unregister', [
			['selected', 'cstu_dan'],
			['selected', 'cstu_bob']
		]);
		expect((await env.db.c.courses.findOne({ _id: 'cstu' }))!.students).toEqual(['cstu_eve']);
		await act('cstu_admin', 'register', [['username', 'cstu_dan']]);
		// "Unregister all" while searching: only the matching students.
		await act('cstu_admin', 'unregister', [
			['all', '1'],
			['q', 'dan']
		]);
		expect((await env.db.c.courses.findOne({ _id: 'cstu' }))!.students).toEqual(['cstu_eve']);
		await act('superadmin', 'unregister', [['all', '1']]);
		expect((await env.db.c.courses.findOne({ _id: 'cstu' }))!.students).toEqual([]);
	});
	it('CSTU-04/06 audiences: creation by staff, upload by admins', async () => {
		expect(
			await outcome(() => students.actions.audience(ev('cstu_tutor', C, { form: [['description', ' Lab 1 ']] })))
		).toEqual({ message: 'New audience created.' });
		expect(await env.db.c.audiences.findOne({})).toMatchObject({
			description: 'Lab 1',
			courseid: 'cstu',
			students: [],
			tutors: []
		});
		const up = (u: string, form: [string, string | File][]) =>
			outcome(() => students.actions.audiences(ev(u, C, { form })));
		expect(await up('cstu_tutor', [])).toMatchObject({ status: 403 });
		expect(await up('cstu_admin', [])).toMatchObject({
			status: 400,
			data: { message: 'An error occurred while parsing the data.' }
		});
		expect(await up('cstu_admin', [['file', new File(['cstu_dan,username,student,Lab 1\n'], 'a.csv')]])).toEqual({
			message: 'Audiences updated.'
		});
		expect((await env.db.c.audiences.findOne({}))!.students).toEqual(['cstu_dan']);
		expect(await up('cstu_admin', [['file', new File(['a,b\n'], 'a.csv')]])).toMatchObject({ status: 400 });
	});
	it('CSTU-07/08 groups: JSON editor and YAML upload, not for LTI courses', async () => {
		const grp = (u: string, json: string, courseid = 'cstu') =>
			outcome(() => students.actions.groups(ev(u, { courseid }, { form: [['groups', json]] })));
		expect(
			await grp(
				'cstu_tutor',
				JSON.stringify([{ id: null, description: 'G', size: 2, students: ['cstu_bob'], audiences: [] }])
			)
		).toEqual({ message: 'Groups updated.' });
		expect(await grp('cstu_tutor', '{bad')).toMatchObject({
			status: 400,
			data: { message: 'An error occurred while parsing the data.' }
		});
		expect(
			await grp('cstu_tutor', JSON.stringify([{ id: String(new ObjectId()), description: 'G', size: 2 }]))
		).toMatchObject({ status: 400 });
		expect(await grp('cstu_tutor', '[]', 'cstu_lti')).toMatchObject({ status: 403 });
		const yaml = (u: string, content?: string) =>
			outcome(() =>
				students.actions.uploadGroups(
					ev(u, C, { form: content === undefined ? [] : [['file', new File([content], 'g.yaml')]] })
				)
			);
		expect(await yaml('cstu_tutor')).toMatchObject({ status: 400 });
		expect(await env.db.c.groups.countDocuments()).toBe(1);
		expect(
			await yaml('cstu_tutor', '- description: Team\n  size: 1\n  students: [cstu_eve]\n  audiences: []\n')
		).toEqual({ message: 'Groups updated.' });
		expect(await env.db.c.groups.find({}).toArray()).toMatchObject([{ description: 'Team', students: ['cstu_eve'] }]);
		const act = (name: 'cleanGroups' | 'deleteGroups', form: [string, string][] = [], courseid = 'cstu') =>
			outcome(() => students.actions[name](ev('cstu_tutor', { courseid }, { form })));
		expect(await act('cleanGroups')).toEqual({ message: 'Groups updated.' });
		expect((await env.db.c.groups.findOne({}))!.students).toEqual([]);
		const id = String((await env.db.c.groups.findOne({}))!._id);
		await grp('cstu_tutor', JSON.stringify([{ id: null, description: 'Other', size: 1 }]));
		expect(await act('deleteGroups', [['id', id]])).toEqual({ message: 'Groups updated.' });
		expect((await env.db.c.groups.find({}).toArray()).map((g) => g.description)).toEqual(['Other']);
		await act('deleteGroups');
		expect(await env.db.c.groups.countDocuments()).toBe(0);
		expect(await act('cleanGroups', [], 'cstu_lti')).toMatchObject({ status: 403 });
	});
	it('CSTU-01/04/06/08 downloads', async () => {
		await env.db.c.audiences.insertOne({ courseid: 'cstu', description: 'A', students: ['cstu_bob'], tutors: [] });
		const get = (file: string, url = '') =>
			outcome(() => studentFiles(ev('cstu_tutor', { courseid: 'cstu', file }, { url })));
		expect((await text(await get('students.csv'))).split('\r\n')[0]).toContain('id,email,grade,realname');
		expect(await text(await get('audiences.csv'))).toContain(',A,');
		expect(await text(await get('audiences-structure.csv', '?preferred_field=email'))).toBe(
			'cstu_bob@x.org,email,student,A\r\n'
		);
		expect(await text(await get('audiences-structure.csv'))).toBe('cstu_bob,username,student,A\r\n');
		expect((await get('groups.yaml')).headers.get('content-type')).toBe('text/x-yaml');
		expect(await get('toString')).toMatchObject({ status: 404 });
		expect(await (await get('students.json', '?q=bob')).json()).toEqual([
			{ value: 'cstu_bob', label: 'Bob Cstu (cstu_bob)' }
		]);
		expect(await outcome(() => studentFiles(ev('cstu_bob', { courseid: 'cstu', file: 'students.csv' })))).toMatchObject(
			{ status: 403 }
		);
	});
});

describe('audience edition', () => {
	it('CSTU-05 edits and deletes audiences of the course only', async () => {
		const { insertedId: id } = await env.db.c.audiences.insertOne({
			courseid: 'cstu',
			description: 'A',
			students: ['cstu_bob'],
			tutors: ['cstu_tutor']
		});
		const { insertedId: foreign } = await env.db.c.audiences.insertOne({
			courseid: 'cstu_other',
			description: 'F',
			students: [],
			tutors: []
		});
		const p = (aid: ObjectId | string) => ({ courseid: 'cstu', audienceid: String(aid) });
		const data = await outcome(() => audience.load(ev('cstu_tutor', p(id))));
		expect(data.audience).toEqual({
			id: String(id),
			description: 'A',
			tutors: ['cstu_tutor'],
			students: [{ value: 'cstu_bob', label: 'Bob Cstu (cstu_bob)' }]
		});
		expect(data.staff.map((s: { value: string }) => s.value)).toEqual(['cstu_admin', 'superadmin', 'cstu_tutor']);
		expect(await outcome(() => audience.load(ev('cstu_tutor', p(foreign))))).toMatchObject({ status: 404 });
		expect(await outcome(() => audience.load(ev('cstu_tutor', p('zz'))))).toMatchObject({ status: 404 });
		const upd = (form: [string, string][], user = 'cstu_tutor') =>
			outcome(() => audience.actions.update(ev(user, p(id), { form })));
		const form: [string, string][] = [
			['description', 'B'],
			['students', 'cstu_dan'],
			['tutors', 'cstu_admin']
		];
		// A tutor cannot register a user by adding them to an audience; an admin can.
		expect(await upd(form)).toMatchObject({
			status: 400,
			data: { message: 'cstu_dan is not registered to this course.' }
		});
		expect(await upd(form, 'cstu_admin')).toEqual({ message: 'Audience updated.' });
		expect(await upd([['students', 'nobody']])).toMatchObject({
			status: 400,
			data: { message: 'User not found : nobody' }
		});
		expect(await env.db.c.audiences.findOne({ _id: id })).toMatchObject({
			description: 'B',
			students: ['cstu_dan'],
			tutors: ['cstu_admin']
		});
		expect(await outcome(() => audience.actions.delete(ev('cstu_tutor', p(foreign), { form: [] })))).toMatchObject({
			status: 404
		});
		expect(await outcome(() => audience.actions.delete(ev('cstu_tutor', p(id), { form: [] })))).toEqual({
			status: 303,
			location: '/admin/cstu/students?tab=audiences'
		});
		expect(await env.db.c.audiences.countDocuments()).toBe(1);
	});
});

describe('student page', () => {
	it('CSTU-09/10 shows the task status, resets states, exports CSV', async () => {
		await env.db.c.userTasks.insertOne({
			courseid: 'cstu',
			username: 'cstu_bob',
			taskid: 'answer',
			tried: 1,
			succeeded: true,
			grade: 100,
			submissionid: null,
			state: 'x'
		} as never);
		const p = { courseid: 'cstu', username: 'cstu_bob' };
		const data = await outcome(() => student.load(ev('cstu_tutor', p)));
		expect([data.realname, data.rows.length, data.totals.succeeded]).toEqual(['Bob Cstu', 5, 1]);
		const filtered = await outcome(() => student.load(ev('cstu_tutor', p, { url: '?status=succeeded&q=answer' })));
		expect([filtered.status, filtered.q, filtered.rows.map((r: { taskid: string }) => r.taskid)]).toEqual([
			'succeeded',
			'answer',
			['answer']
		]);
		// Only users related to the course: unknown and foreign users are 404, former students with submissions are kept.
		const other = (username: string) => ({ courseid: 'cstu', username });
		expect(await outcome(() => student.load(ev('cstu_tutor', other('ghost'))))).toMatchObject({ status: 404 });
		await env.db.c.users.insertOne({ username: 'cstu_far', realname: 'Far Away', email: 'f@x', bindings: {} } as never);
		expect(await outcome(() => student.load(ev('cstu_tutor', other('cstu_far'))))).toMatchObject({ status: 404 });
		const csv = (username: string) =>
			outcome(() =>
				studentFiles(ev('cstu_tutor', { courseid: 'cstu', file: 'student.csv' }, { url: `?username=${username}` }))
			);
		expect(await csv('cstu_far')).toMatchObject({ status: 404 });
		await addSub(env.db, { username: ['cstu_far'] });
		expect((await outcome(() => student.load(ev('cstu_tutor', other('cstu_far'))))).realname).toBe('Far Away');
		expect((await csv('cstu_far')).status).toBe(200);
		await env.db.c.users.deleteOne({ username: 'cstu_far' });
		// A deleted account keeps its submissions: shown under its username.
		expect((await outcome(() => student.load(ev('cstu_tutor', other('cstu_far'))))).realname).toBe('cstu_far');
		expect(await outcome(() => student.actions.reset(ev('cstu_tutor', p, { form: [['taskid', 'answer']] })))).toEqual({
			message: 'Task state reset.'
		});
		expect(await outcome(() => student.actions.reset(ev('cstu_tutor', p, { form: [] })))).toMatchObject({
			status: 404
		});
		expect(await outcome(() => student.actions.reset(ev('cstu_bob', p, { form: [] })))).toMatchObject({ status: 403 });
		expect(
			(
				await text(
					await outcome(() =>
						studentFiles(ev('cstu_tutor', { courseid: 'cstu', file: 'student.csv' }, { url: '?username=cstu_bob' }))
					)
				)
			).split('\r\n')
		).toHaveLength(7);
	});
});

describe('submissions', () => {
	it('CSTU-11/14 lists submissions and replays them (admins, course scoped)', async () => {
		const id = await addSub(env.db, { username: ['cstu_bob'], result: 'success', grade: 100 });
		const gone = await addSub(env.db, { username: ['cstu_eve'], taskid: 'gone_task' });
		const foreign = await addSub(env.db, { courseid: 'cstu_other', username: ['cstu_bob'] });
		const data = await outcome(() => submissions.load(ev('cstu_tutor', C, { url: '?users=cstu_bob' })));
		expect([data.count, data.rows[0].id, data.options.users.length, data.layouts.length]).toEqual([
			1,
			String(id),
			5,
			4
		]);
		const replay = (u: string, form: [string, string][]) =>
			outcome(() => submissions.actions.replay(ev(u, C, { form })));
		expect(await replay('cstu_tutor', [['submissionid', String(id)]])).toMatchObject({ status: 403 });
		expect(await replay('cstu_admin', [['submissionid', String(foreign)]])).toMatchObject({ status: 404 });
		expect(await replay('cstu_admin', [])).toMatchObject({ status: 404 });
		expect(await replay('cstu_admin', [['submissionid', String(id)]])).toEqual({
			message: '1 selected submissions were set for replay.'
		});
		expect(await env.db.c.submissions.findOne({ _id: id })).toMatchObject({ status: 'waiting' });
		expect(await env.db.c.submissions.findOne({ _id: id })).not.toHaveProperty('result');
		await env.db.c.userTasks.insertOne({ courseid: 'cstu', username: 'cstu_eve', taskid: 'answer' } as never);
		// Submissions being graded are never queued twice (selection or checked rows).
		expect(await replay('cstu_admin', [['query', 'users=cstu_eve,cstu_bob']])).toMatchObject({ status: 404 });
		expect(await replay('cstu_admin', [['selected', String(id)]])).toMatchObject({ status: 404 });
		await env.db.c.submissions.updateOne({ _id: id }, { $set: { status: 'done' } });
		expect(await replay('cstu_admin', [['query', 'users=cstu_eve,cstu_bob']])).toEqual({
			message: '1 selected submissions were set for replay.'
		});
		// A submission of a task removed from the course cannot be replayed.
		expect(await replay('cstu_admin', [['selected', String(gone)]])).toEqual({
			message: '0 selected submissions were set for replay.'
		});
		expect(env.newJob).toHaveBeenCalledTimes(2);
		expect(await outcome(() => submissions.load(ev('cstu_bob', C)))).toMatchObject({ status: 403 });
	});
	it('CSTU-12/13 exports CSV and archives', async () => {
		const id = await addSub(env.db, { username: ['cstu_bob'] });
		const waiting = await addSub(env.db, { username: ['cstu_bob'], status: 'waiting' });
		const foreign = await addSub(env.db, { courseid: 'cstu_other', username: ['cstu_bob'] });
		const get = (file: string, url = '') =>
			outcome(() => submissionFiles(ev('cstu_tutor', { courseid: 'cstu', file }, { url })));
		expect((await text(await get('submissions.csv'))).split('\r\n')).toHaveLength(4);
		const all = await text(await get('submissions.tgz', '?download_type=username/taskid&simplify=on'));
		expect(all).toContain('cstu_bob/answer/2026-10-10T10:00:00+00:00-1/submission.test');
		await env.db.c.userTasks.insertOne({
			courseid: 'cstu',
			username: 'cstu_bob',
			taskid: 'answer',
			submissionid: id
		} as never);
		expect(await text(await get('submissions.tgz', '?download_type=username/taskid&eval_dl=on&simplify=on'))).toContain(
			'cstu_bob/answer/submission.test'
		);
		expect(await text(await get('submissions.tgz'))).toContain(
			'answer/cstu_bob/2026-10-10T10:00:00+00:00/submission.test'
		);
		expect(await text(await get('submissions.tgz', '?download_type=bad'))).toContain(
			'answer/cstu_bob/2026-10-10T10:00:00+00:00/submission.test'
		);
		expect(await text(await get('submissions.tgz', `?submission=${id}`))).toMatch(/^submission\.test/);
		expect(await text(await get('submissions.tgz', `?selected=${id}&selected=${waiting}`))).toMatch(
			/^submission\.test/
		);
		for (const bad of [waiting, foreign, 'zz'])
			expect(await get('submissions.tgz', `?submission=${bad}`)).toMatchObject({ status: 404 });
		expect(await get('other.txt')).toMatchObject({ status: 404 });
	});
	it('CSTU-12/13/14 refuses exports and replays larger than the export limit', async () => {
		const [a, b] = [await addSub(env.db, { username: ['cstu_bob'] }), await addSub(env.db, { username: ['cstu_eve'] })];
		const raw = services().config.raw;
		raw.submissions_export_limit = 1;
		try {
			const get = (file: string, url = '') =>
				outcome(() => submissionFiles(ev('cstu_tutor', { courseid: 'cstu', file }, { url })));
			const tooMany = {
				status: 400,
				message: 'The selection contains 2 submissions, more than the 1 allowed: narrow it with the filters.'
			};
			// The CSV export allows CSV_FACTOR (20) times more submissions.
			expect((await text(await get('submissions.csv'))).split('\r\n')).toHaveLength(4);
			expect(await get('submissions.tgz')).toEqual(tooMany);
			expect(await get('submissions.tgz', `?selected=${a}&selected=${b}`)).toEqual(tooMany);
			// Narrowed selections are exported.
			expect((await text(await get('submissions.csv', '?users=cstu_bob'))).split('\r\n')).toHaveLength(3);
			expect(await text(await get('submissions.tgz', `?selected=${a}`))).toMatch(/^submission\.test/);
			const replay = (form: [string, string][]) =>
				outcome(() => submissions.actions.replay(ev('cstu_admin', C, { form })));
			const refused = { status: 400, data: { message: tooMany.message } };
			expect(await replay([['query', '']])).toMatchObject(refused);
			expect(
				await replay([
					['selected', String(a)],
					['selected', String(b)]
				])
			).toMatchObject(refused);
			expect(await replay([['query', 'users=cstu_eve']])).toEqual({
				message: '1 selected submissions were set for replay.'
			});
			for (let i = 0; i < 19; i++) await addSub(env.db, { username: ['cstu_bob'] });
			expect(await get('submissions.csv')).toEqual({
				status: 400,
				message: 'The selection contains 21 submissions, more than the 20 allowed: narrow it with the filters.'
			});
		} finally {
			delete raw.submissions_export_limit;
		}
	});
	it('CSTU-15/14 shows one submission to the staff of its course and replays it', async () => {
		const id = await addSub(env.db, {
			username: ['cstu_bob'],
			tests: { good: true, misc: false },
			input: { answer: '42', extra: 'x', upload: { filename: 'a.txt', value: Buffer.from('y') }, '@lang': 'en' }
		});
		const gone = await addSub(env.db, { username: ['cstu_bob'], taskid: 'gone_task' });
		const waiting = await addSub(env.db, {
			username: ['cstu_bob'],
			status: 'waiting',
			taskid: 'grp_mcq',
			input: { q1: ['1'] }
		});
		const p = (s: ObjectId | string) => ({ submissionid: String(s) });
		const data = await outcome(() => submission.load(ev('cstu_admin', p(id))));
		expect(data.inputs).toEqual([
			{ id: 'answer', name: 'The answer', defined: true, value: '42' },
			{ id: 'upload', name: 'Upload', defined: true, value: 'File: a.txt' },
			{ id: 'extra', name: 'extra', defined: false, value: 'x' }
		]);
		expect([data.tags, data.feedback.text.trim(), typeof data.debug]).toEqual([
			[{ label: 'Good answer', tone: 'success', title: 'The answer was right' }],
			'<p>Global <strong>text</strong></p>',
			'string'
		]);
		// Unknown user, unnamed problem without answer, no grade.
		mkdirSync(join(env.dir, 'cstu', 'noname'));
		writeFileSync(
			join(env.dir, 'cstu', 'noname', 'task.yaml'),
			'name: N\nenvironment_type: mcq\nproblems:\n  q:\n    type: match\n    answer: x\n'
		);
		const anon = await addSub(env.db, { username: ['ghost'], taskid: 'noname', input: {} });
		await env.db.c.submissions.updateOne({ _id: anon }, { $unset: { grade: 1 } });
		const a = await outcome(() => submission.load(ev('cstu_admin', p(anon))));
		expect([a.submission.users, a.submission.grade, a.inputs]).toEqual([
			[{ username: 'ghost', realname: 'ghost' }],
			0,
			[{ id: 'q', name: 'q', defined: true, value: '' }]
		]);
		const w = await outcome(() => submission.load(ev('cstu_tutor', p(waiting))));
		expect([w.feedback, w.debug, w.submission.result, w.inputs[0].value]).toEqual([null, null, 'waiting', '["1"]']);
		for (const [u, s, status] of [
			['other_tutor', id, 403],
			['cstu_bob', id, 403],
			['cstu_admin', new ObjectId(), 404],
			['cstu_admin', 'bad', 404],
			['cstu_admin', gone, 404]
		] as const)
			expect(await outcome(() => submission.load(ev(u, p(s))))).toMatchObject({ status });
		expect(await outcome(() => submission.actions.replay(ev('cstu_tutor', p(id), { form: [] })))).toMatchObject({
			status: 403
		});
		expect(await outcome(() => submission.actions.debug(ev('cstu_tutor', p(id), { form: [] })))).toMatchObject({
			status: 403
		});
		expect(await outcome(() => submission.actions.replay(ev('cstu_admin', p(id), { form: [] })))).toEqual({
			message: 'Submission set for replay.'
		});
		expect(await outcome(() => submission.actions.copy(ev('cstu_tutor', p(id), { form: [] })))).toEqual({
			status: 303,
			location: '/course/cstu/answer'
		});
		expect(await outcome(() => submission.actions.debug(ev('cstu_admin', p(id), { form: [] })))).toEqual({
			status: 303,
			location: '/course/cstu/answer'
		});
		expect(await env.db.c.submissions.countDocuments({ username: 'cstu_tutor' })).toBe(1);
		expect(await env.db.c.userTasks.findOne({ username: 'cstu_tutor', taskid: 'answer' })).not.toBeNull();
	});
});

describe('statistics', () => {
	it('CSTU-16/17 loads the statistics and the progress CSV', async () => {
		await addSub(env.db, { username: ['cstu_bob'], date: new Date().toISOString() });
		const data = await outcome(() => stats.load(ev('cstu_tutor', C)));
		expect([data.tab, data.progress, data.stats.global.total, data.stats.options.tasks.length]).toEqual([
			'submissions',
			null,
			1,
			5
		]);
		const progress = await outcome(() => stats.load(ev('cstu_tutor', C, { url: '?tab=progress&page=3' })));
		// The progress is streamed: the load returns its promise.
		progress.progress = await progress.progress;
		expect([progress.tab, progress.stats, progress.progress.rows.length, progress.progress.page]).toEqual([
			'progress',
			null,
			5,
			1
		]);
		expect(
			(
				await text(await outcome(() => studentFiles(ev('cstu_tutor', { courseid: 'cstu', file: 'progress.csv' }))))
			).split('\r\n')[0]
		).toBe('id,attempted,attempts,name,succeeded,viewed');
		expect(await outcome(() => stats.load(ev('cstu_bob', C)))).toMatchObject({ status: 403 });
	});
});
