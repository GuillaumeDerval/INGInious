/** Unit tests of the task editor (CADM-10..13, SITE-17). */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { services } from '../app.js';
import { getCourse, NotFoundError } from '../courses/course.js';
import { parseYaml } from '../courses/files.js';
import { resetPlugins } from '../plugins/index.js';
import { init as exampleInit } from '../plugins/bundled/inginious.frontend.plugins.task_editor_hook_example.js';
import { editorTabs, environments, normalize, readTask, requireTaskAdmin, saveEditor } from './task-editor.js';
import { fakeEvent, settle, setup, type CoursesEnv } from './testing/helpers.js';
import { BASIC_SPEC, envSpec, PROBLEM_SPECS, type FieldSpec } from '#lib/components/course-admin/specs.js';

let env: CoursesEnv;
beforeAll(async () => (env = await setup()));
afterAll(() => env.cleanup());
afterEach(() => resetPlugins());

const yaml = (task: string) =>
	parseYaml(readFileSync(join(env.dir, 'fx', task, 'task.yaml'), 'utf8')) as Record<string, unknown>;
const base = {
	name: 'T',
	context: 'ctx',
	author: 'Me',
	contact_url: '',
	input_random: 2,
	regenerate_input_random: true,
	environment_type: 'mcq',
	environment_id: 'mcq'
};

describe('helpers', () => {
	it('environments come from the backend client', () => {
		Object.assign(services(), { backend: { environments: { docker: ['default'] } } });
		expect(environments()).toEqual({ docker: ['default'] });
		Object.assign(services(), { backend: undefined });
	});
	it('envSpec offers the backend ids plus the current one', () => {
		const ids = envSpec({ docker: ['python3', 'default'] }, 'old').find((f) => f.key === 'environment_id')!;
		expect((ids.options as (v: object) => unknown)({ environment_type: 'docker' })).toEqual([
			['default', 'default'],
			['old', 'old'],
			['python3', 'python3']
		]);
		expect((ids.options as (v: object) => unknown)({ environment_type: 'nvidia' })).toEqual([['old', 'old']]);
	});
});

describe('normalize', () => {
	const f = (kind: FieldSpec['kind'], more: Partial<FieldSpec> = {}): FieldSpec[] => [
		{ key: 'a.b', label: 'A', kind, ...more }
	];
	it('types the values and removes empty optional ones', () => {
		expect(normalize(f('bool'), { a: { b: false } }, { a: { b: true, c: 1 } })).toEqual({ a: { c: 1 } });
		expect(normalize(f('bool'), { a: { b: true } })).toEqual({ a: { b: true } });
		expect(normalize(f('csv', { optional: true }), { a: { b: ' .py, ,.txt' } })).toEqual({ a: { b: ['.py', '.txt'] } });
		expect(normalize(f('csv', { optional: true }), { a: { b: [] } })).toEqual({ a: {} });
		expect(normalize(f('csv'), {})).toEqual({ a: { b: [] } });
		expect(normalize(f('int', { optional: true }), { a: { b: '' } })).toEqual({ a: {} });
		expect(normalize(f('int'), { a: { b: null } })).toEqual({ a: { b: 0 } });
		expect(normalize(f('number', { min: 0 }), { a: { b: '2.5' } })).toEqual({ a: { b: 2.5 } });
		expect(normalize(f('int'), { a: { b: -5 } })).toEqual({ a: { b: -5 } });
		expect(normalize(f('text', { optional: true }), { a: { b: '' } })).toEqual({ a: {} });
		expect(normalize(f('text'), {})).toEqual({ a: { b: '' } });
		expect(
			normalize(f('list', { fields: [{ key: 'x', label: 'X', kind: 'bool' }] }), {
				a: { b: [{ x: true }, { x: false }] }
			})
		).toEqual({ a: { b: [{ x: true }, {}] } });
		expect(normalize(f('list', { fields: [] }), {})).toEqual({ a: { b: [] } });
	});
	it('refuses invalid numbers and missing required values', () => {
		expect(() => normalize(f('int', { min: 1 }), { a: { b: 0 } })).toThrow('A: a number >= 1 is expected.');
		expect(() => normalize(f('int', { min: 0 }), { a: { b: 1.5 } })).toThrow('A: a number >= 0 is expected.');
		expect(() => normalize(f('number'), { a: { b: 'x' } })).toThrow();
		expect(() => normalize(f('select', { required: true }), {})).toThrow('A is required.');
	});
});

describe('readTask / requireTaskAdmin', () => {
	it('reads the migrated descriptor of existing tasks only', async () => {
		expect(readTask(getCourse('fx'), 'legacy')).toMatchObject({
			environment_id: 'python3',
			environment_type: 'docker'
		});
		expect(() => readTask(getCourse('fx'), 'nope')).toThrow(NotFoundError);
		expect(() => readTask(getCourse('fx'), '..')).toThrow(NotFoundError);
		expect((await requireTaskAdmin(fakeEvent('admin1', { courseid: 'fx', taskid: 'code1' }))).raw.name).toBe(
			'Code task'
		);
		expect(await settle(() => requireTaskAdmin(fakeEvent('admin1', { courseid: 'fx', taskid: 'nope' })))).toMatchObject(
			{
				status: 404
			}
		);
		expect(
			await settle(() => requireTaskAdmin(fakeEvent('tutor1', { courseid: 'fx', taskid: 'code1' })))
		).toMatchObject({
			status: 403
		});
	});
});

