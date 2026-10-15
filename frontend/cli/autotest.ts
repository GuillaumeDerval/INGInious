/**
 * inginious-autotest: port of legacy/inginious/scripts/autotest.py (docs/cli.md).
 *
 * For every task of a course folder: re-grades each recorded submission of its
 * `test/` folder (YAML files: `courseid`, `taskid`, `input` and the expected
 * `result`, `grade`, `problems`, `tests`, `custom`, `state`, `stdout`, `stderr`)
 * through the backend and compares the outputs; checks that `task.yaml` loads
 * and that its texts (context, problem headers) render without RST warning.
 * Differences are printed (or written with `-f`) as JSON, exit code 66;
 * 0 when everything is consistent.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Services } from '#lib/server/app.js';
import type { BackendClient, JobResult } from '#lib/server/backend/client.js';
import { getCourse } from '#lib/server/courses/course.js';
import { parseYaml } from '#lib/server/courses/files.js';
import { registerProblemType } from '#lib/server/courses/problems.js';
import { buildTask, getTask } from '#lib/server/courses/task.js';
import { renderText } from '#lib/server/text/index.js';
import { connectBackend, hasEnvironment, parseArgs, run, runJob, timing, useServices, waitFor } from './common.js';

const USAGE = `usage: inginious-autotest [-h] [--logging] [-f FILE] [-b BACKEND] [--tdisp TDISP [TDISP ...]]
                          [--ptype PTYPE [PTYPE ...]] task_dir course_dir

Test the correctness of results contained in yaml files

positional arguments:
  task_dir              Courses directory
  course_dir            Repository for the course to test

options:
  -h, --help            show this help message and exit
  --logging, -l         enables logging
  -f, --file FILE       Store in the specified file in a json format
  -b, --backend BACKEND Address of the backend (default: tcp://127.0.0.1:2000)
  --tdisp TDISP [TDISP ...]
                        Ignored (task dispensers are built in)
  --ptype PTYPE [PTYPE ...]
                        Additional subproblem types (type names, graded by the agents)`;

/** Compared output keys, in the legacy order. */
const KEYS = ['result', 'grade', 'problems', 'tests', 'custom', 'state', 'archive', 'stdout', 'stderr'] as const;

/** Differences of one file: key -> [expected (recorded), actual (new)]. */
export type Differences = Record<string, [unknown, unknown]>;

/** Legacy `problems_compare`: some recorded problem has another result or feedback (or is missing). */
function problemsDiffer(expected: unknown, actual: Record<string, unknown>): boolean {
	return Object.entries(expected as Record<string, unknown>).some(([id, e]) => {
		const a = actual[id] as unknown[] | undefined;
		return !Array.isArray(e) || !a || e[0] !== a[0] || e[1] !== a[1];
	});
}

/**
 * Compares a recorded submission with its new result (legacy `compare_all_outputs`):
 * keys missing on either side are skipped, archives always match, `result` is
 * the recorded status against the new (status, feedback) pair.
 */
export function compareOutputs(recorded: Record<string, unknown>, result: JobResult): Differences {
	const out: Differences = {};
	for (const key of KEYS) {
		const [expected, actual] = [recorded[key], result[key]];
		if (expected == null || actual == null || key === 'archive') continue;
		const differs =
			key === 'result'
				? expected !== result.result[0]
				: key === 'problems'
					? problemsDiffer(expected, result.problems)
					: !isDeepStrictEqual(expected, actual);
		if (differs) out[key] = [expected, actual];
	}
	return out;
}

/** True when a rendered text is the "Parsing failed" fallback or contains a docutils system message. */
const parseFailed = (text: unknown) => /<b>Parsing failed<\/b>|class="system-message"/.test(renderText(text));

/**
 * Checks a task.yaml (legacy `test_web_task`): the task loads and its texts render
 * without warning (legacy: docutils `halt_level` 2).
 * @returns the error message, or null.
 */
