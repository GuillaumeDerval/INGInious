/**
 * Shared helpers of the command-line tools (inginious-autotest, inginious-test-task,
 * inginious-setup; docs/cli.md): argparse-like option parsing, colored output,
 * process entry point, and the backend link used to replay submissions.
 *
 * The tools reuse the server modules of the web app: the course/task model reads
 * `tasks_directory` from the process-wide services (`#lib/server/app.js`), which a
 * tool installs with `useServices` instead of starting the whole web server.
 */
import { Dealer } from 'zeromq';
import { setServices, type Services } from '#lib/server/app.js';
import { BackendClient, type DealerLike, type JobResult } from '#lib/server/backend/client.js';
import type { Task } from '#lib/server/courses/task.js';

/** Kind of a command-line option: boolean flag, one value, or every following value (argparse nargs="*"). */
export type OptionKind = 'flag' | 'value' | 'list';

/** Declaration of the options of a command: long name -> kind and optional one-letter alias. */
export type OptionSpec = Record<string, { kind: OptionKind; short?: string }>;

/** Parsed command line: option values by long name, and the positional arguments. */
export interface ParsedArgs {
	opts: Record<string, string | boolean | string[] | undefined>;
	args: string[];
}

/** Ends a command with an exit code and a message (help: stdout, code 0; usage errors: stderr, code 2). */
export class Exit extends Error {
	constructor(
		readonly code: number,
		message: string
	) {
		super(message);
	}
}

/**
 * Parses the command line like Python's argparse (which the legacy tools used):
 * `--name value`, `--name=value`, `-x value`, list options consuming every
 * following non-option argument, `-h`/`--help`.
 * @param usage help text, printed by `--help`; its first paragraph (the usage line) is printed before errors.
 * @param positionals names of the mandatory positional arguments.
 * @throws Exit(0) for --help, Exit(2) for an invalid command line.
 */
export function parseArgs(argv: string[], spec: OptionSpec, usage: string, positionals: string[]): ParsedArgs {
	const opts: ParsedArgs['opts'] = {};
	const args: string[] = [];
	const fail = (message: string) => new Exit(2, `${usage.split('\n\n')[0]}\nerror: ${message}`);
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '-h' || arg === '--help') throw new Exit(0, usage);
		if (!arg.startsWith('-') || arg === '-') {
			args.push(arg);
			continue;
		}
		const [flag, inline] = arg.split(/=(.*)/s);
		const name = flag.startsWith('--') ? flag.slice(2) : Object.keys(spec).find((n) => spec[n].short === flag.slice(1));
		const option = name === undefined ? undefined : spec[name];
		if (!option) throw fail(`unrecognized arguments: ${arg}`);
		if (option.kind === 'flag') opts[name!] = true;
		else if (option.kind === 'value') {
			const value = inline ?? argv[++i];
			if (value === undefined) throw fail(`argument ${flag}: expected one argument`);
			opts[name!] = value;
		} else {
			const values: string[] = inline === undefined ? [] : [inline];
			while (i + 1 < argv.length && !argv[i + 1].startsWith('-')) values.push(argv[++i]);
			opts[name!] = values;
		}
	}
	const missing = positionals.slice(args.length);
	if (missing.length) throw fail(`the following arguments are required: ${missing.join(', ')}`);
	return { opts, args };
}

/**
 * Runs a command: returns its exit code, printing the message of an `Exit` and,
 * for any other error, `error: <message>` with exit code 1.
 */
export async function run(main: (argv: string[]) => Promise<number>, argv: string[]): Promise<number> {
	try {
		return await main(argv);
	} catch (e) {
		if (e instanceof Exit) {
			(e.code ? console.error : console.log)(e.message);
			return e.code;
		}
		console.error(`error: ${(e as Error).message}`);
		return 1;
	}
}

/** Bold ANSI-colored text (`code`: 31 red, 32 green, 33 yellow, 34 blue), as printed by the legacy tools. */
export const color = (code: number, text: string): string => `\x1b[${code};1m${text}\x1b[0m`;

/** Installs the (partial) services used by the reused server modules (e.g. `config.tasksDirectory`). */
export function useServices(services: Partial<Services>): void {
	setServices(services as Services);
}

/**
 * Waiting delays, in milliseconds (shortened by the tests): polling period, maximum wait
 * for the environments announced by the backend after connection (legacy test-task: 15 s)
 * and for the selection of a MongoDB server.
 */
export const timing = { pollMs: 100, environmentsMs: 15_000, mongoMs: 5000 };

/** Polls `condition` until it holds or `timeoutMs` elapsed. @returns its final value. */
export async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
	for (let waited = 0; !condition() && waited < timeoutMs; waited += timing.pollMs)
		await new Promise((resolve) => setTimeout(resolve, timing.pollMs));
	return condition();
}

/** Connects a backend client (ZeroMQ DEALER) to `address`, e.g. tcp://127.0.0.1:2000; close it when done. */
export function connectBackend(address: string): BackendClient {
	const client = new BackendClient(address, {
		name: 'inginious-cli',
		socketFactory: () => new Dealer({ ipv6: true, linger: 0 }) as unknown as DealerLike
	});
	client.start();
	return client;
}

/** True when the backend offers the environment of the task. */
export function hasEnvironment(client: BackendClient, task: Task): boolean {
	return client.environments[task.environmentType]?.includes(task.environmentId) ?? false;
}

/**
 * Grades an input with the task (priority 0, like the legacy `ClientSync.new_job`).
 * @param debug true to get the standard output/error of the grading container.
 * @returns the job result ("crash" when the environment is unavailable or the backend lost).
 */
export function runJob(
	client: BackendClient,
	task: Task,
	input: Record<string, unknown>,
	debug: boolean,
	launcher: string
): Promise<JobResult> {
	return new Promise((onDone) =>
		client.newJob(
			{
				priority: 0,
				courseId: task.courseId,
				taskId: task.id,
				problems: task.content.problems as Record<string, unknown>,
				input,
				environmentType: task.environmentType,
				environment: task.environmentId,
				environmentParameters: task.environmentParameters,
				debug,
				launcher
			},
			{ onDone }
		)
	);
}
