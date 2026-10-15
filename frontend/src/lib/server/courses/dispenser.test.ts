import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_COURSES, setupCourses, type CoursesEnv } from '../../../../tests/fixtures/courses/setup.js';
import { courseTaskIds, getCourse } from './course.js';
import { isNeverAccessible, NEVER, ALWAYS, isOpen } from './accessible.js';
import * as d from './dispenser.js';

let env: CoursesEnv;
beforeAll(async () => {
	env = await setupCourses({ tasksDirectory: SAMPLE_COURSES });
});
afterAll(() => env.cleanup());

const visible = (courseid: string, username: string | null) => {
	const course = getCourse(courseid);
	return d.userTaskList(course.dispenser, courseTaskIds(course), username);
};

describe('config items', () => {
	const invalid: [Record<string, unknown>, string][] = [
		[{ weight: -1 }, 'The weight value must be a numeric >= 0'],
		[{ weight: '7' }, 'The weight value must be a numeric >= 0 '],
		[{ no_stored_submissions: null }, 'The store submission must be an integer > 1 '],
		[{ no_stored_submissions: -2 }, 'The store submission must be an integer > 1'],
		[{ evaluation_mode: 'worst' }, 'The evaluation mode must be either best or last but is worst'],
		[{ categories: [''] }, 'All categories must have a name but are :[""]'],
		[{ submission_limit: { amount: 'x', period: -1 } }, 'Invalid submission limit'],
		[{ submission_limit: { amount: -1, period: 3 } }, 'You have given a period but no amount for the submission limit'],
		[{ submission_limit: { amount: -3, period: -1 } }, 'Submission limit values must be higher than or equal to -1'],
		[{ group_submission: 'yes' }, 'Invalid submission mode'],
		[{ accessibility: 'zz' }, 'Invalid task accessibility : Unknown format for zz']
	];
	it.each(invalid)('rejects %j', (raw, message) => {
		expect(() => d.parseTaskConfig(raw)).toThrow(new d.InvalidTocError(message));
	});
	it('applies the defaults (never accessible)', () => {
		const c = d.parseTaskConfig({});
		expect(c).toEqual({ ...d.DEFAULT_TASK_CONFIG, accessibility: NEVER });
		expect(d.parseTaskConfig({ group_submission: 'x' }, false).groupSubmission).toBe(false);
		expect(d.parseTaskConfig({ weight: 2.5, categories: ['a'], evaluation_mode: 'last' })).toMatchObject({
			weight: 2.5,
			categories: ['a'],
			evaluationMode: 'last'
		});
	});
	it('mimics Python int()', () => {
		expect(d.pyInt(2.7)).toBe(2);
		expect(d.pyInt(' 3 ')).toBe(3);
		expect(d.pyInt(true)).toBe(1);
		expect(() => d.pyInt('x')).toThrow("invalid literal for int() with base 10: 'x'");
	});
});

describe('table of contents', () => {
	it('parses sections and legacy formats', () => {
		const toc = d.parseSections([
			{ title: 'A', sections_list: [{ title: 'B', tasks_list: { t1: 0, t2: 1 } }] },
			{ title: 'C', tasks_list: null }
		]);
		expect(d.sectionTasks(toc)).toEqual(['t1', 't2']);
		expect(d.parseSections({})).toEqual([]);
		expect(d.parseDispenser('toc', [{ title: 'X', tasks_list: ['a'] }]).data).toEqual({
			toc: [{ title: 'X', tasks_list: ['a'] }],
			config: {}
		});
		expect(d.parseDispenser(undefined, null).toc).toEqual([]);
		expect(d.parseDispenser('unknown', { toc: [], config: null }).kind).toBe('toc');
	});
	it.each([
		[[{ title: 'x' }], "One section don't contain a sections list nor a tasks list"],
		[[null], "One section don't contain a sections list nor a tasks list"],
		[[{ tasks_list: [] }], 'No title for one section'],
		[[{ title: 'x', tasks_list: ['a/b'] }], 'One task id contains non alphanumerical characters'],
		['nope', 'Invalid dispenser data structure']
	])('rejects %j', (toc, message) => {
		expect(() => d.parseSections(toc)).toThrow(message);
	});
	it('rejects invalid dispenser data', () => {
		expect(() => d.parseDispenser('toc', { other: 1 })).toThrow('Invalid dispenser data structure');
		expect(() => d.parseDispenser('toc', { toc: [], config: { t: { weight: -1 } } })).toThrow(
			'In taskid t : The weight value must be a numeric >= 0'
		);
		expect(() =>
			d.parseDispenser('combinatory_test', {
				toc: [{ title: 'P', config: { amount: 'x' }, tasks_list: [] }]
			})
		).toThrow('invalid literal');
	});
	it('lists visible tasks of navopen (NAV-10)', () => {
		expect(visible('navopen', 'nav_alice')).toEqual(['t1', 't2', 't3', 'textra', 'tpast', 'tsoft']);
		const course = getCourse('navopen');
		expect(d.orderedTasks(course.dispenser, courseTaskIds(course))).toEqual([
			't1',
			't2',
			't3',
			'tfuture',
			'tpast',
			'tsoft',
			'tnever'
		]);
		expect(d.allCategories(course.dispenser)).toEqual(['easy', 'hard']);
		expect(d.taskConfig(course.dispenser, 'tnever')).toBe(d.DEFAULT_TASK_CONFIG);
		expect(d.accessibility(course.dispenser, 't1', null)).toEqual(ALWAYS);
	});
});

