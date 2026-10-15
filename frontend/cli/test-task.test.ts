/**
 * Tests of inginious-test-task: result comparison and whole runs replaying the
 * recorded submissions of the cli fixture course through the real backend of
 * the Colima stack (mcq agent).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { JobResult } from '#lib/server/backend/client.js';
import { timing } from './common.js';
import { checkResult, indent, main } from './test-task.js';
import { installCliCourse, TASKS_DIR, type InstalledCourse } from './testing/fixture.js';

const RESULT = { result: ['failed', ''], tests: { a: 1, b: [1, 2] } } as unknown as JobResult;

let course: InstalledCourse;
let tmp: string;
let config: string;
let out: string[];

beforeAll(() => {
	course = installCliCourse('testtask');
	tmp = mkdtempSync(join(tmpdir(), 'cli-test-task-'));
	config = join(tmp, 'configuration.yaml');
	writeFileSync(
		config,
		`backend: tcp://127.0.0.1:2000\ntasks_directory: ${TASKS_DIR}\nsession_parameters: {secret_key: k}\n`
	);
});
afterAll(() => {
	course.remove();
	rmSync(tmp, { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());

/** Runs the command, capturing stdout without ANSI codes. */
async function testTask(...argv: string[]): Promise<number> {
	out = [];
	vi.spyOn(console, 'log').mockImplementation((m = '') => void out.push(stripVTControlCharacters(String(m))));
	return main(argv);
}

describe('checkResult', () => {
	it('accepts matching results and ignores unrecorded fields', () => {
		expect(checkResult({ result: 'failed', tests: { a: 1, b: [1, 2] } }, RESULT)).toEqual([]);
		expect(checkResult({ result: '', tests: null }, RESULT)).toEqual([]);
	});

	it('reports a different result, missing and different tags', () => {
		expect(checkResult({ result: 'success', tests: { a: 2, c: true, d: 'x' } }, RESULT)).toEqual([
			"-> Result doesn't match.",
			'\tExpected <success>\n\tGot <failed>',
			"-> Tag values doesn't match.",
			'\t Expected <2>\n\tGot <1>',
			'-> No test result with tag <c> given',
			'\tExpected <true>',
			'-> No test result with tag <d> given',
			'\tExpected <x>'
		]);
	});
});

describe('indent', () => {
	it('indents the lines of the container output', () => {
		expect(indent('line1\nline2\n')).toBe('\tline1\n\tline2');
	});
});

describe('main', () => {
	it('replays every task of the course (verbose), skipping .testignore tasks', async () => {
		expect(await testTask('-c', config, '-v', course.courseid, '-p', 'custom_type')).toBe(0);
		const test = (name: string) => join(course.dir, 'mcq', 'test', name);
		expect(out).toEqual([
			'Hello from the task tester utility!',
			'Waiting for containers loading',
			'-> Task <ignored> explicitely ignored',
			'',
			'-> Re-running submissions for task <mcq>',
			`-- [1/2] Testing input file <${test('failed.test')}>`,
			'-> Complete standard output : ',
			'--> All tests passed',
			`-- [2/2] Testing input file <${test('success.test')}>`,
			'-> Complete standard output : ',
			'--> All tests passed',
			'-> All the previous submissions passed.',
			'',
			'### Tests Summary ###',
			'> 2 tasks considered',
			'> 1 tasks ignored\n- ignored',
			'--> All the previous submissions of the tested tasks passed'
		]);
	});

	it('reports failed replays with exit code 1', async () => {
		const path = join(course.dir, 'mcq', 'test', 'success.test');
		const original = readFileSync(path, 'utf8');
		writeFileSync(path, original.replace('result: success', 'result: failed'));
		try {
			expect(await testTask('--config', config, course.courseid, 'mcq')).toBe(1);
			expect(out).toContain("-> Result doesn't match.");
			expect(out).toContain(`1/2 tests failed\n- ${path}`);
			expect(out.at(-1)).toBe('> 1 tests failed in 1 tasks');
		} finally {
			writeFileSync(path, original);
		}
	});

	it('warns when no submission was replayed (unknown tasks are skipped)', async () => {
		rmSync(join(course.dir, 'ignored', '.testignore'));
		try {
			expect(await testTask('-c', config, course.courseid, 'ignored', 'nosuchtask')).toBe(0);
			expect(out).toContain('No test submission found.');
			expect(out.at(-1)).toBe(`--> No test submission found for course <${course.courseid}>`);
			expect(out).toContain('> 1 tasks considered');
		} finally {
			writeFileSync(join(course.dir, 'ignored', '.testignore'), '');
		}
	});

	it('finds ./configuration.yaml (or .json) by default, and fails without any', async () => {
		const cwd = process.cwd();
		process.chdir(tmp);
		const wait = timing.environmentsMs;
		timing.environmentsMs = 0;
		try {
			// The course does not exist: the error ends the command (run() prints it, exit code 1).
			await expect(testTask('nosuchcourse')).rejects.toThrow(/nosuchcourse cannot be loaded/);
			rmSync(config);
			await expect(testTask('nosuchcourse')).rejects.toThrow('No configuration file found');
		} finally {
			process.chdir(cwd);
			timing.environmentsMs = wait;
		}
	});

	it('rejects invalid command lines', async () => {
		await expect(testTask()).rejects.toMatchObject({ code: 2 });
	});
});
