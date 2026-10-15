/**
 * Tests of the shared helpers of the command-line tools (option parsing,
 * entry point, colors, polling, environment check).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '#lib/server/backend/client.js';
import type { Task } from '#lib/server/courses/task.js';
import { color, Exit, hasEnvironment, parseArgs, run, timing, waitFor, type OptionSpec } from './common.js';

const SPEC: OptionSpec = {
	flag: { kind: 'flag', short: 'v' },
	file: { kind: 'value', short: 'f' },
	list: { kind: 'list', short: 'p' }
};
const USAGE = 'usage: cmd [-v] pos\n\ndetails';

afterEach(() => vi.restoreAllMocks());

describe('parseArgs', () => {
	it('parses flags, values, lists and positionals like argparse', () => {
		expect(parseArgs(['a', '-v', '--file', 'x', '-p', 'b', 'c', '-f=y', 'd', '-'], SPEC, USAGE, ['pos'])).toEqual({
			opts: { flag: true, file: 'y', list: ['b', 'c'] },
			args: ['a', 'd', '-']
		});
		expect(parseArgs(['--list=a', 'b', '--file=k=v', '--list'], SPEC, USAGE, []).opts).toEqual({
			list: [],
			file: 'k=v'
		});
	});

	it('throws Exit(0) with the help text for -h/--help', () => {
		for (const flag of ['-h', '--help']) expect(() => parseArgs([flag], SPEC, USAGE, [])).toThrow(USAGE);
	});

	it('throws Exit(2) with the usage line for invalid command lines', () => {
		const error = (argv: string[]) => {
			try {
				parseArgs(argv, SPEC, USAGE, ['pos']);
			} catch (e) {
				return [(e as Exit).code, (e as Exit).message];
			}
		};
		expect(error(['--nope', 'a'])).toEqual([2, 'usage: cmd [-v] pos\nerror: unrecognized arguments: --nope']);
		expect(error(['-x', 'a'])).toEqual([2, 'usage: cmd [-v] pos\nerror: unrecognized arguments: -x']);
		expect(error(['a', '-f'])).toEqual([2, 'usage: cmd [-v] pos\nerror: argument -f: expected one argument']);
		expect(error([])).toEqual([2, 'usage: cmd [-v] pos\nerror: the following arguments are required: pos']);
	});
});

describe('run', () => {
	it('returns the exit code of the command', async () => {
		expect(await run(async (argv) => argv.length, ['a', 'b'])).toBe(2);
	});

	it('prints Exit messages (help on stdout, errors on stderr) and other errors', async () => {
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await run(() => Promise.reject(new Exit(0, 'help')), [])).toBe(0);
		expect(out).toHaveBeenCalledWith('help');
		expect(await run(() => Promise.reject(new Exit(2, 'usage')), [])).toBe(2);
		expect(err).toHaveBeenCalledWith('usage');
		expect(await run(() => Promise.reject(new Error('boom')), [])).toBe(1);
		expect(err).toHaveBeenCalledWith('error: boom');
	});
});

describe('helpers', () => {
	it('colors text with ANSI codes', () => {
		expect(color(31, 'x')).toBe('\x1b[31;1mx\x1b[0m');
	});

	it('waits for a condition at most the given time', async () => {
		let n = 0;
		expect(await waitFor(() => ++n > 2, 1000)).toBe(true);
		const start = Date.now();
		expect(await waitFor(() => false, timing.pollMs)).toBe(false);
		expect(Date.now() - start).toBeGreaterThanOrEqual(timing.pollMs - 5);
	});

	it('checks that the backend offers the environment of a task', () => {
		const client = { environments: { mcq: ['mcq'] } } as unknown as BackendClient;
		expect(hasEnvironment(client, { environmentType: 'mcq', environmentId: 'mcq' } as Task)).toBe(true);
		expect(hasEnvironment(client, { environmentType: 'mcq', environmentId: 'x' } as Task)).toBe(false);
		expect(hasEnvironment(client, { environmentType: 'docker', environmentId: 'mcq' } as Task)).toBe(false);
	});
});
