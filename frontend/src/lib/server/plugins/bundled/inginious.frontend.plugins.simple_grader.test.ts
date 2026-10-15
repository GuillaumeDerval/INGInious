import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { siteEnv, MCQ_TASK, type SiteEnv } from '../../../../../tests/site/env.js';
import { PluginRegistry } from '../index.js';
import * as grader from './inginious.frontend.plugins.simple_grader.js';

let env: SiteEnv;
const RESULT = {
	result: ['success', 'Well done'],
	grade: 100,
	problems: { q: ['success', ''] },
	tests: {},
	custom: {},
	state: '',
	archive: null,
	stdout: 'out',
	stderr: ''
};
const form = (fields: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.append(k, v);
	return f;
};

beforeAll(async () => {
	env = await siteEnv();
	env.course('external', { name: 'External' }, { hello: MCQ_TASK });
});
afterAll(() => env.cleanup());

describe('SITE-18 simple_grader plugin', () => {
	it('is disabled without api_key', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		grader.init(new PluginRegistry(), { plugin_module: 'x' });
		expect([grader.graderEnabled(), grader.validKey('')]).toEqual([false, false]);
		expect(warn).toHaveBeenCalled();
	});
	it('checks the shared secret', () => {
		grader.init(new PluginRegistry(), {
			plugin_module: 'x',
			api_key: 's3cret',
			return_fields: '^(result|text|grade)$'
		});
		expect([grader.validKey('s3cret'), grader.validKey('nope'), grader.validKey(undefined)]).toEqual([
			true,
			false,
			false
		]);
	});
	it('reports request errors', async () => {
		const call = (f: Record<string, string>) => grader.handleGrader(form(f));
		expect(await call({})).toEqual({ status: 'error', status_message: 'Unknown request type' });
		expect(await call({ taskid: 'hello', input: '{' })).toMatchObject({ status_message: 'Cannot decode input' });
		expect(await call({ taskid: '../x', input: '{}' })).toMatchObject({ status_message: 'Cannot open task' });
		expect(await call({ taskid: 'hello', input: '{"q":"yes","c":"7"}' })).toMatchObject({
			status_message: 'Input is not consistent with the task'
		});
		expect(await call({ jobid: 'zz' })).toMatchObject({ status_message: 'There is no job with jobid zz' });
	});
	it('grades synchronously and asynchronously, filtering the fields', async () => {
		env.backend.newJob.mockImplementation((_job, cb: { onDone: (r: unknown) => void }) => cb.onDone(RESULT));
		expect(await grader.handleGrader(form({ taskid: 'hello', input: '{"q":"yes","c":["0"],"@lang":"fr"}' }))).toEqual({
			status: 'done',
			result: 'success',
			text: 'Well done',
			grade: 100
		});
		expect(env.backend.newJob.mock.calls[0][0]).toMatchObject({
			courseId: 'external',
			taskId: 'hello',
			launcher: 'Plugin - Simple Grader',
			// The key holder provides the whole input, `@`-fields included.
			input: { q: 'yes', c: '0', '@lang': 'fr' }
		});
		let finish: (r: unknown) => void = () => {};
		env.backend.newJob.mockImplementation((_job, cb: { onDone: (r: unknown) => void }) => (finish = cb.onDone));
		const { jobid } = await grader.handleGrader(form({ taskid: 'hello', input: '{"q":"yes","c":"0"}', async: 'on' }));
		expect(await grader.handleGrader(form({ jobid: String(jobid) }))).toEqual({ status: 'waiting' });
		finish(RESULT);
		await new Promise((r) => setTimeout(r, 0));
		expect(await grader.handleGrader(form({ jobid: String(jobid) }))).toMatchObject({ status: 'done', grade: 100 });
		expect((await grader.handleGrader(form({ jobid: String(jobid) }))).status).toBe('error');
		grader.init(new PluginRegistry(), { plugin_module: 'x', api_key: 'k', courseid: 'none' });
		expect(await grader.handleGrader(form({ taskid: 'hello', input: 'null' }))).toMatchObject({
			status_message: 'Cannot open task'
		});
	});
});
