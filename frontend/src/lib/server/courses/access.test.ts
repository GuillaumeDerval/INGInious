import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { setupCourses, type CoursesEnv } from '../../../../tests/fixtures/courses/setup.js';
import type { CurrentUser } from '../../../app.d.ts';
import { createCourse, getCourse, type Course } from './course.js';
import * as a from './access.js';

let env: CoursesEnv;
const fx = () => getCourse('fx');
const base = { name: 'C', admins: ['admin1'], tutors: ['tutor1'] };

beforeAll(async () => {
	env = await setupCourses({ withDb: true });
	createCourse('closed', { ...base, accessible: false });
	createCourse('preview', { ...base, allow_preview: true, registration: false });
	createCourse('lti', { ...base, is_lti: true, lti_send_back_grade: true });
	createCourse('ltinograde', { ...base, is_lti: true });
	createCourse('acl', { ...base, registration_ac: 'binding', registration_ac_list: ['git*'] });
	createCourse('deny', {
		...base,
		registration_ac: 'username',
		registration_ac_accept: false,
		registration_ac_list: ['bob']
	});
	createCourse('mailacl', {
		...base,
		registration_ac: 'email',
		registration_ac_list: ['*@ok.org']
	});
});
afterAll(() => env.cleanup());
beforeEach(async () => {
	for (const c of ['courses', 'groups', 'users', 'user_tasks']) await env.db.db.collection(c).deleteMany({});
	const user = (username: string, email: string, bindings = {}) => ({
		username,
		realname: username,
		email,
		language: 'en',
		bindings
	});
	await env.db.c.users.insertMany([
		user('bob', 'bob@ok.org'),
		user('carl', 'carl@x.org', { github: ['1', {}] }),
		user('admin1', 'a@x')
	]);
});

/** Builds a guard event. */
const ev = (username: string | null, isLti = false) => ({
	url: new URL('http://localhost/course/x'),
	locals: {
		user: username
			? ({
					username,
					realname: username,
					email: '',
					language: 'en',
					timezone: 'UTC',
					codeIndentation: '4',
					superadmin: username === 'root'
				} as CurrentUser)
			: null,
		session: { doc: { is_lti: isLti, tos_signed: true } },
		lang: 'en'
	} as unknown as App.Locals
});

