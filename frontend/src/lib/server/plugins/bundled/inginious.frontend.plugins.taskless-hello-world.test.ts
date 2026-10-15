/** Unit tests of the taskless-hello-world plugin and its page (SITE-21), with a fake backend. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { siteEnv, event, user, type SiteEnv } from '../../../../../tests/site/env.js';
import { resetPlugins } from '../index.js';
import * as plugin from './inginious.frontend.plugins.taskless-hello-world.js';
import { actions, load } from '../../../../routes/taskless_hello_world/+page.server.js';

let env: SiteEnv;
const killJob = vi.fn();
type Done = { onDone: (r: { result: [string, string] }) => void };

beforeAll(async () => {
	env = await siteEnv();
	Object.assign(env.backend, { killJob });
});
afterAll(() => env.cleanup());

/** Status of a thrown HTTP error (200 when nothing is thrown). */
const status = async (fn: () => unknown) => {
	try {
		await fn();
		return 200;
	} catch (e) {
		return isHttpError(e) ? e.status : -1;
	}
};

describe('SITE-21 taskless-hello-world', () => {
	it('runs a course-less job with the defaults and returns its global result', async () => {
		env.backend.newJob.mockImplementationOnce((_job: unknown, cb: Done) => {
			setTimeout(() => cb.onDone({ result: ['success', 'Hello World! I am Bob'] }));
			return 'job-1';
		});
		expect(await plugin.helloWorld('Bob')).toEqual(['success', 'Hello World! I am Bob']);
		expect(env.backend.newJob.mock.lastCall![0]).toEqual({
			priority: 0,
			courseId: null,
			taskId: null,
			problems: {},
			input: { hello_world_name: 'Bob' },
			environmentType: 'docker',
			environment: 'taskless-hello-world',
			environmentParameters: {},
			debug: false,
			launcher: 'Plugin - taskless Hello World'
		});
	});

	it('uses the configured environment, reports backend errors and kills late jobs', async () => {
		plugin.init(resetPlugins(), {
			plugin_module: plugin.MODULE,
			environment_type: 'docker',
			environment: 'default',
			run_cmd: 'run.sh',
			timeout: 0.01
		});
		env.backend.newJob.mockImplementationOnce((_job: unknown, cb: Done) => {
			cb.onDone({ result: ['crash', 'Backend unavailable, retry later'] });
			return null;
		});
		expect(await plugin.helloWorld('x')).toEqual(['crash', 'Backend unavailable, retry later']);
		expect(env.backend.newJob.mock.lastCall![0]).toMatchObject({
			environment: 'default',
			environmentParameters: { run_cmd: 'run.sh' }
		});
		env.backend.newJob.mockImplementationOnce(() => 'job-2');
		expect(await plugin.helloWorld('x')).toEqual(['timeout', 'The job did not end in time.']);
		expect(killJob).toHaveBeenCalledWith('job-2');
	});

	it('serves the page to superadmins only, when the plugin is enabled', async () => {
		const page = (username: string, superadmin = false, body?: BodyInit) =>
			event('/taskless_hello_world', { user: user(username, superadmin), method: body ? 'POST' : 'GET', body });
		expect(await status(() => load(page('root', true) as never))).toBe(404);
		const registry = resetPlugins();
		await registry.load([{ plugin_module: plugin.MODULE }], { [plugin.MODULE]: async () => plugin });
		expect(await status(() => load(page('alice') as never))).toBe(403);
		expect(await status(() => load(page('root', true) as never))).toBe(200);
		env.backend.newJob.mockImplementationOnce((_job: unknown, cb: Done) => {
			cb.onDone({ result: ['success', 'Hello World! I am <b>'] });
			return 'job-3';
		});
		const form = new URLSearchParams({ name: '<b>' });
		expect(await actions.default(page('root', true, form) as never)).toEqual({
			result: 'success',
			feedback: 'Hello World! I am <b>'
		});
		expect(await status(() => actions.default(page('alice', false, form) as never))).toBe(403);
	});
});
