import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { flush, result, setupTask, type TaskEnv } from '../../../../tests/fixtures/task/setup.js';
import type { CurrentUser } from '../../../app.d.ts';
import { getCourse } from '../courses/course.js';
import { getTask } from '../courses/task.js';
import { plugins, resetPlugins } from '../plugins/index.js';
import * as p from './page.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { services } from '../app.js';

let env: TaskEnv;
const C = 'task_showcase';

/** Builds a request event for `username` (null = anonymous), optionally posting `form`. */
function ev(username: string | null, form?: Record<string, string | string[] | File>): RequestEvent {
	const body = new FormData();
	for (const [k, v] of Object.entries(form ?? {})) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
	const user = username
		? ({
				username,
				realname: username,
				email: `${username}@s`,
				language: 'en',
				timezone: 'UTC',
				codeIndentation: '4',
				superadmin: false
			} as CurrentUser)
		: null;
	return {
		url: new URL(`http://localhost/course/${C}/x`),
		locals: { user, session: { doc: { is_lti: false, tos_signed: true } }, lang: 'en' },
		request: new Request('http://localhost/', { method: 'POST', body }),
		getClientAddress: () => '5.6.7.8'
	} as unknown as RequestEvent;
}

/** Returns the HTTP status (or redirect location) thrown by `fn`. */
async function status(fn: () => Promise<unknown>): Promise<number | string> {
	try {
		await fn();
		return 200;
	} catch (e) {
		if (isRedirect(e)) return e.location;
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

const act = async (user: string | null, task: string, form: Record<string, string | string[] | File>) =>
	(await (await p.taskAction(ev(user, form), C, task)).json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON answers;

beforeAll(async () => {
	env = await setupTask();
	env.backend.queue = { running: [], waiting: [] };
});
afterAll(() => env.cleanup());
beforeEach(async () => {
	for (const c of ['submissions', 'user_tasks', 'groups', 'users', 'courses'])
		await env.db.db.collection(c).deleteMany({});
	await env.db.c.users.insertMany(
		['alice', 'bob', 'dave', 'task_tutor', 'superadmin'].map((u) => ({
			username: u,
			realname: u,
			email: `${u}@x.org`,
			language: 'en',
			bindings: {}
		}))
	);
	await env.db.c.courses.insertOne({ _id: C, students: ['alice', 'bob'] });
	env.backend.jobs = [];
	resetPlugins();
});

describe('loadTaskPage', () => {
	it('TASK-01 loads the page of a registered student and records the visit', async () => {
		plugins().addHook('task_menu', () => ({ label: 'Scoreboard', href: '/scoreboard', extra: 1 }));
		// TASK-01: plugin entries keep http(s) and relative links only.
		for (const href of ['javascript:alert(1)', ' JavaScript:x', 'data:text/html,x', 'http://[', 'https://x.org/a'])
			plugins().addHook('task_menu', () => ({ label: href, href }));
		const data = await p.loadTaskPage(ev('alice'), C, 'code_python');
		expect(data).toMatchObject({
			name: 'Python code - count to n',
			registered: true,
			staff: false,
			admin: false,
			blocked: null,
			registerUrl: null,
			evaluationMode: 'best',
			submissions: [],
			evaluated: null,
			waiting: null,
			group: null,
			prev: 'legacy_env',
			next: 'single_line',
			menu: [
				{ label: 'Scoreboard', href: '/scoreboard' },
				{ label: 'https://x.org/a', href: 'https://x.org/a' }
			],
			webterm: null,
			info: {
				author: 'INGInious test-suite',
				contactUrl: 'mailto:teacher@example.org?subject=task_showcase/code_python/alice',
				deadline: null,
				status: 'notattempted',
				grade: 0,
				tried: 0,
				limit: { amount: -1, period: -1 },
				categories: ['cat_basics']
			}
		});
		expect(data.problems[0]).toMatchObject({
			id: 'code',
			type: 'code',
			title: 'Your function',
			language: 'python',
			offset: 3
		});
		expect(data.context).toContain('<code');
		expect(data.tags.map((t) => t.id)).toEqual(['skill_loop', 'misc_off_by_one']);
		expect(await env.db.c.userTasks.findOne({ username: 'alice' })).toMatchObject({
			tried: 0,
			random: [],
			submissionid: null
		});
		const mcq = await p.loadTaskPage(ev('alice'), C, 'mcq_centralize');
		expect(mcq.problems.map((x) => x.title)).toEqual([
			expect.stringMatching(/^Question 1: /),
			expect.stringMatching(/^Question 2: /),
			expect.stringMatching(/^Question 3: /)
		]);
		expect(mcq.problems[0].choices![0].html).toContain('<p>');
	});

	it('TASK-17 generates the legacy CPython random values and stores them', async () => {
		const data = await p.loadTaskPage(ev('alice'), C, 'random_inputs');
		expect(data.random).toEqual([0.6410545587531586, 0.9352913063778554]);
		expect((await env.db.c.userTasks.findOne({ username: 'alice' }))?.random).toEqual(data.random);
		const regen = getTask(getCourse(C), 'random_regen');
		expect(p.randomInputs(regen, 'alice')).not.toEqual(
			p.randomInputs({ ...regen, regenerateInputRandom: false }, 'alice')
		);
	});

	it('TASK-18 hidden tasks: 403 for students, warning for staff; unknown task 404', async () => {
		expect(await status(() => p.loadTaskPage(ev('alice'), C, 'future_task'))).toBe(403);
		expect(await status(() => p.loadTaskPage(ev('alice'), C, 'nope'))).toBe(404);
		const staff = await p.loadTaskPage(ev('task_tutor'), C, 'future_task');
		expect(staff).toMatchObject({ staff: true, admin: false, taskHidden: true, courseHidden: false });
		const admin = await p.loadTaskPage(ev('superadmin'), C, 'never_task');
		expect(admin).toMatchObject({ admin: true, webterm: 'https://term', info: { neverAccessible: true } });
		expect(admin.tags.map((t) => t.id)).toContain('skill_hidden');
	});

	it('TASK-01 anonymous users sign in, unregistered users go to the registration', async () => {
		expect(await status(() => p.loadTaskPage(ev(null), C, 'mcq_single'))).toMatch(/^\/signin/);
		expect(await status(() => p.loadTaskPage(ev('dave'), C, 'mcq_single'))).toBe(`/register/${C}`);
	});

	it('TASK-14/16/18 explain why the submit button is disabled', async () => {
		expect((await p.loadTaskPage(ev('alice'), C, 'closed_task')).blocked).toBe(
			'The deadline is over, you cannot submit anymore'
		);
		const soft = await p.loadTaskPage(ev('alice'), C, 'soft_deadline');
		expect(soft.info).toMatchObject({
			pastSoftDeadline: true,
			deadline: expect.stringMatching(/^2021-01-01|^2020-12-31/)
		});
		expect((await p.loadTaskPage(ev('alice'), C, 'group_task')).blocked).toBe('Please register in a group');
		await env.db.c.groups.insertOne({
			courseid: C,
			description: 'Team A',
			size: 2,
			students: ['alice', 'bob'],
			audiences: []
		});
		expect((await p.loadTaskPage(ev('alice'), C, 'group_task')).group).toEqual({ description: 'Team A' });
		await env.db.c.userTasks.updateOne(
			{ username: 'alice', taskid: 'group_task' },
			{ $set: { tokens: { amount: 0, date: new Date() } } }
		);
		await env.db.c.userTasks.insertOne({
			courseid: C,
			taskid: 'limited_amount',
			username: 'alice',
			tokens: { amount: 2 }
		} as never);
		expect((await p.loadTaskPage(ev('alice'), C, 'limited_amount')).blocked).toBe(
			'You have reached the submission limit.'
		);
		await env.db.c.userTasks.insertOne({
			courseid: C,
			taskid: 'limited_period',
			username: 'alice',
			tokens: { amount: 1, date: new Date() }
		} as never);
		expect((await p.loadTaskPage(ev('alice'), C, 'limited_period')).blocked).toBe(
			'You have reached the submission limit. It will be refilled within the next 1 hour(s)'
		);
		const settings = getCourse(C).dispenser.config.group_task;
		settings.submissionLimit = { amount: 0, period: -1 };
		expect((await p.loadTaskPage(ev('alice'), C, 'group_task')).blocked).toBe(
			'Your group have reached the submission limit.'
		);
		settings.submissionLimit = { amount: -1, period: -1 };
	});
});

describe('loadTaskPage edge cases', () => {
	it('TASK-01 anonymous previews, broken tasks, unsafe contact URLs and statuses', async () => {
		const course = getCourse(C);
		course.allowPreview = true;
		const anon = await p.loadTaskPage(ev(null), C, 'random_inputs');
		expect(anon).toMatchObject({
			username: null,
			registered: false,
			blocked: 'Please enroll in the course to submit.',
			info: { status: null, grade: 0 }
		});
		expect(anon.random).toHaveLength(2);
		expect(await env.db.c.userTasks.countDocuments()).toBe(0);
		expect(await status(() => p.taskAction(ev(null), C, 'mcq_single'))).toBe(403);
		course.allowPreview = false;
		mkdirSync(join(env.dir, C, 'broken'));
		writeFileSync(join(env.dir, C, 'broken', 'task.yaml'), 'name: x\nproblems: 3\n');
		expect(await status(() => p.loadTaskPage(ev('superadmin'), C, 'broken'))).toBe(404);
		const task = getTask(course, 'code_python');
		const url = task.contactUrl;
		task.contactUrl = 'javascript:alert({username})';
		expect((await p.loadTaskPage(ev('alice'), C, 'code_python')).info.contactUrl).toBeNull();
		task.contactUrl = url;
		const input = await env.db.putInput({});
		const sub = (status: 'waiting' | 'error') => ({
			courseid: C,
			taskid: 'mcq_single',
			username: ['alice'],
			input,
			status,
			submitted_on: new Date(),
			grade: 0
		});
		await env.db.c.submissions.insertOne(sub('error'));
		expect((await p.loadTaskPage(ev('alice'), C, 'mcq_single')).info.status).toBe('failed');
		await env.db.c.submissions.insertOne(sub('waiting'));
		expect(await p.loadTaskPage(ev('alice'), C, 'mcq_single')).toMatchObject({
			info: { status: 'waiting' },
			waiting: expect.any(String)
		});
		const webterm = services().config.webterm;
		services().config.webterm = undefined;
		expect((await p.loadTaskPage(ev('superadmin'), C, 'mcq_single')).webterm).toBeNull();
		services().config.webterm = webterm;
		expect(await p.loadTaskPage(ev('dave'), C, 'task_info').catch(() => null)).toBeNull();
	});
});

describe('taskAction', () => {
	it('TASK-10 pages the history: newest first, then older pages through the history action', async () => {
		const input = await env.db.putInput({});
		const at = new Date(Date.UTC(2026, 0, 1));
		// HISTORY_PAGE + 5 submissions, two of them at the same instant (ties broken by id).
		const docs = Array.from({ length: p.HISTORY_PAGE + 5 }, (_, i) => ({
			courseid: C,
			taskid: 'mcq_single',
			username: ['alice'],
			input,
			status: 'done' as const,
			result: 'failed',
			grade: i,
			submitted_on: new Date(at.getTime() + Math.min(i, p.HISTORY_PAGE + 3) * 1000)
		}));
		await env.db.c.submissions.insertMany(docs);
		await env.db.c.submissions.insertOne({ ...docs[0], _id: undefined, username: ['bob'] });
		const page = await p.loadTaskPage(ev('alice'), C, 'mcq_single');
		expect([page.submissions.length, page.more, page.submissionCount]).toEqual([p.HISTORY_PAGE, true, docs.length]);
		expect(page.submissions[0].grade).toBe(p.HISTORY_PAGE + 4);
		const next = await act('alice', 'mcq_single', { '@action': 'history', before: page.submissions.at(-1)!.id });
		expect(next.more).toBe(false);
		expect(next.submissions.map((s: { grade: number }) => s.grade)).toEqual([4, 3, 2, 1, 0]);
		// Unknown or foreign cursors are refused.
		const foreign = (await env.db.c.submissions.findOne({ username: 'bob' }))!._id;
		for (const before of ['nope', String(foreign)])
			expect(await act('alice', 'mcq_single', { '@action': 'history', before })).toEqual({
				status: 'error',
				text: 'Internal error'
			});
	});

	it('TASK-08/09/10 submits, polls and reloads a submission', async () => {
		await p.loadTaskPage(ev('alice'), C, 'mcq_single');
		const res = await act('alice', 'mcq_single', { '@action': 'submit', capital: '0', '@debug-mode': 'ssh' });
		expect(res).toMatchObject({ status: 'ok', remove: [] });
		expect(env.backend.last.job.debug).toBe(false);
		const doc = await env.db.c.submissions.findOne({});
		expect(doc).toMatchObject({ user_ip: '5.6.7.8', username: ['alice'] });
		expect(
			(await act('alice', 'mcq_single', { '@action': 'check', submissionid: res.submissionid })).submission
		).toMatchObject({ status: 'waiting' });
		expect(await act('alice', 'mcq_single', { '@action': 'submit', capital: '0' })).toEqual({
			status: 'error',
			text: 'A submission is already pending for this task!'
		});
		env.backend.last.cb.onDone(result(['success', 'Well done']));
		await flush();
		const check = await act('alice', 'mcq_single', { '@action': 'check', submissionid: res.submissionid });
		expect(check.submission).toMatchObject({ status: 'done', result: 'success', replace: true });
		const load = await act('alice', 'mcq_single', { '@action': 'load', submissionid: res.submissionid });
		expect(load.submission.input).toMatchObject({ capital: '0', '@username': 'alice' });
		const page = await p.loadTaskPage(ev('alice'), C, 'mcq_single');
		expect(page).toMatchObject({ evaluated: res.submissionid, info: { status: 'succeeded', tried: 1 } });
		// Bob (another student) and the staff of the course only see what they may.
		expect(await act('bob', 'mcq_single', { '@action': 'check', submissionid: res.submissionid })).toEqual({
			status: 'error',
			text: 'Internal error'
		});
		expect((await act('task_tutor', 'mcq_single', { '@action': 'check', submissionid: res.submissionid })).status).toBe(
			'ok'
		);
		// A submission is only reachable through its own task page.
		expect(
			(await act('task_tutor', 'mcq_multiple', { '@action': 'check', submissionid: res.submissionid })).status
		).toBe('error');
	});

	it('TASK-08 refuses invalid answers, outdated random values and forbidden users', async () => {
		await p.loadTaskPage(ev('alice'), C, 'random_inputs');
		expect((await act('alice', 'random_inputs', { '@action': 'submit', sum: '1' })).text).toBe(
			'Your task has been regenerated. This current task is outdated.'
		);
		const random = (await env.db.c.userTasks.findOne({ taskid: 'random_inputs' }))!.random;
		expect(
			(
				await act('alice', 'random_inputs', {
					'@action': 'submit',
					'@random_0': String(random[0]),
					'@random_1': String(random[1])
				})
			).text
		).toMatch(/^Please answer to all the questions/);
		// TASK-08: a refused submission answers HTTP 403 with the JSON error.
		const refused = await p.taskAction(ev('alice', { '@action': 'submit', q: '0' }), C, 'closed_task');
		expect(refused.status).toBe(403);
		expect(await refused.json()).toEqual({ status: 'error', text: 'You are not allowed to submit for this task.' });
		expect(await status(() => p.taskAction(ev(null), C, 'mcq_single'))).toMatch(/^\/signin/);
		expect(await status(() => p.taskAction(ev('alice', { '@action': 'nope' }), C, 'mcq_single'))).toBe(400);
		expect((await act('alice', 'mcq_single', { '@action': 'check', submissionid: 'bad' })).status).toBe('error');
	});

	it('TASK-08/14 tokens and pending errors become JSON errors; other errors propagate', async () => {
		await env.db.c.userTasks.insertOne({
			courseid: C,
			taskid: 'limited_amount',
			username: 'alice',
			tried: 0,
			random: [],
			tokens: { amount: 1 },
			grade: 0,
			state: '',
			submissionid: null,
			succeeded: false
		} as never);
		await Promise.all([
			act('alice', 'limited_amount', { '@action': 'submit', q: '0' }),
			act('alice', 'limited_amount', { '@action': 'submit', q: '0' })
		]);
		expect(await env.db.c.submissions.countDocuments()).toBe(1);
		const broken = env.backend.newJob;
		env.backend.newJob = () => {
			throw new Error('boom');
		};
		await expect(act('alice', 'mcq_single', { '@action': 'submit', capital: '0' })).rejects.toThrow('boom');
		env.backend.newJob = broken;
	});

	it('TASK-11/12 kills and starts SSH debug sessions for admins', async () => {
		const res = await act('superadmin', 'outcomes', { '@action': 'submit', mode: 'sleep', '@debug-mode': 'ssh' });
		expect(env.backend.last.job.debug).toBe('ssh');
		// TASK-12: the SSH access is shown to the admin who launched the session only.
		env.backend.last.cb.onSsh!({ host: 'ssh.host', port: 2222, user: 'worker', password: 'pw' });
		const ssh = { host: 'ssh.host', port: 2222, user: 'worker', password: 'pw' };
		const check = (user: string) => act(user, 'outcomes', { '@action': 'check', submissionid: res.submissionid });
		await expect.poll(async () => (await check('superadmin')).submission.ssh).toEqual(ssh);
		const tutor = (await check('task_tutor')).submission;
		expect(tutor.ssh).toBeUndefined();
		expect(JSON.stringify(tutor)).not.toContain('pw');
		expect(await act('bob', 'outcomes', { '@action': 'kill', submissionid: res.submissionid })).toEqual({
			status: 'done',
			killed: false
		});
		expect(await act('superadmin', 'outcomes', { '@action': 'kill', submissionid: res.submissionid })).toEqual({
			status: 'done',
			killed: true
		});
		await env.db.c.submissions.deleteMany({});
		await act('superadmin', 'outcomes', { '@action': 'submit', mode: 'x' });
		expect(env.backend.last.job.debug).toBe(true);
	});
});

describe('serveTaskFile', () => {
	const get = async (user: string | null, task: string, path: string) => {
		try {
			return await p.serveTaskFile(ev(user), C, task, path);
		} catch (e) {
			if (isHttpError(e)) return e.status;
			throw e;
		}
	};

	it('TASK-22 serves public files inline and sandboxed, refuses the rest', async () => {
		const res = (await get('alice', 'task_info', 'hello.txt')) as Response;
		expect(res.headers.get('content-type')).toBe('text/plain');
		expect(res.headers.get('content-disposition')).toMatch(/^inline/);
		expect(res.headers.get('content-security-policy')).toContain('sandbox');
		expect(((await get('alice', '$common', 'common.txt')) as Response).status).toBe(200);
		expect(await get('alice', 'task_info', 'sub')).toBe(404);
		expect(await get('alice', 'task_info', '../secret.txt')).toBe(404);
		expect(await get('alice', 'task_info', 'missing')).toBe(404);
		expect(await get('alice', 'future_task', 'x.txt')).toBe(403);
	});

	it('TASK-04/23 downloads submitted files and archives', async () => {
		const file = new File(['INGInious\n'], 'my report.txt');
		const res = await act('alice', 'file_upload', { '@action': 'submit', upload: file });
		env.backend.last.cb.onDone(result(['success', ''], { archive: new Uint8Array([31, 139]) }));
		await flush();
		const dl = (await get('alice', 'file_upload', `$input/${res.submissionid}/upload`)) as Response;
		expect(await dl.text()).toBe('INGInious\n');
		expect(dl.headers.get('content-disposition')).toBe(
			`attachment; filename="my_report.txt"; filename*=UTF-8''my%20report.txt`
		);
		expect(await get('bob', 'file_upload', `$input/${res.submissionid}/upload`)).toBe(404);
		expect(await get('alice', 'file_upload', `$input/${res.submissionid}/@email`)).toBe(404);
		expect(await get('alice', 'file_upload', `$archive/${res.submissionid}`)).toBe(403);
		const archive = (await get('task_tutor', 'file_upload', `$archive/${res.submissionid}`)) as Response;
		expect(archive.headers.get('content-type')).toBe('application/octet-stream');
		const code = await act('alice', 'single_line', {
			'@action': 'submit',
			word: 'hello',
			number: '7',
			comment: '',
			notes: ''
		});
		expect(await ((await get('alice', 'single_line', `$input/${code.submissionid}/word`)) as Response).text()).toBe(
			'hello'
		);
		expect(await get('task_tutor', 'single_line', `$archive/${code.submissionid}`)).toBe(404);
		expect(await status(() => p.serveTaskFile(ev(null), C, 'single_line', `$input/${code.submissionid}/word`))).toMatch(
			/^\/signin/
		);
		const input = await env.db.putInput({
			upload: { filename: 'r.pdf', value: Buffer.from('%PDF') },
			choices: ['0', '2']
		});
		const { insertedId } = await env.db.c.submissions.insertOne({
			courseid: C,
			taskid: 'file_upload',
			username: ['alice'],
			input,
			status: 'done',
			submitted_on: new Date(),
			grade: 0
		});
		const pdf = (await get('alice', 'file_upload', `$input/${insertedId}/upload`)) as Response;
		expect(pdf.headers.get('content-disposition')).toMatch(/^inline/);
		expect(pdf.headers.get('content-type')).toBe('application/pdf');
		await env.db.c.submissions.updateOne({ _id: insertedId }, { $set: { taskid: 'mcq_multiple' } });
		await env.db.putInput({});
		const mcq = await env.db.putInput({ primes: ['0', '2'] });
		await env.db.c.submissions.updateOne({ _id: insertedId }, { $set: { input: mcq } });
		expect(await ((await get('alice', 'mcq_multiple', `$input/${insertedId}/primes`)) as Response).text()).toBe('0\n2');
	});
});