/** Runs a guard and returns the thrown status (or the redirect location). */
async function status(fn: () => unknown): Promise<number | string> {
	try {
		await fn();
		return 200;
	} catch (e) {
		if (isRedirect(e)) return e.location;
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

describe('courseIsOpenToUser (NAV-05)', () => {
	const open = (c: Course, u: string | null, lti: boolean | null = false) => a.courseIsOpenToUser(c, u, lti);
	it('returns the legacy reasons', async () => {
		expect(await open(getCourse('closed'), 'tutor1')).toBe(true);
		expect(await open(getCourse('closed'), 'bob')).toBe('closed');
		expect(await open(fx(), 'bob')).toBe('unregistered_not_previewable');
		expect(await open(getCourse('preview'), null)).toBe(true);
		await env.db.c.courses.insertOne({ _id: 'fx', students: ['bob'] });
		expect(await open(fx(), 'bob')).toBe(true);
		expect(await open(fx(), 'bob', true)).toBe('lti_only');
		expect(await open(fx(), 'bob', null)).toBe(true);
		await env.db.c.courses.insertMany([
			{ _id: 'lti', students: ['bob'] },
			{ _id: 'ltinograde', students: ['bob'] }
		]);
		expect(await open(getCourse('lti'), 'bob')).toBe('lti_not_registered');
		expect(await open(getCourse('lti'), 'bob', true)).toBe(true);
		expect(await open(getCourse('ltinograde'), 'bob')).toBe(true);
	});
});

describe('registration (NAV-06/07)', () => {
	it('applies the access control lists', () => {
		const bob = { username: 'bob', email: 'bob@ok.org', bindings: {} };
		const carl = { username: 'carl', email: 'carl@x.org', bindings: { github: [] } };
		expect([
			a.isAcceptedByAcl(getCourse('acl'), bob),
			a.isAcceptedByAcl(getCourse('acl'), carl),
			a.isAcceptedByAcl(getCourse('acl'), null)
		]).toEqual([false, true, false]);
		expect([a.isAcceptedByAcl(getCourse('deny'), bob), a.isAcceptedByAcl(getCourse('deny'), carl)]).toEqual([
			false,
			true
		]);
		expect([a.isAcceptedByAcl(getCourse('mailacl'), bob), a.isAcceptedByAcl(getCourse('mailacl'), carl)]).toEqual([
			true,
			false
		]);
		expect(a.isAcceptedByAcl(getCourse('mailacl'), { ...bob, email: undefined as never })).toBe(false);
		expect(a.isAcceptedByAcl(fx(), null)).toBe(true);
		expect(a.isRegistrationPossible(fx(), bob)).toBe(true);
		expect(a.isRegistrationPossible(getCourse('preview'), bob)).toBe(false);
		expect(a.isRegistrationPossible(getCourse('closed'), bob)).toBe(false);
	});
	it('registers with the password', async () => {
		expect(a.safeEqual('pwd', 'pwd')).toBe(true);
		expect(a.safeEqual('pwd', 'pwd2')).toBe(false);
		expect(await a.registerUser(fx(), 'bob', 'wrong')).toBe(false);
		expect(await a.registerUser(fx(), 'bob', null)).toBe(false);
		expect(await a.registerUser(fx(), 'ghost', 'pwd')).toBe(false);
		expect(await a.registerUser(fx(), '', 'pwd')).toBe(false);
		expect(await a.registerUser(fx(), 'bob', 'pwd')).toBe(true);
		expect(await a.registerUser(fx(), 'bob', 'pwd')).toBe(false);
		expect(await a.registerUser(fx(), 'admin1', 'pwd')).toBe(false);
		expect(await a.registerUser(getCourse('deny'), 'bob', null)).toBe(false);
		expect(await a.registerUser(getCourse('deny'), 'bob', null, true)).toBe(true);
		expect(await env.db.c.courses.find().toArray()).toEqual([
			{ _id: 'fx', students: ['bob'] },
			{ _id: 'deny', students: ['bob'] }
		]);
	});
});

describe('tasks (TASK-14/16/18, NAV-14)', () => {
	it('checks visibility', async () => {
		await env.db.c.courses.insertOne({ _id: 'fx', students: ['bob'] });
		expect(await a.taskIsVisibleByUser(fx(), 'code1', 'bob', false)).toBe(true);
		expect(await a.taskIsVisibleByUser(fx(), 'future', 'bob', false)).toBe(false);
		expect(await a.taskIsVisibleByUser(fx(), 'future', 'tutor1', false)).toBe(true);
		expect(await a.taskIsVisibleByUser(fx(), 'code1', 'carl', false)).toBe(false);
	});
	it('checks submission rights', async () => {
		const can = (taskid: string, u: string) => a.taskCanUserSubmit(fx(), taskid, u);
		expect(await can('future', 'admin1')).toBe(true);
		expect(await can('code1', 'carl')).toBe(false);
		await env.db.c.courses.insertOne({ _id: 'fx', students: ['bob', 'carl'] });
		expect(await can('code1', 'bob')).toBe(true);
		expect(await a.taskCanUserSubmit(fx(), 'code1', 'bob', { lti: true })).toBe(false);
		// mcq1 is past its deadline
		expect(await can('mcq1', 'bob')).toBe(false);
		// group task without group, then with a group whose member has no tokens left
		await env.db.c.courses.updateOne({ _id: 'fx' }, { $set: { students: ['bob', 'carl'] } });
		const course = fx();
		const groupTask = {
			...course,
			dispenser: {
				...course.dispenser,
				config: {
					...course.dispenser.config,
					mcq1: {
						...course.dispenser.config.mcq1,
						accessibility: course.dispenser.config.code1.accessibility
					}
				}
			}
		};
		const canGroup = () => a.taskCanUserSubmit(groupTask, 'mcq1', 'bob');
		expect(await canGroup()).toBe(false);
		await env.db.c.groups.insertOne({
			description: 'G',
			courseid: 'fx',
			size: 2,
			students: ['bob', 'carl'],
			audiences: []
		});
		expect(await canGroup()).toBe(true);
		await env.db.c.userTasks.insertOne({
			username: 'carl',
			courseid: 'fx',
			taskid: 'mcq1',
			grade: 0,
			tried: 2,
			succeeded: false,
			submissionid: null,
			random: [],
			state: '',
			tokens: { amount: 2, date: new Date() }
		});
		expect(await canGroup()).toBe(false);
	});
});

describe('guards', () => {
	it('requireCourse answers 404', async () => {
		expect(a.requireCourse('fx').id).toBe('fx');
		for (const id of ['nope', '../x', 'a b', 'fxbroken']) expect(await status(() => a.requireCourse(id))).toBe(404);
	});
	it('requireTask answers 404 for missing, invalid and broken tasks', async () => {
		const course = a.requireCourse('fx');
		expect(a.requireTask(course, 'code1').id).toBe('code1');
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		for (const id of ['nope', '../x', 'broken']) expect(await status(() => a.requireTask(course, id))).toBe(404);
		expect(log).toHaveBeenCalledOnce();
		log.mockRestore();
	});
	it('requireCourseAccess', async () => {
		expect(await status(() => a.requireCourseAccess(ev(null), 'fx'))).toBe('/signin?redirect=%2Fcourse%2Fx');
		expect(await status(() => a.requireCourseAccess(ev('bob'), 'fx'))).toBe('/register/fx');
		expect(await status(() => a.requireCourseAccess(ev('carl'), 'deny'))).toBe('/register/deny');
		expect(await status(() => a.requireCourseAccess(ev('bob'), 'deny'))).toBe(403);
		expect(await status(() => a.requireCourseAccess(ev('bob'), 'closed'))).toBe(403);
		expect(await status(() => a.requireCourseAccess(ev('bob', true), 'ltinograde'))).toBe(403);
		expect(await status(() => a.requireCourseAccess(ev('bob'), 'nope'))).toBe(404);
		expect(await a.requireCourseAccess(ev(null), 'preview')).toMatchObject({
			user: null,
			registered: false,
			staff: false,
			admin: false
		});
		expect(await a.requireCourseAccess(ev('tutor1'), 'closed')).toMatchObject({
			registered: true,
			staff: true,
			admin: false
		});
		await env.db.c.courses.insertOne({ _id: 'fx', students: ['bob'] });
		expect(await a.requireCourseAccess(ev('bob'), 'fx')).toMatchObject({
			registered: true,
			staff: false
		});
		expect(a.closedMessage('lti_only')).toContain('external platform');
		expect(a.closedMessage('closed')).toBe('This course is closed.');
	});
	it('requireCourseStaff and requireCourseAdmin', async () => {
		expect(await status(() => a.requireCourseStaff(ev(null), 'fx'))).toMatch(/^\/signin/);
		expect(await status(() => a.requireCourseStaff(ev('bob'), 'fx'))).toBe(403);
		expect(await status(() => a.requireCourseStaff(ev('tutor1'), 'nope'))).toBe(404);
		expect(await a.requireCourseStaff(ev('tutor1'), 'fx')).toMatchObject({
			staff: true,
			admin: false
		});
		expect(await status(() => a.requireCourseAdmin(ev('tutor1'), 'fx'))).toBe(403);
		expect(await a.requireCourseAdmin(ev('admin1'), 'fx')).toMatchObject({ admin: true });
		expect(await a.requireCourseAdmin(ev('root'), 'closed')).toMatchObject({ admin: true });
	});
});
