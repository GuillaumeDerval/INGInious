import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock } from 'vitest';
import { services } from '../app.js';
import { parse } from 'yaml';
import { siteEnv, event, user, MCQ_TASK, type SiteEnv } from '../../../../tests/site/env.js';
import { hashPassword } from '../auth/passwords.js';
import { ObjectId } from 'mongodb';
import { apiResponse, body, handleApi } from './index.js';

let env: SiteEnv;
const toc = (tasks: string[], config = {}) => ({
	toc: [{ id: 's', title: 'S', tasks_list: tasks }],
	config: { ...Object.fromEntries(tasks.map((t) => [t, { accessibility: true }])), ...config }
});

beforeAll(async () => {
	env = await siteEnv();
	env.course(
		'api',
		{
			name: 'API',
			admins: ['admin1'],
			registration: true,
			registration_password: 'pw',
			task_dispenser: 'toc',
			dispenser_data: toc(['t1', 'hidden', 'code'], { hidden: { accessibility: false } })
		},
		{
			t1: MCQ_TASK,
			hidden: { ...MCQ_TASK, name: 'Hidden' },
			code: {
				name: 'Code',
				environment_type: 'docker',
				environment_id: 'default',
				problems: { f: { type: 'file', allowed_exts: ['.txt'] } }
			}
		}
	);
	env.course('closed', { name: 'Closed', registration: false });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
	for (const c of ['courses', 'users', 'user_tasks', 'submissions']) await env.db.db.collection(c).deleteMany({});
	await env.db.c.courses.insertOne({ _id: 'api', students: ['bob'] });
});

/** Calls the API and returns status, headers and parsed JSON body. */
async function call(path: string, opts: Parameters<typeof event>[1] = {}) {
	const res = await handleApi(event(`/api/v0/${path}`, opts), path.split('?')[0]);
	const text = await res.text();
	return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}
const bob = user('bob');

describe('SITE-06 conventions', () => {
	it('negotiates YAML on Accept or Content-Type, JSON otherwise', async () => {
		const r = apiResponse(new Request('http://x', { headers: { accept: 'application/x-yaml' } }), { a: 1 });
		expect(r.headers.get('content-type')).toBe('text/yaml; charset=utf-8');
		expect(parse(await r.text())).toEqual({ a: 1 });
		expect(
			apiResponse(
				new Request('http://x', { method: 'POST', headers: { 'content-type': 'text/yaml' }, body: '' }),
				1
			).headers.get('content-type')
		).toContain('yaml');
		expect(apiResponse(new Request('http://x'), 1).headers.get('content-type')).toBe('application/json; charset=utf-8');
	});
	it('answers 404 for unknown paths and 405 with Allow for other methods', async () => {
		expect(await call('nope')).toMatchObject({ status: 404, json: { error: 'Not found' } });
		const r = await call('auth_methods', { method: 'PUT' });
		expect(r).toMatchObject({ status: 405, json: { error: 'This endpoint has no such method' } });
		expect(r.headers.get('allow')).toBe('GET');
		expect((await call('courses/api/tasks/t1/submissions/x', { method: 'POST', user: bob })).status).toBe(405);
		expect((await call('auth_methods', { method: 'HEAD' })).status).toBe(200);
	});
	it('reads form or JSON bodies', async () => {
		const json = await body(
			new Request('http://x', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"a":["1","2"],"b":3}'
			})
		);
		expect([json.getAll('a'), json.get('b')]).toEqual([['1', '2'], '3']);
		expect([
			...(await body(
				new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'nope' })
			))
		]).toEqual([]);
		expect([...(await body(new Request('http://x', { method: 'POST', body: 'x' })))].length).toBe(0);
	});
	it('rethrows unexpected errors', async () => {
		const ev = event('/api/v0/authentication', {
			method: 'POST',
			body: new URLSearchParams({ login: 'a', password: 'b' })
		});
		(ev as unknown as { getClientAddress: () => never }).getClientAddress = () => {
			throw new Error('boom');
		};
		await expect(handleApi(ev, 'authentication')).rejects.toThrow('boom');
	});
});

