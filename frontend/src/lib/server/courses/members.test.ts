import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Double, ObjectId } from 'mongodb';
import { setupCourses, type CoursesEnv } from '../../../../tests/fixtures/courses/setup.js';
import { courseTaskIds, getCourse } from './course.js';
import { parseDispenser, userTaskList } from './dispenser.js';
import * as m from './members.js';

let env: CoursesEnv;
beforeAll(async () => {
	env = await setupCourses({ withDb: true });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
	for (const c of ['courses', 'audiences', 'groups', 'users', 'user_tasks'])
		await env.db.db.collection(c).deleteMany({});
});

const course = () => getCourse('fx');

describe('roles and registration', () => {
	it('computes rights', async () => {
		expect([m.isSuperadmin('root'), m.isSuperadmin('admin1'), m.isSuperadmin(null)]).toEqual([true, false, false]);
		expect([
			m.isCourseAdmin(course(), 'admin1'),
			m.isCourseAdmin(course(), 'root'),
			m.isCourseAdmin(course(), 'tutor1')
		]).toEqual([true, true, false]);
		expect([
			m.isCourseStaff(course(), 'tutor1'),
			m.isCourseStaff(course(), 'bob'),
			m.isCourseStaff(course(), undefined)
		]).toEqual([true, false, false]);
		expect(await m.isRegistered(course(), 'tutor1')).toBe(true);
		expect(await m.isRegistered(course(), null)).toBe(false);
	});
	it('registers and unregisters students like legacy', async () => {
		await m.addStudent('fx', 'bob');
		await m.addStudent('fx', 'carl');
		expect(await env.db.c.courses.findOne({ _id: 'fx' })).toEqual({
			_id: 'fx',
			students: ['bob', 'carl']
		});
		expect(await m.isRegistered(course(), 'bob')).toBe(true);
		expect((await m.registeredUsers(course())).sort()).toEqual(['admin1', 'bob', 'carl', 'tutor1']);
		expect(await m.registeredUsers(course(), false)).toEqual(['bob', 'carl']);
		const aud = await env.db.c.audiences.insertOne({
			description: 'TP1',
			courseid: 'fx',
			students: ['bob'],
			tutors: []
		});
		await env.db.c.groups.insertOne({
			description: 'G',
			courseid: 'fx',
			size: 2,
			students: ['bob'],
			audiences: []
		});
		await m.unregisterUser('fx', 'bob');
		expect(await env.db.c.courses.findOne({ _id: 'fx' })).toEqual({
			_id: 'fx',
			students: ['carl']
		});
		expect((await env.db.c.audiences.findOne({ _id: aud.insertedId }))?.students).toEqual([]);
		expect(await m.userGroup('fx', 'bob')).toBeNull();
		expect(await m.registeredUsers(getCourse('fxcontest'))).toEqual([]);
	});
});