describe('saveEditor', () => {
	it('merges the values into task.yaml (unknown keys kept, typed values)', async () => {
		const problems = [
			{
				id: 'q1',
				type: 'code',
				name: 'Code Q',
				header: '',
				language: 'python',
				optional: true,
				default: '',
				offset: 3
			},
			{
				id: 'q5',
				type: 'multiple_choice',
				name: 'MCQ',
				header: '',
				multiple: true,
				limit: 2,
				success_message: '',
				choices: [
					{ text: 'Yes', feedback: 'good', valid: true },
					{ text: 'No', feedback: '' }
				]
			},
			{ id: 'q3', type: 'file', name: 'F', allowed_exts: '.py, .txt', max_size: 1000 }
		];
		expect(
			await saveEditor(getCourse('fx'), 'legacy', { values: { ...base, context: '#MD\n*md*' }, problems })
		).toBeNull();
		const saved = yaml('legacy');
		expect(saved).toMatchObject({
			custom_key: 'keep me',
			weight: 4,
			name: 'T',
			input_random: 2,
			regenerate_input_random: true,
			context: '#MD\n*md*',
			environment_parameters: {}
		});
		expect(Object.keys(saved.problems as object)).toEqual(['q1', 'q5', 'q3']);
		expect(saved.problems).toEqual({
			q1: { type: 'code', name: 'Code Q', header: '', language: 'python', optional: true, default: '', offset: 3 },
			q5: {
				type: 'multiple_choice',
				name: 'MCQ',
				header: '',
				multiple: true,
				limit: 2,
				choices: [{ text: 'Yes', feedback: 'good', valid: true }, { text: 'No' }]
			},
			q3: { type: 'file', name: 'F', header: '', allowed_exts: ['.py', '.txt'], max_size: 1000 }
		});
		expect(saved.environment).toBeUndefined();
	});
	it('keeps unknown problem keys and docker parameters', async () => {
		const values = {
			...base,
			regenerate_input_random: false,
			environment_type: 'docker',
			environment_id: 'default',
			environment_parameters: { limits: { time: 15, memory: 256, hard_time: '' }, network_grading: true, run_cmd: '' }
		};
		const problems = [{ id: 'code', type: 'code', name: 'N', header: 'H', language: 'python', default: 'pass' }];
		expect(await saveEditor(getCourse('fx'), 'code1', { values, problems })).toBeNull();
		const saved = yaml('code1');
		expect(saved.regenerate_input_random).toBeUndefined();
		expect(saved.environment_parameters).toEqual({
			limits: { time: 15, memory: 256, disk: 100 },
			network_grading: true
		});
		expect(saved.problems).toEqual({
			code: { type: 'code', name: 'N', header: 'H', language: 'python', default: 'pass' }
		});
	});
	it('reports invalid data and never saves it', async () => {
		const before = readFileSync(join(env.dir, 'fx', 'mcq1', 'task.yaml'), 'utf8');
		const save = (values: object, problems: object[] = []) =>
			saveEditor(getCourse('fx'), 'mcq1', { values: { ...base, ...values }, problems } as never);
		expect(await save({ input_random: -1 })).toBe('Random inputs: a number >= 0 is expected.');
		expect(await save({ environment_id: '' })).toBe('Grading environment is required.');
		expect(await save({}, [{ id: 'a b', type: 'code' }])).toBe('Invalid problem: a b');
		expect(await save({}, [{ id: 'a', type: 'nope' }])).toBe('Invalid problem: a');
		expect(
			await save({}, [
				{ id: 'a', type: 'match' },
				{ id: 'a', type: 'match' }
			])
		).toBe('Invalid problem: a');
		expect(await save({}, [{ id: 'a', type: 'code', language: 'c++' }])).toBe('Invalid data: Invalid language c++');
		expect(await save({ environment_type: 'bogus' })).toBe('Invalid data: Environment type bogus is unknown');
		expect(readFileSync(join(env.dir, 'fx', 'mcq1', 'task.yaml'), 'utf8')).toBe(before);
	});
	it('saves tasks that had no problems key', async () => {
		writeFileSync(join(env.dir, 'fx', 'future', 'task.yaml'), 'name: F\nauthor: [A, B]\nenvironment_type: mcq\n');
		expect(await saveEditor(getCourse('fx'), 'future', { values: base, problems: [] })).toBeNull();
		expect(yaml('future').problems).toEqual({});
	});
	it('runs the plugin hooks of the example plugin (SITE-17)', async () => {
		exampleInit(resetPlugins());
		const tabs = await editorTabs(getCourse('fx'), 'mcq1', { name: 'MCQ task' });
		expect(tabs.map((t) => t.id)).toEqual(['tab_example', 'tab_example_2']);
		expect(tabs[1].text).toContain('course "Fixture course" (id: "fx"), and task "mcq1"');
		expect(tabs[1].text).toContain('such as the name "MCQ task"');
		expect(await editorTabs(getCourse('fx'), 'x', {})).toHaveLength(2);
		const problems = [{ id: 'm', type: 'match', answer: '42', centralize: true }];
		expect(await saveEditor(getCourse('fx'), 'mcq1', { values: base, problems })).toBe(
			'You must provide a task hint in Example tab 2'
		);
		expect(
			await saveEditor(getCourse('fx'), 'mcq1', {
				values: { ...base, example_task_hint: 'hint!', injected: 'no' },
				problems
			})
		).toBeNull();
		expect(yaml('mcq1')).toMatchObject({
			example_field: 'test',
			example_task_hint: 'hint!',
			problems: { m: { type: 'match', answer: '42', centralize: true } }
		});
		expect(yaml('mcq1').injected).toBeUndefined();
	});
	it('exposes the data-driven specs', () => {
		expect(Object.keys(PROBLEM_SPECS)).toEqual(['code', 'code_single_line', 'file', 'match', 'multiple_choice']);
		expect(BASIC_SPEC.map((f) => f.key)).toContain('context');
	});
});