describe('course grade (NAV-11)', () => {
	it('computes the weighted average with half-to-even rounding', () => {
		const course = getCourse('navopen');
		const ut = (username: string, taskid: string, grade: number) => ({ username, taskid, grade });
		const tasks = [
			ut('a', 't1', 100),
			ut('a', 't2', 50),
			ut('a', 'tpast', 100),
			ut('a', 'textra', 100),
			ut('a', 'tfuture', 100),
			ut('b', 't1', 10)
		];
		const grade = (u: string) =>
			d.courseGrade(
				course.dispenser,
				d.userTaskList(course.dispenser, courseTaskIds(course), u),
				tasks.filter((x) => x.username === u)
			);
		expect(['a', 'b', 'c'].map(grade)).toEqual([77, 1, 0]);
		expect(d.courseGrade(course.dispenser, [], tasks)).toBe(0);
		expect([76.5, 77.5, 0.5, 1.5, 2.4, 2.6].map(d.roundHalfEven)).toEqual([76, 78, 0, 2, 2, 3]);
	});
});

describe('combinatory test (NAV-13)', () => {
	it('draws the documented tasks', () => {
		expect(visible('navcombi', 'nav_alice')).toEqual(['c3', 'c4', 'c6']);
		expect(visible('navcombi', 'nav_bob')).toEqual(['c1', 'c3', 'c6']);
		expect(visible('navcombi', 'nav_carol')).toEqual(['c1', 'c2', 'c6']);
		expect(visible('navcombi', 'superadmin')).toEqual(['c1', 'c2', 'c5']);
		expect(visible('navcombi', null)).toHaveLength(3);
		const course = getCourse('navcombi');
		expect(d.groupSubmission(course.dispenser, 'c1')).toBe(false);
		expect(isNeverAccessible(d.accessibility(course.dispenser, 'c1', 'nav_alice'))).toBe(true);
	});
});

describe('contest dispenser', () => {
	it('opens the toc tasks at the contest start', () => {
		const c = d.parseDispenser('contest', {
			contest_settings: { enabled: true, start: '2020-01-01 00:00:00+00:00' },
			toc_data: {
				toc: [{ title: 'P', tasks_list: ['a'] }],
				config: { a: { accessibility: false } }
			}
		});
		const acc = d.accessibilities(c, ['a', 'b'], 'u');
		expect(acc.a.start).toBe(Date.UTC(2020, 0, 1));
		expect(acc.b).toEqual(NEVER);
		const disabled = d.parseDispenser('contest', {
			toc_data: { toc: [], config: { a: { accessibility: true } } }
		});
		expect(disabled.contest?.enabled).toBe(false);
		expect(isOpen(d.accessibility(disabled, 'a', 'u'))).toBe(true);
		expect(d.groupSubmission(disabled, 'a')).toBe(false);
	});
});

describe('checkDispenserData (CADM-07/09)', () => {
	const toc = d.parseDispenser('toc', { toc: [], config: {}, imported: true });
	it('cleans the config of toc tasks and keeps the imported flag', () => {
		const res = d.checkDispenserData(toc, {
			toc: [{ title: 'S', tasks_list: ['a', 'b'] }],
			config: { a: { weight: 2 }, z: {} }
		});
		expect(res).toEqual({
			data: {
				toc: [{ title: 'S', tasks_list: ['a', 'b'] }],
				config: { a: { weight: 2 }, b: {} },
				imported: true
			}
		});
	});
	it('reports errors', () => {
		expect(d.checkDispenserData(toc, { toc: [{ title: '', tasks_list: [] }] })).toEqual({
			error: 'No title for one section'
		});
		expect(
			d.checkDispenserData(toc, {
				toc: [{ title: 'S', tasks_list: ['a'] }],
				config: { a: { evaluation_mode: 'x' } }
			})
		).toEqual({
			error: 'In taskid a : The evaluation mode must be either best or last but is x'
		});
	});
	it('casts combinatory amounts and wraps contest data', () => {
		const combi = d.parseDispenser('combinatory_test', { toc: [] });
		const res = d.checkDispenserData(combi, {
			toc: [
				{ title: 'P', config: { amount: '1' }, tasks_list: ['a'] },
				{ title: 'Q', tasks_list: [] }
			],
			config: { a: { group_submission: true } }
		});
		expect(res).toMatchObject({
			data: { toc: [{ config: { amount: 1 } }, { config: { amount: 0 } }], imported: false }
		});
		expect(
			d.checkDispenserData(combi, {
				toc: [{ title: 'P', config: { amount: 'x' }, tasks_list: [] }]
			})
		).toEqual({ error: "invalid literal for int() with base 10: 'x'" });
		expect(d.checkDispenserData(combi, {})).toMatchObject({ data: { toc: [], config: {} } });
		// A structure without (or with an empty dict) toc is stored with an empty toc, so that it stays loadable.
		const saved = d.checkDispenserData(combi, { toc: {} });
		expect(saved).toMatchObject({ data: { toc: [] } });
		expect(() => d.parseDispenser('combinatory_test', (saved as { data: unknown }).data)).not.toThrow();
		const contest = d.parseDispenser('contest', { toc_data: { toc: [] } });
		expect(d.checkDispenserData(contest, { toc: [] })).toMatchObject({
			data: { toc_data: { toc: [] }, contest_settings: { enabled: false } }
		});
	});
});