describe('audiences and groups (NAV-16)', () => {
	let tp1: ObjectId;
	let full: ObjectId;
	let restricted: ObjectId;
	let open: ObjectId;
	beforeEach(async () => {
		tp1 = (
			await env.db.c.audiences.insertOne({
				description: 'TP10',
				courseid: 'fx',
				students: ['alice'],
				tutors: []
			})
		).insertedId;
		await env.db.c.audiences.insertOne({
			description: 'TP2',
			courseid: 'fx',
			students: ['alice', 'bob'],
			tutors: []
		});
		open = (
			await env.db.c.groups.insertOne({
				description: 'Group 10',
				courseid: 'fx',
				size: 2,
				students: [],
				audiences: []
			})
		).insertedId;
		restricted = (
			await env.db.c.groups.insertOne({
				description: 'Group 2',
				courseid: 'fx',
				size: 1,
				students: [],
				audiences: [tp1]
			})
		).insertedId;
		full = (
			await env.db.c.groups.insertOne({
				description: 'Group 1',
				courseid: 'fx',
				size: 1,
				students: ['dave'],
				audiences: []
			})
		).insertedId;
	});
	it('lists natsorted audiences and groups', async () => {
		expect((await m.courseAudiences('fx')).map((a) => a.description)).toEqual(['TP2', 'TP10']);
		expect(
			Object.fromEntries(
				Object.entries(await m.audiencesPerStudent('fx')).map(([k, v]) => [k, v.map((a) => a.description)])
			)
		).toEqual({
			alice: ['TP2', 'TP10'],
			bob: ['TP2']
		});
		expect((await m.courseGroups('fx')).map((g) => g.description)).toEqual(['Group 1', 'Group 2', 'Group 10']);
		expect((await m.allowedGroups('fx', 'bob')).map((g) => g.description)).toEqual(['Group 1', 'Group 10']);
		expect((await m.allowedGroups('fx', 'alice')).map((g) => g.description)).toEqual([
			'Group 1',
			'Group 2',
			'Group 10'
		]);
	});
	it('joins and leaves groups with the course, audience and seat checks', async () => {
		expect(await m.joinGroup('fx', 'bob', String(restricted))).toBe(false);
		expect(await m.joinGroup('fx', 'bob', String(open))).toBe(true);
		expect(await m.joinGroup('fx', 'bob', String(full))).toBe(false);
		expect((await m.userGroup('fx', 'bob'))?._id).toEqual(open);
		expect(await m.joinGroup('fx', 'bob', String(open))).toBe(false);
		expect(await m.joinGroup('other', 'bob', String(open))).toBe(false);
		expect(await m.joinGroup('fx', 'bob', 'nope')).toBe(false);
		expect(await m.joinGroup('fx', 'bob', 'abcdefghijkl')).toBe(false);
		expect(await m.joinGroup('fx', 'alice', String(restricted))).toBe(true);
		expect(await m.joinGroup('fx', 'alice', String(open))).toBe(true);
		expect((await env.db.c.groups.findOne({ _id: restricted }))?.students).toEqual([]);
		expect(await m.leaveGroup('fx', 'alice')).toBe(true);
		expect(await m.leaveGroup('fx', 'alice')).toBe(false);
		await env.db.c.groups.updateOne({ _id: open }, { $unset: { students: '', audiences: '' } });
		expect(await m.joinGroup('fx', 'carl', String(open))).toBe(true);
	});
});

describe('pinned courses (NAV-03)', () => {
	it('pins courses (stored once), up to 6', async () => {
		await env.db.c.users.insertOne({
			username: 'bob',
			realname: 'B',
			email: 'b@x',
			language: 'en',
			bindings: {},
			pinned_courses: ['ghost', 'a', 'b', 'c', 'd', 'e']
		});
		expect(await m.pinnedCourses('bob')).toEqual([]);
		expect(await m.pinCourse('bob', 'fx')).toBe(true);
		expect(await m.pinCourse('bob', 'fx')).toBe(true);
		expect(await m.pinnedCourses('bob')).toEqual(['fx']);
		await env.db.c.users.updateOne(
			{ username: 'bob' },
			{ $set: { pinned_courses: ['fx', 'fx', 'fx', 'fx', 'fx', 'fx'] } }
		);
		expect(await m.pinCourse('bob', 'fxcontest')).toBe(false);
		await m.unpinCourse('bob', 'fx');
		expect(await m.pinnedCourses('bob')).toEqual([]);
		expect(await m.pinnedCourses('nobody')).toEqual([]);
	});
});

