import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { parse } from 'yaml';
import { siteEnv, MCQ_TASK, type SiteEnv } from '../../../../../tests/site/env.js';
import { getCourse } from '../../courses/course.js';
import { PluginRegistry, resetPlugins } from '../index.js';
import * as contests from './inginious.frontend.plugins.contests.js';

let env: SiteEnv;
let registry: PluginRegistry;
const START = Date.parse('2026-01-01T10:00:00Z');
const settings = (extra = {}) => ({
	enabled: true,
	start: '2026-01-01 10:00:00+00:00',
	end: '2099-01-01 00:00:00+00:00',
	blackout: 0,
	penalty: 20,
	...extra
});
const contestCourse = (id: string, s: object) =>
	env.course(
		id,
		{
			name: `C ${id}`,
			admins: ['admin1'],
			task_dispenser: 'contest',
			dispenser_data: {
				contest_settings: s,
				toc_data: { toc: [{ title: 'P', tasks_list: ['p1', 'p2'] }], config: { p1: {}, p2: {} } }
			}
		},
		{ p1: MCQ_TASK, p2: MCQ_TASK }
	);

const status = async (fn: () => unknown) => {
	try {
		await fn();
		return 200;
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
};

beforeAll(async () => {
	env = await siteEnv();
	contestCourse('ct', settings());
	contestCourse('off', settings({ enabled: false }));
	contestCourse('future', settings({ start: '2098-01-01 00:00:00+00:00' }));
	contestCourse('ended', settings({ end: '2026-01-02 10:00:00+00:00', blackout: 1 }));
	env.course('toc', { name: 'toc' });
	registry = resetPlugins();
	await registry.load([{ plugin_module: contests.MODULE }], { [contests.MODULE]: async () => contests });
	await env.db.c.users.insertMany(
		['alice', 'bob', 'carl'].map((u) => ({
			username: u,
			realname: u.toUpperCase(),
			email: `${u}@x`,
			language: 'en',
			bindings: {}
		}))
	);
	for (const c of ['ct', 'ended']) await env.db.c.courses.insertOne({ _id: c, students: ['alice', 'bob', 'carl'] });
	const at = (min: number) => new Date(START + min * 60_000);
	const sub = (courseid: string, username: string[], taskid: string, result: string, min: number) => ({
		courseid,
		taskid,
		username,
		result,
		status: 'done' as const,
		submitted_on: at(min),
		input: null as never,
		grade: 0
	});
	await env.db.c.submissions.insertMany([
		sub('ct', ['bob'], 'p1', 'success', 60),
		sub('ct', ['bob'], 'p2', 'failed', 61),
		sub('ct', ['alice'], 'p2', 'timeout', 30),
		sub('ct', ['alice'], 'p2', 'success', 62),
		sub('ct', ['alice'], 'p2', 'success', 70),
		sub('ct', ['carl', 'ghost'], 'p1', 'killed', 10),
		sub('ct', ['carl'], 'p1', 'crash', 20),
		sub('ct', ['carl'], 'p1', 'success', 40),
		sub('ct', ['carl'], 'p9', 'success', 1),
		sub('ended', ['bob'], 'p1', 'success', 23 * 60 + 30)
	]);
});
afterAll(() => env.cleanup());

describe('SITE-14 contests plugin', () => {
	it('adds the course menu entries', async () => {
		const menu = (id: string, username: string | null) =>
			registry.callHook('course_menu', { course: getCourse(id), username });
		expect(await menu('ct', 'admin1')).toEqual([
			[
				{ label: 'Contest', href: '/contest/ct' },
				{ label: 'Contest settings', href: '/contest/ct/admin' }
			]
		]);
		expect(await menu('off', 'alice')).toEqual([[]]);
		expect(await menu('toc', 'admin1')).toEqual([]);
		expect(await status(() => contests.contestOf(getCourse('toc')))).toBe(404);
	});
	it('computes the ranking with penalties, first accepted and activity', async () => {
		const r = await contests.contestScoreboard(getCourse('ct'), 'en', 'UTC');
		expect(r.header).toEqual(['Rank', 'Contestant', 'Solved', 'Score', 'p1', 'p2']);
		expect(r.rows.map((row) => row.map((c) => c.v))).toEqual([
			[1, 'BOB', 1, 60, '1/60', '1'],
			['', 'CARL', 1, 60, '2/60', '0'],
			[3, 'ALICE', 1, 82, '0', '2/82'],
			[4, 'admin1', 0, 0, '0', '0']
		]);
		expect(r.rows[1][4].c).toBe('preset-filled-success-500');
		expect(r.rows[0][4].c).toBe('preset-tonal-success');
		expect(r.activity.map((a) => [a[1].v, a[2].v, a[3].v])).toEqual([
			['ALICE', 'p2', 'Succeeded'],
			['BOB', 'p2', 'Failed'],
			['BOB', 'p1', 'Succeeded'],
			['CARL', 'p1', 'Succeeded'],
			['ALICE', 'p2', 'Failed'],
			['CARL', 'p1', 'Failed']
		]);
		expect([r.started, r.finished]).toEqual([true, false]);
	});
	it('ignores the blackout and refuses disabled contests', async () => {
		const r = await contests.contestScoreboard(getCourse('ended'), 'en', 'UTC');
		expect(r.rows[0][2].v).toBe(0);
		expect(r.finished).toBe(true);
		expect((await contests.contestScoreboard(getCourse('future'), 'en', 'UTC')).started).toBe(false);
		expect(await status(() => contests.contestScoreboard(getCourse('off'), 'en', 'UTC'))).toBe(404);
	});
	it('validates and saves the settings', () => {
		const course = getCourse('off');
		const form = {
			enabled: 'on',
			start: '2026-02-01T10:00',
			end: '2026-02-02 10:00:00+00:00',
			blackout: '2',
			penalty: '30'
		};
		for (const [extra, message] of [
			[{ start: 'x' }, 'Invalid start date'],
			[{ end: 'x' }, 'Invalid end date'],
			[{ end: '2020-01-01' }, 'Start date should be before end date'],
			[{ blackout: 'a' }, 'Invalid number of hours for the blackout'],
			[{ penalty: '-1' }, 'Invalid number of minutes for the penalty: should be greater than 0']
		] as const)
			expect(contests.saveContest(course, { ...form, ...extra })).toBe(message);
		expect(contests.saveContest(course, form)).toBeNull();
		const saved = parse(readFileSync(join(env.dir, 'off', 'course.yaml'), 'utf8'));
		expect(saved.dispenser_data.contest_settings).toMatchObject({
			enabled: true,
			end: '2026-02-02 10:00:00+00:00',
			blackout: 2,
			penalty: 30
		});
		expect(saved.dispenser_data.toc_data.toc[0].tasks_list).toEqual(['p1', 'p2']);
		expect(getCourse('off').dispenser.contest?.enabled).toBe(true);
	});
});
