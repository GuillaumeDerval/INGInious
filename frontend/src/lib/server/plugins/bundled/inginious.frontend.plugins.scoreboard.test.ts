import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { siteEnv, event, user, MCQ_TASK, type SiteEnv } from '../../../../../tests/site/env.js';
import { getCourse } from '../../courses/course.js';
import { getTask } from '../../courses/task.js';
import { PluginRegistry, resetPlugins } from '../index.js';
import * as sb from './inginious.frontend.plugins.scoreboard.js';

let env: SiteEnv;
let registry: PluginRegistry;
const boards = [
	{ name: 'One', content: 'a' },
	{ name: 'Both', content: ['a', 'b'] },
	{ name: 'Weighted', content: { a: 2, b: -1 }, reverse: true },
	{ name: 'Broken', content: ['zzz'] },
	{ content: 'a' },
	{ name: 'C only', content: 'c' }
];

beforeAll(async () => {
	env = await siteEnv();
	env.course(
		'sb',
		{ name: 'SB', admins: ['admin1'], scoreboard: boards },
		{ a: { ...MCQ_TASK, name: 'Task A' }, b: { ...MCQ_TASK, name: 'Task B' }, c: MCQ_TASK, d: MCQ_TASK }
	);
	env.course(
		'sbv',
		{
			name: 'SBV',
			admins: ['admin1'],
			scoreboard: boards,
			dispenser_data: { toc: [{ title: 'S', tasks_list: ['a', 'b'] }], config: { a: { accessibility: true } } }
		},
		{ a: { ...MCQ_TASK, name: 'Task A' }, b: { ...MCQ_TASK, name: 'Task B' } }
	);
	env.course('none', { name: 'None' });
	env.course('closed', { name: 'Closed', admins: ['admin1'], accessible: false, scoreboard: boards });
	registry = resetPlugins();
	await registry.load([{ plugin_module: sb.MODULE }], { [sb.MODULE]: async () => sb });
	await env.db.c.users.insertMany([
		{ username: 'alice', realname: 'Alice', email: 'a@x', language: 'en', bindings: {} },
		{ username: 'bob', realname: '', email: 'b@x', language: 'en', bindings: {} }
	]);
	await env.db.c.courses.insertMany([
		{ _id: 'sb', students: ['alice'] },
		{ _id: 'closed', students: ['alice'] }
	]);
	const sub = (username: string[], taskid: string, score: unknown, result = 'success') =>
		({
			courseid: 'sb',
			taskid,
			username,
			custom: { score },
			result,
			status: 'done',
			submitted_on: new Date(),
			input: null,
			grade: 0
		}) as never;
	await env.db.c.submissions.insertMany([
		sub(['alice'], 'a', 10),
		sub(['alice'], 'a', 5),
		sub(['alice'], 'b', '3'),
		sub(['bob', 'carl'], 'a', 20),
		sub(['bob', 'carl'], 'b', 1),
		sub(['dan'], 'a', 10),
		sub(['dan'], 'b', 3),
		sub(['eve'], 'a', 'nan'),
		sub(['eve'], 'a', ''),
		sub(['eve'], 'a', 99, 'failed')
	]);
});
afterAll(() => env.cleanup());