describe('user tasks', () => {
	it('records task views with the legacy document', async () => {
		await m.userSawTask('bob', 'fx', 'code1');
		await m.userSawTask('bob', 'fx', 'code1');
		const doc = await env.db.c.userTasks.findOne({ username: 'bob' }, { projection: { _id: 0 } });
		expect(doc).toEqual({
			username: 'bob',
			courseid: 'fx',
			taskid: 'code1',
			tried: 0,
			succeeded: false,
			grade: 0,
			submissionid: null,
			state: ''
		});
		const raw = await env.db.db.collection('user_tasks').findOne({}, { promoteValues: false });
		expect(raw?.grade).toBeInstanceOf(Double);
	});
	it('computes course caches (NAV-11)', async () => {
		const ut = (username: string, taskid: string, grade: number, tried: number, succeeded: boolean) => ({
			username,
			courseid: 'fx',
			taskid,
			grade,
			tried,
			succeeded,
			submissionid: null,
			random: [],
			state: '',
			tokens: { amount: 0, date: new Date() }
		});
		await env.db.c.userTasks.insertMany([
			ut('bob', 'code1', 100, 2, true),
			ut('bob', 'mcq1', 50, 1, false),
			ut('bob', 'future', 100, 1, true),
			ut('bob', 'ghost', 100, 1, true)
		]);
		await m.addStudent('fx', 'bob');
		const caches = await m.courseCaches(course(), ['bob']);
		// weights: code1 1, mcq1 3, upload 2 (future not started) -> (100 + 150) / 6
		expect(caches).toEqual({
			bob: {
				taskTried: 3,
				totalTries: 4,
				taskSucceeded: 1,
				taskGrades: { code1: 100, mcq1: 50 },
				grade: 42
			}
		});
		expect((await m.courseCaches(course(), ['carl'])).carl).toEqual({
			taskTried: 0,
			totalTries: 0,
			taskSucceeded: 0,
			taskGrades: {},
			grade: 0
		});
	});
	it('computes course caches per user with a combinatory test dispenser (random draw)', async () => {
		const users = Array.from({ length: 12 }, (_, i) => `user${i}`);
		const draw = Object.assign(Object.create(Object.getPrototypeOf(course())), course(), {
			dispenser: parseDispenser('combinatory_test', {
				toc: [{ title: 'S', config: { amount: 1 }, tasks_list: ['code1', 'upload'] }],
				config: { code1: { accessibility: true }, upload: { accessibility: true } }
			})
		});
		await env.db.c.userTasks.insertMany(
			users.flatMap((username) =>
				['code1', 'upload'].map((taskid) => ({
					username,
					courseid: 'fx',
					taskid,
					grade: taskid === 'code1' ? 100 : 0,
					tried: 1,
					succeeded: taskid === 'code1',
					submissionid: null,
					state: ''
				}))
			) as never
		);
		const caches = await m.courseCaches(draw, users);
		const drawn = users.map((u) => userTaskList(draw.dispenser, courseTaskIds(draw), u));
		expect(users.map((u) => Object.keys(caches[u].taskGrades))).toEqual(drawn);
		expect(users.map((u) => caches[u].grade)).toEqual(drawn.map((d) => (d[0] === 'code1' ? 100 : 0)));
		expect(new Set(drawn.map(String)).size).toBe(2);
	});
	it('checks and refills submission tokens (TASK-14)', async () => {
		const limit = { amount: 2, period: -1 };
		expect(await m.checkTokens('fx', 'code1', ['bob'], { amount: -1, period: -1 })).toBe(true);
		expect(await m.checkTokens('fx', 'code1', ['bob'], limit)).toBe(true);
		await env.db.c.userTasks.insertOne({
			username: 'bob',
			courseid: 'fx',
			taskid: 'code1',
			grade: 0,
			tried: 2,
			succeeded: false,
			submissionid: null,
			random: [],
			state: '',
			tokens: { amount: 2 } as never
		});
		expect(await m.checkTokens('fx', 'code1', ['bob'], limit)).toBe(false);
		expect(await m.checkTokens('fx', 'code1', ['bob'], { amount: 3, period: -1 })).toBe(true);
		// period: tokens without date are older than the period -> refilled
		expect(await m.checkTokens('fx', 'code1', ['bob'], { amount: 2, period: 1 })).toBe(true);
		const doc = await env.db.c.userTasks.findOne({ username: 'bob' });
		expect(doc?.tokens.amount).toBe(0);
		expect(Date.now() - (doc?.tokens.date.getTime() ?? 0)).toBeLessThan(5000);
		await env.db.c.userTasks.updateOne({ username: 'bob' }, { $set: { 'tokens.amount': 1 } });
		expect(await m.checkTokens('fx', 'code1', ['bob'], { amount: 1, period: 1 })).toBe(false);
	});
});
