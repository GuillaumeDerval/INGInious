/**
 * Unit tests of the navigation view models (NAV-01/02/03/09..13/21).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupNav, type NavEnv } from '../../../../tests/fixtures/nav/setup.js';
import { aclUser } from '../courses/access.js';
import { findCourse, getCourse, type Course } from '../courses/course.js';
import { plugins } from '../plugins/index.js';
import * as nav from './courses.js';

let env: NavEnv;
beforeAll(async () => {
	env = await setupNav();
});
afterAll(() => env.cleanup());
beforeEach(async () => {
	for (const c of ['courses', 'submissions', 'user_tasks', 'groups']) await env.db.db.collection(c).deleteMany({});
	await env.db.c.users.updateMany({}, { $unset: { pinned_courses: 1 } });
});

const course = (id: string) => getCourse(id);
const ids = (courses: { id: string }[]) => courses.map((c) => c.id);

describe('course lists', () => {
	it('NAV-01 lists open courses only, sorted by name', () => {
		expect(ids(nav.publicCourses('en'))).toEqual([
			'nav_bind',
			'nav_acl',
			'nav_deny',
			'nav_combi',
			'nav_lti',
			'nav_open',
			'nav_pwd',
			'nav_preview',
			'nav_previewreg',
			'nav_regclosed'
		]);
	});

	it('NAV-01 builds cards with badges for the viewer', async () => {
		const pwd = nav.courseCard(course('nav_pwd'), 'en', null);
		expect(pwd).toMatchObject({
			name: 'NAV Password course',
			autoRegistration: true,
			password: true,
			isLti: false,
			ltiUrl: null,
			registered: false,
			preview: false
		});
		expect(nav.courseCard(course('nav_preview'), 'en', null, true)).toMatchObject({ registered: true, preview: true });
		expect(pwd.description).toContain('Course NAV Password course');
		expect(nav.courseCard(course('nav_lti'), 'en', null)).toMatchObject({
			isLti: true,
			ltiUrl: 'https://lms.example.org/course/1',
			autoRegistration: false
		});
		expect(nav.courseCard(course('nav_acl'), 'en', null).autoRegistration).toBe(false);
		expect(nav.courseCard(course('nav_acl'), 'en', await aclUser('nav_carol')).autoRegistration).toBe(true);
		expect(await aclUser(null)).toBeNull();
		// javascript: URLs of LTI courses are never linked.
		const lti = { ...course('nav_lti'), ltiUrl: 'javascript:alert(1)' };
		expect(nav.courseCard(lti, 'en', null).ltiUrl).toBeNull();
	});

	it('NAV-02 lists the courses of students, tutors and superadmins', async () => {
		await env.db.c.courses.insertMany([
			{ _id: 'nav_open', students: ['nav_alice'] },
			{ _id: 'nav_closed', students: ['nav_alice'] },
			{ _id: 'nav_combi', students: ['nav_alice'] }
		]);
		expect(ids(await nav.userCourses('nav_alice', 'en'))).toEqual(['nav_combi', 'nav_open']);
		expect(ids(await nav.userCourses('nav_tutor', 'en'))).toEqual(['nav_open']);
		const all = ids(await nav.userCourses('superadmin', 'en'));
		expect(all).toContain('nav_closed');
		expect(all).toContain('nav_archive');
		expect(all).not.toContain('nav_broken');
	});

	it('NAV-02/03 gives roles, states and pins', async () => {
		await env.db.c.users.updateOne(
			{ username: 'superadmin' },
			{ $set: { pinned_courses: ['nav_open', 'unknown', 'nav_lti'] } }
		);
		const courses = await nav.userCourses('superadmin', 'en');
		const mine = (username: string, list: Course[], opts: Partial<Parameters<typeof nav.myCourses>[3]> = {}) =>
			nav.myCourses(username, list, 'en', { q: '', filter: '', page: 1, ...opts });
		const { courses: items, count, page, pages } = await mine('superadmin', courses);
		expect([count, page, pages]).toEqual([courses.length, 1, 1]);
		expect(items.slice(0, 2).map((i) => i.id)).toEqual(['nav_open', 'nav_lti']);
		const get = (id: string) => items.find((i) => i.id === id)!;
		expect(get('nav_archive')).toMatchObject({
			archived: true,
			hidden: true,
			archiveDate: '2026-01-01T00:00:00.000Z',
			role: 'admin'
		});
		expect(get('nav_closed')).toMatchObject({ hidden: true, archiveDate: null, pinned: false });
		expect(get('nav_open')).toMatchObject({ pinned: true, hidden: false, lti: false });
		// Server-side filters and search (name or id).
		expect(ids((await mine('superadmin', courses, { filter: 'pinned' })).courses)).toEqual(['nav_open', 'nav_lti']);
		expect(ids((await mine('superadmin', courses, { filter: 'lti' })).courses)).toEqual(['nav_lti']);
		expect(ids((await mine('superadmin', courses, { q: 'PASSWORD' })).courses)).toEqual(['nav_pwd']);
		expect(ids((await mine('superadmin', courses, { q: 'nav_pw' })).courses)).toEqual(['nav_pwd']);
		expect((await mine('superadmin', courses, { q: 'zzz' })).count).toBe(0);
		const tutor = await mine('nav_tutor', [course('nav_open')]);
		expect(tutor.courses[0].role).toBe('tutor');
		await env.db.db
			.collection('user_tasks')
			.insertOne({ username: 'nav_alice', courseid: 'nav_open', taskid: 't1', grade: 100, succeeded: true });
		const [alice] = (await mine('nav_alice', [course('nav_open')])).courses;
		// Visible: t1, t2, t3, tpast, tsoft, textra; next deadline: tsoft's soft deadline.
		expect(alice).toMatchObject({
			role: 'student',
			grade: 9,
			succeeded: 1,
			total: 6,
			deadline: new Date(2099, 9, 20, 12).toISOString()
		});
		expect((await mine('nav_alice', [course('nav_preview')])).courses[0].deadline).toBeNull();
	});

	it('NAV-01/02 paginates the course grids', async () => {
		const many = Array.from({ length: nav.COURSES_PER_PAGE + 1 }, (_, i) => ({
			...course('nav_open'),
			id: `c${String(i).padStart(2, '0')}`
		}));
		const second = await nav.myCourses('superadmin', many, 'en', { q: '', filter: '', page: 2 });
		expect([second.count, second.page, second.pages, ids(second.courses)]).toEqual([
			nav.COURSES_PER_PAGE + 1,
			2,
			2,
			[`c${nav.COURSES_PER_PAGE}`]
		]);
		expect(ids(nav.searchCourses(many, ' C01 ', 'en'))).toEqual(['c01']);
	});

	it('finds courses', () => {
		expect(findCourse('nav_open')?.id).toBe('nav_open');
		expect(findCourse('nav_broken')).toBeNull();
		expect(findCourse('../x')).toBeNull();
	});
});

describe('NAV-21 last tried exercises', () => {
	const submit = (courseid: string, taskid: string, minutes: number, status = 'done', result?: string) =>
		env.db.db.collection('submissions').insertOne({
			courseid,
			taskid,
			username: ['nav_alice'],
			status,
			result,
			submitted_on: new Date(Date.UTC(2026, 0, 1, 0, minutes))
		});

	it('keeps the latest submission of the 5 most recent visible tasks', async () => {
		await submit('nav_open', 't2', 1, 'done', 'failed');
		await submit('nav_open', 't3', 2, 'waiting');
		await submit('nav_open', 't2', 3, 'done', 'success');
		await submit('nav_open', 't1', 4, 'error');
		await submit('nav_open', 'tpast', 5, 'done', 'save');
		await submit('nav_open', 'tsoft', 6);
		await submit('nav_open', 'textra', 7);
		await submit('nav_open', 'missing', 8);
		await submit('nav_pwd', 't1', 9);
		await submit('nav_open', 'tfuture', 10);
		const items = await nav.lastTried('nav_alice', [course('nav_open')], 'en');
		expect(items.map((i) => i.taskid)).toEqual(['textra', 'tsoft', 'tpast', 't1', 't2']);
		expect(items[2]).toMatchObject({
			courseName: 'NAV Open course',
			taskName: 'T past',
			status: 'done',
			result: 'save'
		});
		expect(items[1].result).toBe('');
		expect(items[4].result).toBe('success');
		expect(await nav.lastTried('nav_eve', [course('nav_open')], 'en')).toEqual([]);
		expect(await nav.lastTried('nav_alice', [], 'en')).toEqual([]);
	});
});

describe('course page tasks', () => {
	it('NAV-10/11 builds the toc and the weighted grade', async () => {
		const grades = {
			t1: [100, true],
			t2: [50, false],
			textra: [100, false],
			tpast: [100, false],
			tfuture: [100, false]
		} as const;
		await env.db.db.collection('user_tasks').insertMany(
			Object.entries(grades).map(([taskid, [grade, succeeded]]) => ({
				username: 'nav_alice',
				courseid: 'nav_open',
				taskid,
				grade,
				succeeded
			}))
		);
		const { sections, grade, succeeded, total } = await nav.courseTasks(course('nav_open'), 'nav_alice', 'en');
		expect([grade, succeeded, total]).toEqual([77, 1, 6]);
		expect(sections.map((s) => s.title)).toEqual(['Part 1', 'Deadlines', 'Coming soon']);
		const [part1, deadlines, soon] = sections;
		// A section whose tasks are not visible yet is kept, with nothing to count.
		expect([soon.tasks, soon.stats]).toEqual([[], { '': [0, 0] }]);
		expect(part1.sections!.map((s) => [s.title, s.closed, s.tasks!.map((t) => t.id)])).toEqual([
			['Basics', false, ['t1', 't2']],
			['Advanced', true, ['t3']]
		]);
		expect(part1.sections![0].tasks![0]).toEqual({
			id: 't1',
			name: 'T1 easy',
			succeeded: true,
			grade: 100,
			weight: 1,
			open: true,
			categories: ['easy'],
			deadline: null
		});
		expect(deadlines.tasks!.map((t) => [t.id, t.open, t.grade])).toEqual([
			['tpast', false, 100],
			['tsoft', true, 0]
		]);
	});

	it('NAV-10 counts tasks per category and loads large courses section by section', async () => {
		await env.db.db
			.collection('user_tasks')
			.insertOne({ username: 'nav_alice', courseid: 'nav_open', taskid: 't1', grade: 100, succeeded: true });
		const c = course('nav_open');
		const { sections } = await nav.courseTasks(c, 'nav_alice', 'en', 2);
		const [part1, deadlines] = sections;
		expect(part1.stats).toMatchObject({ '': [1, 3], easy: [1, 2] });
		expect(part1.sections!.map((s) => [s.path, s.closed, s.tasks && s.tasks.map((t) => t.id)])).toEqual([
			['0.0', false, ['t1', 't2']],
			['0.1', true, null]
		]);
		// The budget is spent: the next sections come closed, without their tasks (paths: toc indices, the 2nd section is hidden).
		expect([deadlines.path, deadlines.closed, deadlines.tasks, deadlines.stats['']]).toEqual(['2', true, null, [0, 2]]);
		expect((await nav.sectionItems(c, 'nav_alice', 'en', '0.1'))!.map((t) => t.id)).toEqual(['t3']);
		expect((await nav.sectionItems(c, null, 'en', '2'))!.map((t) => t.id)).toEqual(['tpast', 'tsoft']);
		for (const path of ['0', '9', 'x', '0.1.0', ''])
			expect(await nav.sectionItems(c, 'nav_alice', 'en', path)).toBeNull();
	});

	it('NAV-15 works for anonymous visitors (grade 0)', async () => {
		const { grade, sections } = await nav.courseTasks(course('nav_preview'), null, 'en');
		expect(grade).toBe(0);
		expect(sections.flatMap((s) => s.tasks!.map((t) => t.name)).length).toBeGreaterThan(0);
	});

	it('NAV-13 shows the combinatory draw of the user', async () => {
		const draw = async (u: string) =>
			(await nav.courseTasks(course('nav_combi'), u, 'en')).sections.map((s) => s.tasks!.map((t) => t.id));
		expect(await draw('nav_alice')).toEqual([['c3', 'c4'], ['c6']]);
		expect(await draw('nav_bob')).toEqual([['c1', 'c3'], ['c6']]);
		expect(await draw('superadmin')).toEqual([['c1', 'c2'], ['c5']]);
	});

	it('lists broken tasks with their id', async () => {
		const c = course('nav_open');
		const broken = {
			...c,
			id: 'nav_open',
			dispenser: { ...c.dispenser, toc: [{ title: 'X', config: {}, sections: null, tasks: ['t1', 'nofolder'] }] }
		};
		const { sections } = await nav.courseTasks(broken, 'nav_alice', 'en');
		expect(sections[0].tasks!.map((t) => t.name)).toEqual(['T1 easy']);
	});
});

describe('sidebar sections', () => {
	it('NAV-20 exposes main_menu entries', async () => {
		expect(await nav.mainMenu()).toEqual([]);
		plugins().addHook('main_menu', () => ({ label: 'Upcoming Tasks', href: '/coming_tasks' }));
		expect(await nav.mainMenu()).toEqual([{ items: [{ label: 'Upcoming Tasks', href: '/coming_tasks' }] }]);
		// Only http(s) and relative links are kept.
		plugins().addHook('main_menu', () => ({ label: 'Script', href: 'javascript:alert(1)' }));
		plugins().addHook('main_menu', () => ({ label: 'Site', href: 'https://inginious.org' }));
		expect((await nav.mainMenu())[0].items.map((i) => i.label)).toEqual(['Upcoming Tasks', 'Site']);
		plugins().addHook('course_menu', () => [{ label: 'Data', href: 'data:text/html,x' }]);
		expect((await nav.courseNav(course('nav_open'), null, 'en'))[0].items.map((i) => i.label)).toEqual(['Tasks']);
	});

	it('NAV-09 builds the course section for staff, students and visitors', async () => {
		plugins().addHook('course_menu', () => [{ label: 'Scoreboard', href: '/scoreboard/nav_open' }]);
		const labels = async (u: string | null) =>
			(await nav.courseNav(course('nav_open'), u, 'en'))[0].items.map((i) => i.label);
		expect(await labels('nav_tutor')).toEqual(['Tasks', 'Scoreboard', 'Course administration']);
		expect(await labels(null)).toEqual(['Tasks', 'Scoreboard']);
		await env.db.c.courses.insertOne({ _id: 'nav_open', students: ['nav_alice'] });
		expect(await labels('nav_alice')).toEqual(['Tasks', 'Scoreboard', 'Group management']);
		await env.db.c.groups.insertOne({
			courseid: 'nav_open',
			description: 'Group A',
			size: 2,
			students: ['nav_alice'],
			audiences: []
		} as never);
		expect((await labels('nav_alice'))[2]).toBe('Group : Group A');
		expect((await nav.courseNav(course('nav_open'), null, 'en'))[0].title).toBe('NAV Open course');
	});
});
