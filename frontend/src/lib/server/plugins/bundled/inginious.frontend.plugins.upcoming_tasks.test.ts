/**
 * Unit tests of the upcoming_tasks plugin (NAV-20).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupNav, type NavEnv } from '../../../../../tests/fixtures/nav/setup.js';
import { PluginRegistry } from '../index.js';
import { userCourses } from '../../nav/courses.js';
import { init, upcomingTasks as upcoming } from './inginious.frontend.plugins.upcoming_tasks.js';

/** Upcoming tasks of a user in his courses. */
const upcomingTasks = async (username: string, lang: string, days: number | null) =>
	upcoming(username, await userCourses(username, lang), lang, days);

let env: NavEnv;
beforeAll(async () => {
	env = await setupNav();
	await env.db.c.courses.insertMany([
		{ _id: 'nav_open', students: ['nav_alice', 'nav_bob'] },
		{ _id: 'nav_lti', students: ['nav_alice'] }
	]);
	await env.db.db.collection('user_tasks').insertMany([
		{ username: 'nav_bob', courseid: 'nav_open', taskid: 'tsoft', succeeded: true, grade: 100 },
		{ username: 'nav_alice', courseid: 'nav_open', taskid: 'tsoft', succeeded: false, grade: 40 }
	]);
});
afterAll(() => env.cleanup());

describe('upcoming tasks', () => {
	it('NAV-20 registers the main menu entry', async () => {
		const registry = new PluginRegistry();
		init(registry);
		expect(await registry.callHook('main_menu', {})).toEqual([{ label: 'Upcoming Tasks', href: '/coming_tasks' }]);
	});

	it('NAV-20 lists open unfinished tasks with a deadline of the listed courses', async () => {
		const { courses, count, page, pages } = await upcomingTasks('nav_alice', 'en', null);
		expect([count, page, pages]).toEqual([1, 1, 1]);
		expect(courses).toEqual([
			{
				id: 'nav_open',
				name: 'NAV Open course',
				count: 1,
				tasks: [{ id: 'tsoft', name: 'T soft deadline', deadline: new Date(2099, 9, 20, 12).toISOString(), grade: 40 }]
			}
		]);
		expect((await upcomingTasks('nav_alice', 'en', 7)).courses).toEqual([]);
		expect((await upcomingTasks('nav_bob', 'en', null)).courses).toEqual([]);
		expect((await upcomingTasks('nav_eve', 'en', 30)).courses).toEqual([]);
	});

	it('NAV-20 orders courses by their most urgent task and skips broken tasks', async () => {
		const { cpSync, writeFileSync } = await import('node:fs');
		const { join } = await import('node:path');
		cpSync(join(env.dir, 'nav_open'), join(env.dir, 'nav_open2'), { recursive: true });
		const yaml = (await import('node:fs'))
			.readFileSync(join(env.dir, 'nav_open2', 'course.yaml'), 'utf8')
			.replace('2099-10-20 12:00:00', '2099-10-19 12:00:00')
			.replace('2020-01-01 / 2021-01-01', '2020-01-01 / 2099-11-01');
		writeFileSync(join(env.dir, 'nav_open2', 'course.yaml'), yaml.replace('"NAV Open course"', '"Z course"'));
		writeFileSync(join(env.dir, 'nav_open2', 'tsoft', 'task.yaml'), 'name: [broken');
		await env.db.c.courses.insertOne({ _id: 'nav_open2', students: ['nav_alice'] });
		expect((await upcomingTasks('nav_alice', 'en', null)).courses.map((c) => c.id)).toEqual(['nav_open', 'nav_open2']);
		writeFileSync(
			join(env.dir, 'nav_open2', 'tsoft', 'task.yaml'),
			'name: Soft 2\nenvironment_type: mcq\nproblems: {}\n'
		);
		expect((await upcomingTasks('nav_alice', 'en', null)).courses.map((c) => c.id)).toEqual(['nav_open2', 'nav_open']);
		// Pages are clamped (one page here).
		const courses = await userCourses('nav_alice', 'en');
		expect((await upcoming('nav_alice', courses, 'en', null, 9)).page).toBe(1);
	});
});
