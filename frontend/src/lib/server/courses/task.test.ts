import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMo, setupCourses, type CoursesEnv } from '../../../../tests/fixtures/courses/setup.js';
import { buildCourse, getCourse, NotFoundError } from './course.js';
import { checkDispenserData } from './dispenser.js';
import * as t from './task.js';

let env: CoursesEnv;
beforeAll(async () => {
	env = await setupCourses();
});
afterAll(() => env.cleanup());

describe('loading', () => {
	it('reads a docker task', () => {
		const task = t.getTask(getCourse('fx'), 'code1');
		expect(task).toMatchObject({
			courseId: 'fx',
			id: 'code1',
			name: 'Code task',
			author: 'Tester',
			contactUrl: 'mailto:x@y?subject={course_id}',
			context: 'Write *code*.\n',
			environmentType: 'docker',
			environmentId: 'default',
			environmentParameters: {
				run_cmd: null,
				network_grading: false,
				limits: { time: 10, hard_time: 30, memory: 256, disk: 100 }
			},
			inputRandom: 0,
			regenerateInputRandom: false
		});
		expect(task.problems.map((p) => p.id)).toEqual(['code', 'opt']);
		expect(t.getTask(getCourse('fx'), 'code1')).toBe(task);
	});
	it('applies defaults, legacy migrations and the course text format', () => {
		const course = getCourse('fx');
		expect(t.getTask(course, 'future')).toMatchObject({
			name: 'Task future',
			author: '',
			inputRandom: 2,
			regenerateInputRandom: true,
			environmentParameters: {}
		});
		expect(t.getTask(course, 'upload')).toMatchObject({
			environmentType: 'docker-ssh',
			environmentParameters: { run_cmd: null, limits: { time: 20, memory: 1024, disk: 1024 } }
		});
		expect(t.getTask(course, 'legacy')).toMatchObject({
			environmentType: 'docker',
			environmentId: 'python3',
			environmentParameters: {
				run_cmd: null,
				network_grading: false,
				limits: { time: 30, hard_time: 90, memory: 1024, disk: 1024 }
			}
		});
		expect(t.migrateTaskContent({ environment: 'mcq' })).toMatchObject({
			environment_type: 'mcq',
			environment_id: 'mcq'
		});
		expect(
			t.migrateTaskContent({
				environment_type: 'docker',
				environment_parameters: { ssh_allowed: true }
			}).environment_type
		).toBe('docker-ssh');
	});
	it('validates environments', () => {
		const course = getCourse('fx');
		expect(() => t.getTask(course, 'broken')).toThrow('Environment type unknown-env is unknown');
		expect(() => t.buildTask(course, 'x', { environment_type: 'mcq' })).toThrow(
			'Tasks must have some problems descriptions'
		);
		expect(() => t.buildTask(course, 'x', null as never)).toThrow('Invalid task descriptor');
		expect(() => t.buildTask(course, 'x', { problems: {} })).toThrow('Environment type unknown is unknown');
		expect(() => t.checkEnvironmentParameters('docker', { limits: { time: 0 } })).toThrow('Invalid limit');
		expect(() => t.checkEnvironmentParameters('docker', { limits: { time: 'x' } })).toThrow('Invalid limit');
		expect(
			t.checkEnvironmentParameters('nvidia', {
				run_cmd: 'run',
				network_grading: true,
				limits: null
			})
		).toEqual({
			run_cmd: 'run',
			network_grading: true,
			limits: { time: 20, hard_time: 60, memory: 1024, disk: 1024 }
		});
		expect(() => t.getTask(course, 'missing')).toThrow(NotFoundError);
		expect(() => t.getTask(course, '../fx')).toThrow(NotFoundError);
	});
	it('lists loadable tasks only', () => {
		expect([...t.listTasks(getCourse('fx')).keys()]).toEqual(['code1', 'future', 'legacy', 'mcq1', 'upload']);
	});
	it('translates with the first existing $i18n folder', () => {
		const course = getCourse('fx');
		const dir = (...p: string[]) => {
			const d = join(env.dir, 'fx', ...p);
			mkdirSync(d, { recursive: true });
			return d;
		};
		writeFileSync(
			join(dir('$common', '$i18n'), 'fr.mo'),
			compileMo({ 'Code task': 'Tâche commune', 'MCQ task': 'QCM' })
		);
		writeFileSync(join(dir('code1', 'student', '$i18n'), 'fr.mo'), compileMo({ 'Code task': 'Tâche code' }));
		const code = t.getTask(course, 'code1');
		expect(code.tr('fr', 'Code task')).toBe('Tâche code');
		expect(code.tr('fr', 'MCQ task')).toBe('MCQ task');
		expect(t.getTask(course, 'mcq1').tr('fr', 'MCQ task')).toBe('QCM');
	});
});

describe('writing', () => {
	it('creates, saves and deletes tasks', () => {
		t.createTask('fx', 'newt', { name: 'New', environment_type: 'mcq', problems: {} });
		expect(t.getTask(getCourse('fx'), 'newt').name).toBe('New');
		expect(() => t.createTask('fx', 'newt', {})).toThrow('EEXIST');
		expect(() => t.createTask('fx', '..', {})).toThrow('Invalid task id');
		t.saveTask('fx', 'newt', { name: 'Renamed', environment_type: 'mcq', problems: {} });
		expect(readFileSync(join(env.dir, 'fx', 'newt', 'task.yaml'), 'utf8')).toBe(
			'name: Renamed\nenvironment_type: mcq\nproblems: {}\n'
		);
		expect(t.getTask(getCourse('fx'), 'newt').name).toBe('Renamed');
		t.deleteTask('fx', 'newt');
		expect(existsSync(join(env.dir, 'fx', 'newt'))).toBe(false);
		expect(() => t.deleteTask('fx', '')).toThrow(NotFoundError);
		expect(() => t.saveTask('fx', 'a b', {})).toThrow(NotFoundError);
	});
});

describe('legacy dispenser settings (CADM-06)', () => {
	it('imports and drops legacy task.yaml fields', () => {
		const course = getCourse('fx');
		expect(t.hasLegacyTasks(course)).toBe(true);
		const data = t.importLegacyTasks(course);
		expect((data.config as Record<string, unknown>).legacy).toEqual({
			weight: 4,
			no_stored_submissions: 1,
			group_submission: true,
			evaluation_mode: 'last',
			accessibility: '2025-01-01 00:00:00/2030-01-01 00:00:00',
			categories: ['old']
		});
		expect((data.config as Record<string, unknown>).code1).toEqual({
			weight: 1,
			accessibility: true,
			categories: ['easy']
		});
		expect(checkDispenserData(course.dispenser, data)).toHaveProperty('data');
		t.dropLegacyFields(course);
		expect(readFileSync(join(env.dir, 'fx', 'legacy', 'task.yaml'), 'utf8')).toBe(
			'name: Legacy task\nenvironment: python3\nlimits:\n    time: 30\ncustom_key: keep me\nproblems: {}\n'
		);
		expect(t.hasLegacyTasks(getCourse('fx'))).toBe(false);
		const combi = buildCourse('fx', { name: 'c', task_dispenser: 'combinatory_test' });
		writeFileSync(join(env.dir, 'fx', 'future', 'task.yaml'), 'environment_type: mcq\ngroups: true\nproblems: {}\n');
		expect(t.hasLegacyTasks(combi)).toBe(false);
		expect((t.importLegacyTasks(combi).config as Record<string, unknown>).future).toEqual({});
	});
});