const status = async (fn: () => unknown) => {
	try {
		await fn();
		return 200;
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
};

describe('SITE-13 scoreboard plugin', () => {
	it('adds course and task menu links', async () => {
		const course = getCourse('sb');
		expect(await registry.callHook('course_menu', { course })).toEqual([
			{ label: 'Scoreboards', href: '/scoreboard/sb' }
		]);
		expect(await registry.callHook('course_menu', { course: getCourse('none') })).toEqual([]);
		expect(await registry.callHook('task_menu', { course, task: getTask(course, 'c') })).toEqual([
			{ label: 'Scoreboard: C only', href: '/scoreboard/sb/5' }
		]);
		expect(await registry.callHook('task_menu', { course, task: getTask(course, 'a') })).toEqual([
			{ label: 'Scoreboards', href: '/scoreboard/sb' }
		]);
		expect(await registry.callHook('task_menu', { course, task: getTask(course, 'd') })).toEqual([]);
	});
	it('restricts pages to registered users and staff of open courses, outside LTI', async () => {
		const member = (username: string, courseid = 'sb', module?: string) => {
			const e = event('/', { user: user(username), params: { courseid } });
			return { e, check: () => sb.requireCourseMember(e as never, module) };
		};
		expect(await member('alice').check()).toMatchObject({ username: 'alice', page: { id: 'sb', course: 'SB' } });
		expect(await status(member('admin1').check)).toBe(200);
		expect(await status(member('zed').check)).toBe(403);
		expect(await status(member('alice', 'nope').check)).toBe(404);
		expect(await status(member('alice', 'sb', 'other.plugin').check)).toBe(404);
		expect(await status(member('alice', 'closed').check)).toBe(403);
		expect(await status(member('admin1', 'closed').check)).toBe(200);
		const lti = member('alice');
		lti.e.locals.session.doc.is_lti = true;
		expect(await status(lti.check)).toBe(403);
		expect(sb.scoreboardNames(getCourse('sb'))).toEqual(['One', 'Both', 'Weighted', 'Broken', '', 'C only']);
		expect(await status(() => sb.scoreboardNames(getCourse('none')))).toBe(404);
	});
	it('ranks single-task boards (best score, ties share the rank)', async () => {
		const r = await sb.scoreboard(getCourse('sb'), '0', 'en', 'admin1');
		expect(r.header).toEqual(['', 'Student(s)', 'Score']);
		expect(r.rows.map((row) => row.map((c) => c.v))).toEqual([
			[1, 'bob,carl', 20],
			[2, 'Alice', 10],
			['', 'dan', 10]
		]);
		expect(r.emphasis).toEqual([2]);
	});
	it('ranks multi-task and weighted reverse boards', async () => {
		const both = await sb.scoreboard(getCourse('sb'), '1', 'en', 'admin1');
		expect(both.header).toEqual(['', 'Student(s)', 'Solved', 'Total score', 'Task A', 'Task B']);
		expect(both.rows.map((row) => row.map((c) => c.v))).toEqual([
			[1, 'bob,carl', 2, 21, 20, 1],
			[2, 'Alice', 2, 13, 10, 3],
			['', 'dan', 2, 13, 10, 3]
		]);
		const w = await sb.scoreboard(getCourse('sb'), '2', 'en', 'admin1');
		// reverse XOR negative coefficient: a keeps the min (5), b the max (3).
		expect(w.rows.map((row) => row.slice(1, 4).map((c) => c.v))).toEqual([
			['Alice', 2, 7],
			['dan', 2, 17],
			['bob,carl', 2, 39]
		]);
	});
	it('lists to students only the tasks that started for them', async () => {
		const sub = (taskid: string, score: number) =>
			({
				courseid: 'sbv',
				taskid,
				username: ['alice'],
				custom: { score },
				result: 'success',
				status: 'done',
				submitted_on: new Date(),
				input: null,
				grade: 0
			}) as never;
		await env.db.c.submissions.insertMany([sub('a', 4), sub('b', 7)]);
		const cells = (r: sb.Ranking) => r.rows.map((row) => row.map((c) => c.v));
		const student = await sb.scoreboard(getCourse('sbv'), '1', 'en', 'alice');
		expect(student.header).toEqual(['', 'Student(s)', 'Solved', 'Total score', 'Task A']);
		expect(cells(student)).toEqual([[1, 'Alice', 1, 4, 4]]);
		const staff = await sb.scoreboard(getCourse('sbv'), '1', 'en', 'admin1');
		expect(staff.header).toEqual(['', 'Student(s)', 'Solved', 'Total score', 'Task A', 'Task B']);
		expect(cells(staff)).toEqual([[1, 'Alice', 2, 11, 4, 7]]);
		expect(sb.listedTasks(getCourse('sb'), ['a', 'b'], 'alice')).toEqual([]);
	});
	it('answers 404 for invalid configurations', async () => {
		for (const index of ['3', '4', '9', 'x'])
			for (const viewer of ['admin1', 'alice'])
				expect(await status(() => sb.scoreboard(getCourse('sb'), index, 'en', viewer))).toBe(404);
	});
});