export function checkTaskYaml(courseid: string, taskid: string, data: Record<string, unknown>): string | null {
	try {
		const task = buildTask(getCourse(courseid), taskid, data);
		if (parseFailed(task.context)) throw new Error('Parsing failed: context');
		for (const p of task.problems) if (parseFailed(p.content.header)) throw new Error(`Parsing failed: ${p.id}`);
		return null;
	} catch (e) {
		return (e as Error).message;
	}
}

/**
 * Re-grades one recorded submission (legacy `test_task`).
 * @throws Error('Environment not available') when the backend does not offer the task environment.
 */
export async function testSubmission(client: BackendClient, path: string): Promise<Differences> {
	const data = parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown>;
	const task = getTask(getCourse(String(data.courseid)), String(data.taskid));
	if (!(await waitFor(() => hasEnvironment(client, task), timing.environmentsMs)))
		throw new Error('Environment not available');
	return compareOutputs(data, await runJob(client, task, data.input as Record<string, unknown>, false, 'autotest'));
}

/**
 * Tests every task folder of a course (legacy `test_all_files`).
 * @returns the failures: path -> differences (submission files) or task.yaml content (invalid tasks).
 */
export async function testCourse(courseDir: string, client: BackendClient, log: boolean): Promise<object> {
	const output: Record<string, unknown> = {};
	const courseid = basename(courseDir);
	for (const entry of readdirSync(courseDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		const dir = join(courseDir, entry.name);
		const names = entry.isDirectory() ? readdirSync(dir) : [];
		if (!names.includes('task.yaml')) continue;
		if (names.includes('test'))
			for (const name of readdirSync(join(dir, 'test')).sort()) {
				const path = join(dir, 'test', name);
				if (name.startsWith('.') || !statSync(path).isFile()) continue;
				if (log) console.error(`Testing ${path}`);
				const diff = await testSubmission(client, path);
				if (Object.keys(diff).length) output[path] = diff;
			}
		const path = join(dir, 'task.yaml');
		const data = parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown>;
		const error = checkTaskYaml(courseid, entry.name, data);
		if (error) {
			console.error(`${path}: WEB TASK ERROR: ${error}`);
			output[path] = data;
		}
	}
	return output;
}

/** Command entry point. @returns the exit code (0 consistent, 66 failure or error, 2 bad usage). */
export async function main(argv: string[]): Promise<number> {
	const { opts, args } = parseArgs(
		argv,
		{
			logging: { kind: 'flag', short: 'l' },
			file: { kind: 'value', short: 'f' },
			backend: { kind: 'value', short: 'b' },
			tdisp: { kind: 'list' },
			ptype: { kind: 'list' }
		},
		USAGE,
		['task_dir', 'course_dir']
	);
	const [taskDir, courseDir] = args;
	// Problem types unknown to the frontend are only displayed: register them as generic ones.
	for (const type of (opts.ptype as string[] | undefined) ?? []) registerProblemType(type);
	useServices({ config: { tasksDirectory: taskDir } as Services['config'] });
	const client = connectBackend((opts.backend as string | undefined) ?? 'tcp://127.0.0.1:2000');
	try {
		const output = await testCourse(courseDir, client, Boolean(opts.logging));
		if (Object.keys(output).length) {
			const json = JSON.stringify(output);
			if (opts.file) writeFileSync(opts.file as string, json);
			else console.log(`\n${json}\n`);
			throw new Error('Testing of course failed');
		}
	} catch (e) {
		console.error(`\nAn error has occured: ${(e as Error).message}\n`);
		return 66;
	} finally {
		client.close();
	}
	console.log(`\nAll yaml files in ${courseDir} directory are consistent with the tests\n`);
	return 0;
}

/* v8 ignore next -- executed only when run as a command */
if (import.meta.main) process.exitCode = await run(main, process.argv.slice(2));
