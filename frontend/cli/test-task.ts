/**
 * inginious-test-task: port of legacy/inginious/scripts/task_tester/task_tester.py
 * (docs/cli.md). Replays the recorded submissions (`<task>/test/*.test`) of the
 * tasks of a course through the backend of the instance and checks that the
 * global result and the test tags are unchanged. A task with a `.testignore`
 * file is skipped. Exit code 1 when a test failed, else 0.
 *
 * The legacy companion `inginious-submission-anonymizer` only depends on
 * `inginious.common` (kept with the backend), so it is not ported.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { BackendClient, JobResult } from '#lib/server/backend/client.js';
import { loadConfig } from '#lib/server/config.js';
import { courseTaskIds, getCourse, type Course } from '#lib/server/courses/course.js';
import { coursePath, parseYaml } from '#lib/server/courses/files.js';
import { registerProblemType } from '#lib/server/courses/problems.js';
import { getTask } from '#lib/server/courses/task.js';
import { color, connectBackend, parseArgs, run, runJob, timing, useServices, waitFor } from './common.js';

const USAGE = `usage: inginious-test-task [-h] [-c CONFIG] [-v] [-p [PLUGINS ...]] courseid [taskids ...]

Replay submissions of a given course to ensure that its task's grading processes are consistent over time.

positional arguments:
  courseid              Course ID of the course to test.
  taskids               Task ID(s) of the task to test.

options:
  -h, --help            show this help message and exit
  -c, --config CONFIG   Path towards the INGInious instance configuration file.
  -v, --verbose         Display more output
  -p, --plugins [PLUGINS ...]
                        Additional problem types (type names) required to replay the course's tasks.`;

/** Legacy TaskTesterLogger: every message on stdout, colored by level. */
const log = {
	info: (msg: string) => console.log(color(34, msg)),
	success: (msg: string) => console.log(color(32, msg)),
	warning: (msg: string) => console.log(color(33, msg)),
	error: (msg: string) => console.log(color(31, msg))
};

/** Python-like `str()` of a value in messages. */
const str = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

/** Output lines prefixed with a tab, without the last line break (legacy verbose output). */
export const indent = (text: string) => text.replace(/\n$/, '').replace(/^/gm, '\t');

/**
 * Compares a recorded submission with the result of its replay (legacy
 * `job_done_callback`): the global result and every recorded test tag.
 * @returns the error messages (empty when the replay matches).
 */
export function checkResult(data: Record<string, unknown>, result: JobResult): string[] {
	const errors: string[] = [];
	if (data.result && data.result !== result.result[0])
		errors.push("-> Result doesn't match.", `\tExpected <${str(data.result)}>\n\tGot <${result.result[0]}>`);
	for (const [tag, value] of Object.entries((data.tests as Record<string, unknown> | null) ?? {})) {
		if (!(tag in result.tests)) errors.push(`-> No test result with tag <${tag}> given`, `\tExpected <${str(value)}>`);
		else if (!isDeepStrictEqual(value, result.tests[tag]))
			errors.push("-> Tag values doesn't match.", `\t Expected <${str(value)}>\n\tGot <${str(result.tests[tag])}>`);
	}
	return errors;
}

/**
 * Replays the recorded submissions of a task (legacy `test_task`).
 * @returns the paths of the failed submissions and the number of replayed ones.
 */
export async function testTask(
	course: Course,
	taskid: string,
	client: BackendClient,
	verbose: boolean
): Promise<{ failed: string[]; done: number }> {
	log.info(`-> Re-running submissions for task <${taskid}>`);
	const task = getTask(course, taskid);
	const dir = coursePath(course.id, taskid, 'test');
	const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.test')) : [];
	const failed: string[] = [];
	for (const [i, name] of files.sort().entries()) {
		const path = join(dir, name);
		const data = parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown>;
		const result = await runJob(client, task, data.input as Record<string, unknown>, true, 'Task tester');
		log.info(`-- [${i + 1}/${files.length}] Testing input file <${path}>`);
		if (verbose) {
			console.log('\x1b[1m-> Complete standard output : \x1b[0m');
			if (result.stdout) console.log(indent(result.stdout));
		}
		const errors = checkResult(data, result);
		errors.forEach(log.error);
		if (errors.length) failed.push(path);
		else log.success('--> All tests passed');
	}
	if (failed.length)
		log.error(`${failed.length}/${files.length} tests failed\n${failed.map((f) => `- ${f}`).join('\n')}`);
	else if (files.length) log.success('-> All the previous submissions passed.');
	else log.warning('No test submission found.');
	return { failed, done: files.length };
}

/** Command entry point. @returns the exit code (0 success, 1 failed test or error, 2 bad usage). */
export async function main(argv: string[]): Promise<number> {
	const { opts, args } = parseArgs(
		argv,
		{
			config: { kind: 'value', short: 'c' },
			verbose: { kind: 'flag', short: 'v' },
			plugins: { kind: 'list', short: 'p' }
		},
		USAGE,
		['courseid']
	);
	const [courseid, ...taskids] = args;
	log.info('Hello from the task tester utility!');
	const path = (opts.config as string) || ['./configuration.yaml', './configuration.json'].find((f) => existsSync(f));
	if (!path) throw new Error('No configuration file found');
	const config = loadConfig(path);
	for (const type of (opts.plugins as string[] | undefined) ?? []) registerProblemType(type);
	useServices({ config });
	const client = connectBackend(config.backend);
	const ignored: string[] = [];
	const failed: string[] = [];
	let [done, considered] = [0, 0];
	try {
		console.log('\x1b[1mWaiting for containers loading\x1b[0m');
		await waitFor(() => Object.keys(client.environments).length > 0, timing.environmentsMs);
		const course = getCourse(courseid);
		const all = courseTaskIds(course);
		for (const taskid of taskids.length ? taskids.filter((id) => all.includes(id)) : all) {
			if (existsSync(coursePath(courseid, taskid, '.testignore'))) {
				log.warning(`-> Task <${taskid}> explicitely ignored`);
				ignored.push(taskid);
			} else {
				const r = await testTask(course, taskid, client, Boolean(opts.verbose));
				failed.push(...r.failed);
				done += r.done;
			}
			console.log();
			considered++;
		}
	} finally {
		client.close();
	}
	log.warning('### Tests Summary ###');
	log.warning(`> ${considered} tasks considered`);
	if (ignored.length) log.warning(`> ${ignored.length} tasks ignored\n${ignored.map((i) => `- ${i}`).join('\n')}`);
	if (failed.length) {
		log.error(`> ${failed.length} tests failed in ${considered} tasks`);
		return 1;
	}
	if (done) log.success('--> All the previous submissions of the tested tasks passed');
	else log.warning(`--> No test submission found for course <${courseid}>`);
	return 0;
}

/* v8 ignore next -- executed only when run as a command */
if (import.meta.main) process.exitCode = await run(main, process.argv.slice(2));