describe('SITE-07 authentication', () => {
	it('lists the constant auth method and the session status', async () => {
		expect((await call('auth_methods')).json[0].name).toBe('INGInious account');
		expect((await call('authentication')).json).toEqual({ authenticated: false });
		expect((await call('authentication', { user: bob })).json).toEqual({ authenticated: true, username: 'bob' });
	});
	it('logs in (rotating the session), refuses bad credentials and missing fields', async () => {
		await env.db.c.users.insertOne({
			username: 'bob',
			realname: 'Bob',
			email: 'b@x.org',
			password: await hashPassword('secret'),
			language: 'en',
			bindings: {}
		});
		const post = (fields: Record<string, string>, json = false) =>
			call('authentication', {
				method: 'POST',
				body: json ? JSON.stringify(fields) : new URLSearchParams(fields),
				headers: json ? { 'content-type': 'application/json' } : {}
			});
		expect(await post({ login: 'bob', password: 'secret' }, true)).toMatchObject({
			status: 200,
			json: { status: 'success', username: 'bob' }
		});
		expect(await post({ login: 'bob', password: 'wrong' })).toMatchObject({ status: 403, json: { status: 'error' } });
		expect(await post({ login: 'bob' })).toMatchObject({
			status: 400,
			json: { error: 'Invalid arguments for this method' }
		});
		expect((services().sessions as unknown as { rotate: Mock }).rotate).toHaveBeenCalledTimes(1);
	});
});

describe('SITE-08 courses', () => {
	it('requires authentication', async () => {
		expect(await call('courses')).toMatchObject({ status: 403, json: { error: 'You are not authenticated' } });
	});
	it('lists registered (visible tasks + grade) and registrable courses', async () => {
		await env.db.c.users.insertOne({
			username: 'bob',
			realname: 'Bob',
			email: 'b@x.org',
			language: 'en',
			bindings: {}
		});
		const list = (await call('courses', { user: bob })).json as Record<string, unknown>[];
		const api = list.find((c) => c.id === 'api')!;
		expect(api).toEqual({
			id: 'api',
			name: 'API',
			require_password: true,
			is_registered: true,
			tasks: { t1: 'MCQ', code: 'Code' },
			grade: 0
		});
		expect(list.find((c) => c.id === 'closed')).toBeUndefined();
		expect((await call('courses/api', { user: user('carl') })).json).toEqual([
			{ id: 'api', name: 'API', require_password: true, is_registered: false }
		]);
		expect((await call('courses/closed', { user: bob })).json).toEqual([]);
		expect(await call('courses/zzz', { user: bob })).toMatchObject({
			status: 404,
			json: { error: 'Course not found' }
		});
	});
});

describe('SITE-09 tasks', () => {
	it('returns visible tasks without answers and with the user status', async () => {
		const [t1] = (await call('courses/api/tasks/t1', { user: bob })).json;
		expect(t1).toMatchObject({ id: 't1', name: 'MCQ', authors: 'Me', status: 'notviewed', grade: 0 });
		expect(t1.problems).toEqual([
			{ type: 'match', name: 'Q', header: 'Type yes', id: 'q' },
			{ type: 'multiple_choice', name: 'C', header: 'Pick', choices: { 0: 'A', 1: 'B' }, id: 'c' }
		]);
		const statuses = async () =>
			(await call('courses/api/tasks', { user: bob })).json
				.filter((t: { id: string }) => t.id === 't1')
				.map((t: { status: string }) => t.status);
		for (const [doc, expected] of [
			[{ tried: 0 }, 'notattempted'],
			[{ tried: 1, succeeded: true }, 'succeeded'],
			[{ tried: 1, succeeded: false }, 'failed']
		] as const) {
			await env.db.c.userTasks.deleteMany({});
			await env.db.c.userTasks.insertOne({
				courseid: 'api',
				taskid: 't1',
				username: 'bob',
				grade: 0,
				succeeded: false,
				submissionid: null,
				state: '',
				...doc
			} as never);
			expect((await statuses())[0]).toBe(expected);
		}
	});
	it('hides hidden and unknown tasks, refuses outsiders', async () => {
		expect(await call('courses/api/tasks/hidden', { user: bob })).toMatchObject({
			status: 404,
			json: { error: 'Task not found' }
		});
		expect((await call('courses/api/tasks/hidden', { user: user('admin1') })).status).toBe(200);
		expect(await call('courses/api/tasks', { user: user('carl') })).toMatchObject({
			status: 403,
			json: { error: 'You are not registered to this course' }
		});
		expect((await call('courses/zzz/tasks', { user: bob })).status).toBe(404);
	});
});

