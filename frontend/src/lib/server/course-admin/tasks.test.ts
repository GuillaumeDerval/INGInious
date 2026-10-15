/** Unit tests of the task list administration (CADM-06..09) and of the danger zone (CADM-15/16). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import { getCourse, saveCourse } from '../courses/course.js';
import { parseYaml } from '../courses/files.js';
import { archiveCourse, wipeAndDeleteCourse } from './danger.js';
import { migrateTasks, saveStructure, switchDispenser } from './tasks.js';
import { setup, type CoursesEnv } from './testing/helpers.js';

let env: CoursesEnv;
beforeAll(async () => (env = await setup()));
afterAll(() => env.cleanup());

const course = (id: string) =>
	parseYaml(readFileSync(join(env.dir, id, 'course.yaml'), 'utf8')) as Record<string, unknown>;
/** A copy of the fixture course under another id. */
const copy = (id: string) => (cpSync(join(env.dir, 'fx'), join(env.dir, id), { recursive: true }), getCourse(id));

/** Seeds one submission (with GridFS input), user task, group and audience for a task. */
async function seed(courseid: string, taskid = 'code1') {
	const { db } = env;
	const input = await db.putFile(new Uint8Array([1]));
	await db.c.submissions.insertOne({ courseid, taskid, input, archive: null, username: ['u'] } as never);
	await db.c.userTasks.insertOne({ courseid, taskid, username: 'u' } as never);
	await db.c.groups.insertOne({ courseid, description: 'g', size: 1, students: [], audiences: [] } as never);
	await db.c.audiences.insertOne({ courseid, description: 'a', students: [], tutors: [] } as never);
	await db.c.courses.insertOne({ _id: courseid, students: ['u'] } as never);
	return input;
}
const count = (name: 'submissions' | 'userTasks' | 'groups' | 'audiences', courseid: string) =>
	env.db.c[name].countDocuments({ courseid });

describe('dispenser', () => {
	it('switches the dispenser and wipes the structure', () => {
		const c = copy('sw');
		expect(switchDispenser(c, 'bogus', ['toc'])).toBe('Invalid task dispenser');
		expect(switchDispenser(c, 'combinatory_test', ['toc', 'combinatory_test'])).toBeNull();
		expect(course('sw')).toMatchObject({ task_dispenser: 'combinatory_test', dispenser_data: {}, custom_key: 'kept' });
	});
	it('saves the structure, creates, deletes and wipes tasks independently', async () => {
		const c = copy('st');
		await seed('st', 'upload');
		const toc = [{ title: 'Week 1', config: { closed: false }, tasks_list: ['code1', 'new1', 'mcq1'] }];
		const errors = await saveStructure(c, {
			structure: { toc, config: { code1: { weight: 2 }, gone: {} } },
			created: ['new1', 'code1', 'bad id'],
			deleted: ['upload'],
			wiped: ['upload']
		});
		expect(errors).toEqual([
			"Couldn't create task code1 : Task with id code1 already exists.",
			"Couldn't create task bad id : Invalid task id: st/bad id"
		]);
		expect(course('st').dispenser_data).toEqual({
			toc,
			config: { code1: { weight: 2 }, new1: {}, mcq1: {} },
			imported: false
		});
		expect(parseYaml(readFileSync(join(env.dir, 'st', 'new1', 'task.yaml'), 'utf8'))).toEqual({
			environment_type: 'mcq',
			name: 'new1',
			problems: {}
		});
		expect(existsSync(join(env.dir, 'st', 'upload'))).toBe(false);
		expect(await count('submissions', 'st')).toBe(0);
		expect(await count('userTasks', 'st')).toBe(0);
	});
	it('reports invalid structures with the legacy message', async () => {
		const c = copy('bad');
		expect(
			await saveStructure(c, {
				structure: { toc: [{ title: '', tasks_list: [] }] },
				created: [],
				deleted: [],
				wiped: []
			})
		).toEqual(['Something wrong happened: Invalid course structure: No title for one section']);
		expect(
			await saveStructure(c, {
				structure: { toc: [{ title: 'a', tasks_list: ['code1'] }], config: { code1: { weight: -1 } } },
				created: [],
				deleted: [],
				wiped: []
			})
		).toEqual([
			'Something wrong happened: Invalid course structure: In taskid code1 : The weight value must be a numeric >= 0'
		]);
	});
	it('migrates the legacy task settings', () => {
		copy('mig');
		saveCourse('mig', { name: 'M', dispenser_data: { toc: [{ title: 'A', tasks_list: ['legacy'] }] } });
		expect(migrateTasks(getCourse('mig'))).toBeNull();
		expect((course('mig').dispenser_data as { config: Record<string, unknown> }).config.legacy).toEqual({
			weight: 4,
			no_stored_submissions: 1,
			group_submission: true,
			evaluation_mode: 'last',
			accessibility: '2025-01-01 00:00:00/2030-01-01 00:00:00',
			categories: ['old']
		});
		const task = parseYaml(readFileSync(join(env.dir, 'mig', 'legacy', 'task.yaml'), 'utf8')) as Record<
			string,
			unknown
		>;
		expect(task.weight).toBeUndefined();
		expect(task.custom_key).toBe('keep me');
		saveCourse('mig', { name: 'M', dispenser_data: { toc: [{ title: 'A', tasks_list: ['legacy'] }] } });
		writeFileSync(
			join(env.dir, 'mig', 'legacy', 'task.yaml'),
			"name: L\nweight: '7'\nproblems: {}\nenvironment_type: mcq\n"
		);
		expect(migrateTasks(getCourse('mig'))).toMatch(/^Something wrong happened/);
	});
});

describe('danger zone', () => {
	it('archives the course data into a copy', async () => {
		const c = copy('arc');
		const input = await seed('arc');
		const id = await archiveCourse(c, new Date('2026-10-14T05:39:08.943Z'));
		expect(id).toBe('arc_archive_2026_10_14_05_39_08');
		expect(course(id)).toMatchObject({
			archived: true,
			archive_date: '2026-10-14T05:39:08.943000+00:00',
			custom_key: 'kept'
		});
		expect(existsSync(join(env.dir, id, 'code1', 'task.yaml'))).toBe(true);
		for (const name of ['submissions', 'userTasks', 'groups', 'audiences'] as const) {
			expect(await count(name, 'arc')).toBe(0);
			expect(await count(name, id)).toBe(1);
		}
		expect(await env.db.c.courses.findOne({ _id: id } as never)).toEqual({ _id: id, students: ['u'] });
		expect(await env.db.c.courses.findOne({ _id: 'arc' } as never)).toBeNull();
		expect(await env.db.getFile(input)).toBeTruthy();
		await expect(archiveCourse(c, new Date('2026-10-14T05:39:08.943Z'))).rejects.toThrow('already exists');
		await expect(archiveCourse(getCourse(id))).rejects.toThrow('already an archive');
		const empty = copy('arc2');
		expect(await archiveCourse(empty)).toMatch(/^arc2_archive_/);
	});
	it('deletes the course and its data', async () => {
		const c = copy('del');
		const input = await seed('del');
		await wipeAndDeleteCourse(c);
		expect(existsSync(join(env.dir, 'del'))).toBe(false);
		for (const name of ['submissions', 'userTasks', 'groups', 'audiences'] as const)
			expect(await count(name, 'del')).toBe(0);
		expect(await env.db.c.courses.findOne({ _id: 'del' } as never)).toEqual({ _id: 'del', students: [] });
		await expect(env.db.getFile(input as ObjectId)).rejects.toThrow();
	});
});
