/**
 * Tests of inginious-autotest: output comparison, task.yaml checks, and whole
 * runs grading the recorded submissions of the cli fixture course through the
 * real backend of the Colima stack (mcq agent).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JobResult } from '#lib/server/backend/client.js';
import { checkTaskYaml, compareOutputs, main } from './autotest.js';
import { timing, useServices } from './common.js';
import { installCliCourse, TASKS_DIR, type InstalledCourse } from './testing/fixture.js';

const RESULT: JobResult = {
	result: ['success', 'ok'],
	grade: 100,
	problems: { q1: ['success', 'fine'] },
	tests: { t: [1] },
	custom: {},
	state: 's',
	archive: new Uint8Array([1]),
	stdout: 'out',
	stderr: null
};

let course: InstalledCourse;
let out: string[];
let err: string[];

beforeAll(() => {
	course = installCliCourse('autotest');
});
afterAll(() => course.remove());
afterEach(() => vi.restoreAllMocks());

/** Runs the command, capturing stdout/stderr. */
async function autotest(...argv: string[]): Promise<number> {
	out = [];
	err = [];
	vi.spyOn(console, 'log').mockImplementation((m: string) => void out.push(m));
	vi.spyOn(console, 'error').mockImplementation((m: string) => void err.push(m));
	return main(argv);
}

describe('compareOutputs', () => {
	it('reports nothing for matching outputs and skips missing keys and archives', () => {
		const recorded = { result: 'success', grade: 100, problems: { q1: ['success', 'fine'] }, tests: { t: [1] } };
		expect(compareOutputs({ ...recorded, archive: 'other', stderr: 'x', stdout: null }, RESULT)).toEqual({});
	});

	it('reports every differing key with [recorded, new]', () => {
		const recorded = { result: 'failed', grade: 50, problems: { q1: ['success', 'other'] }, state: 't', stdout: 'o' };
		expect(compareOutputs(recorded, RESULT)).toEqual({
			result: ['failed', ['success', 'ok']],
			grade: [50, 100],
			problems: [recorded.problems, RESULT.problems],
			state: ['t', 's'],
			stdout: ['o', 'out']
		});
	});

	it('reports missing or malformed recorded problems', () => {
		expect(compareOutputs({ problems: { q2: ['success', ''] } }, RESULT)).toHaveProperty('problems');
		expect(compareOutputs({ problems: { q1: 'success' } }, RESULT)).toHaveProperty('problems');
		expect(compareOutputs({ problems: { q1: ['failed', 'fine'] } }, RESULT)).toHaveProperty('problems');
	});
});

describe('checkTaskYaml', () => {
	const task = () =>
		JSON.parse(
			JSON.stringify({
				name: 'T',
				context: 'Fine',
				environment_type: 'mcq',
				problems: { q: { type: 'match', header: 'H', answer: 'a' } }
			})
		);

	it('accepts a valid task and reports invalid ones', () => {
		useServices({ config: { tasksDirectory: TASKS_DIR } as never });
		expect(checkTaskYaml(course.courseid, 'mcq', task())).toBeNull();
		expect(checkTaskYaml(course.courseid, 'mcq', { ...task(), problems: { q: { type: 'nope' } } })).toBe(
			'Invalid type for problem q'
		);
		expect(checkTaskYaml(course.courseid, 'mcq', { ...task(), context: 'Bad :unknownrole:`x`' })).toBe(
			'Parsing failed: context'
		);
		const t = task();
		t.problems.q.header = '.. nosuchdirective::';
		expect(checkTaskYaml(course.courseid, 'mcq', t)).toBe('Parsing failed: q');
		expect(checkTaskYaml('no_such_course', 'mcq', task())).toMatch(/cannot be loaded/);
	});
});

describe('main', () => {
	it('regrades the recorded submissions through the backend: all consistent', async () => {
		// Ignored entries: a file, a folder without task.yaml, hidden files and folders in test/.
		writeFileSync(join(course.dir, 'README'), 'x');
		mkdirSync(join(course.dir, 'notask'), { recursive: true });
		mkdirSync(join(course.dir, 'mcq', 'test', 'sub'), { recursive: true });
		writeFileSync(join(course.dir, 'mcq', 'test', '.hidden'), 'x');
		expect(await autotest(TASKS_DIR, course.dir, '--logging', '--tdisp', 'a.B', '--ptype', 'custom_type')).toBe(0);
		expect(out).toEqual([`\nAll yaml files in ${course.dir} directory are consistent with the tests\n`]);
		expect(err).toEqual([
			`Testing ${join(course.dir, 'mcq', 'test', 'failed.test')}`,
			`Testing ${join(course.dir, 'mcq', 'test', 'success.test')}`
		]);
	});

	it('prints (or writes with -f) the differences and the invalid tasks as JSON, exit code 66', async () => {
		const path = join(course.dir, 'mcq', 'test', 'success.test');
		const original = readFileSync(path, 'utf8');
		writeFileSync(path, original.replace('grade: 100.0', 'grade: 42.0'));
		const taskYaml = join(course.dir, 'ignored', 'task.yaml');
		const originalTask = readFileSync(taskYaml, 'utf8');
		writeFileSync(taskYaml, 'name: Broken\nenvironment_type: mcq\nproblems: {q: {type: nope}}\n');
		try {
			expect(await autotest(TASKS_DIR, course.dir)).toBe(66);
			const expected = {
				[path]: { grade: [42, 100] },
				[taskYaml]: { name: 'Broken', environment_type: 'mcq', problems: { q: { type: 'nope' } } }
			};
			expect(JSON.parse(out[0])).toEqual(expected);
			expect(err).toEqual([
				`${taskYaml}: WEB TASK ERROR: Invalid type for problem q`,
				'\nAn error has occured: Testing of course failed\n'
			]);
			const file = join(course.dir, 'out.json');
			expect(await autotest(TASKS_DIR, course.dir, '-f', file)).toBe(66);
			expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(expected);
			expect(out).toEqual([]);
		} finally {
			writeFileSync(path, original);
			writeFileSync(taskYaml, originalTask);
		}
	});

	it('fails (66) when the backend does not offer the task environment', async () => {
		const wait = timing.environmentsMs;
		timing.environmentsMs = 200;
		try {
			expect(await autotest(TASKS_DIR, course.dir, '-b', 'tcp://127.0.0.1:1')).toBe(66);
			expect(err).toEqual(['\nAn error has occured: Environment not available\n']);
		} finally {
			timing.environmentsMs = wait;
		}
	});

	it('rejects invalid command lines', async () => {
		await expect(autotest(TASKS_DIR)).rejects.toMatchObject({ code: 2 });
	});
});