describe('SITE-10/11 submissions', () => {
	const form = (fields: Record<string, string>) => ({ method: 'POST', user: bob, body: new URLSearchParams(fields) });
	it('creates a submission, refuses pending/invalid/forbidden ones', async () => {
		await env.db.c.users.insertOne({
			username: 'bob',
			realname: 'Bob',
			email: 'b@x.org',
			language: 'fr',
			bindings: {}
		});
		const r = await call('courses/api/tasks/t1/submissions', form({ q: 'yes', c: '0' }));
		expect(r.status).toBe(200);
		expect(env.backend.newJob).toHaveBeenCalled();
		expect(await call('courses/api/tasks/t1/submissions', form({ q: 'yes', c: '0' }))).toMatchObject({
			status: 409,
			json: 'A submission is already pending for this task!'
		});
		expect(await call('courses/api/tasks/t1/submissions', form({ q: 'yes', c: '9' }))).toMatchObject({ status: 400 });
		expect(await call('courses/api/tasks/hidden/submissions', form({}))).toMatchObject({ status: 404 });
		await env.db.c.courses.updateOne({ _id: 'api' }, { $set: { students: ['bob', 'eve'] } });
		await env.db.c.userTasks.insertOne({
			courseid: 'api',
			taskid: 'code',
			username: 'eve',
			tried: 0,
			succeeded: false,
			grade: 0,
			submissionid: null,
			state: '',
			tokens: { amount: 99, date: new Date() }
		} as never);
		expect((await call('courses/api/tasks/code/submissions', { ...form({}), user: user('eve') })).status).toBe(400);
		expect((await env.db.c.userTasks.findOne({ taskid: 't1', username: 'bob' }))?.username).toBe('bob');
	});
	it('maps unexpected submission errors', async () => {
		env.backend.newJob.mockImplementationOnce(() => {
			throw new Error('backend down');
		});
		await expect(
			handleApi(event('/x', form({ q: 'yes', c: '0' })), 'courses/api/tasks/t1/submissions')
		).rejects.toThrow('backend down');
	});
	it('lists own submissions with feedback and base64 inputs; 404 for others', async () => {
		const input = await env.db.putInput({ q: 'yes', f: { filename: 'a.txt', value: Buffer.from('hi') } });
		const base = { courseid: 'api', taskid: 't1', input, grade: 100, user_ip: '' };
		const { insertedId: done } = await env.db.c.submissions.insertOne({
			...base,
			username: ['bob'],
			status: 'done',
			result: 'success',
			text: 'Good',
			problems: { q: ['success', 'Fine'] },
			submitted_on: new Date('2026-01-01T00:00:00.123Z')
		});
		await env.db.c.submissions.insertOne({
			...base,
			username: ['bob'],
			status: 'waiting',
			submitted_on: new Date('2026-01-02T00:00:00Z')
		});
		const { insertedId: other } = await env.db.c.submissions.insertOne({
			...base,
			username: ['eve'],
			status: 'done',
			submitted_on: new Date()
		});
		const list = (await call('courses/api/tasks/t1/submissions', { user: bob })).json;
		expect(list.map((s: { status: string }) => s.status)).toEqual(['waiting', 'done']);
		expect(list[1]).toMatchObject({
			id: String(done),
			submitted_on: '2026-01-01T00:00:00.123000+00:00',
			grade: 100,
			result: 'success',
			problems_feedback: { q: ['success', expect.stringContaining('Fine')] }
		});
		expect(list[1].feedback).toContain('Good');
		const [one] = (await call(`courses/api/tasks/t1/submissions/${done}?input`, { user: bob })).json;
		expect(one.input).toEqual({ q: 'yes', f: { filename: 'a.txt', value: 'aGk=' } });
		for (const id of [other, 'zzz', new ObjectId()])
			expect(await call(`courses/api/tasks/t1/submissions/${id}`, { user: bob })).toMatchObject({
				status: 404,
				json: { error: 'Submission not found' }
			});
	});
});
