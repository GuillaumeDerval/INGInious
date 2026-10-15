import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { flush, result, setupTask, type TaskEnv } from '../../../../tests/fixtures/task/setup.js';
import { getCourse, type Course } from '../courses/course.js';
import { getTask } from '../courses/task.js';
import { plugins, resetPlugins } from '../plugins/index.js';
import * as m from './manager.js';

let env: TaskEnv;
let course: Course;
const task = (id: string) => getTask(course, id);
const submit = (
	taskid: string,
	input: Record<string, unknown> = { q: '0' },
	user = 'alice',
	debug: m.DebugMode = false
) => m.addSubmission({ course, task: task(taskid), user, input, debug, userIp: '1.2.3.4' });
const subs = () => env.db.c.submissions.find({}).sort({ submitted_on: 1 }).toArray();
const userTask = (username: string, taskid: string) => env.db.c.userTasks.findOne({ username, taskid });

beforeAll(async () => {
	env = await setupTask();
	course = getCourse('task_showcase');
});
afterAll(() => env.cleanup());
beforeEach(async () => {
	for (const c of ['submissions', 'user_tasks', 'groups', 'users', 'fs.files', 'fs.chunks'])
		await env.db.db.collection(c).deleteMany({});
	await env.db.c.users.insertMany(
		['alice', 'bob'].map((u) => ({
			username: u,
			realname: u,
			email: `${u}@x.org`,
			language: u === 'alice' ? 'fr' : 'en',
			bindings: {}
		}))
	);
	env.backend.jobs = [];
	env.backend.killed = [];
	resetPlugins();
});

describe('addSubmission', () => {
	it('TASK-08 stores the submission with legacy defaults, the input in GridFS and sends the job', async () => {
		const { id, removed } = await submit('mcq_single', { capital: '0', extra: 'x' });
		expect(removed).toEqual([]);
		const [doc] = await subs();
		expect(doc).toMatchObject({
			_id: id,
			courseid: 'task_showcase',
			taskid: 'mcq_single',
			username: ['alice'],
			status: 'waiting',
			response_type: 'rst',
			grade: 0,
			result: 'crash',
			text: '',
			custom: {},
			problems: {},
			tests: {},
			user_ip: '1.2.3.4',
			jobid: env.backend.last.id
		});
		const input = await env.db.getInput(doc.input);
		expect(Object.keys(input)).toEqual([
			'capital',
			'extra',
			'@username',
			'@email',
			'@lang',
			'@attempts',
			'@time',
			'@random',
			'@state'
		]);
		expect(input).toMatchObject({ '@username': 'alice', '@lang': 'fr', '@attempts': '1', '@random': [], '@state': '' });
		expect(input['@time']).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{6})?\+00:00$/);
		const { job } = env.backend.last;
		expect(job).toMatchObject({
			priority: 0,
			courseId: 'task_showcase',
			taskId: 'mcq_single',
			environmentType: 'mcq',
			environment: 'mcq',
			environmentParameters: {},
			debug: false,
			launcher: 'Frontend - alice'
		});
		expect(job.problems).toHaveProperty('capital');
		expect((await userTask('alice', 'mcq_single'))?.tokens).toEqual({ amount: 1 });
	});

	it('TASK-08 refuses a second submission while one is waiting, and parallel ones', async () => {
		await submit('mcq_single');
		await expect(submit('mcq_single')).rejects.toThrow('A submission is already pending for this task!');
		await env.db.c.submissions.deleteMany({});
		const results = await Promise.allSettled([submit('mcq_multiple'), submit('mcq_multiple')]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(await env.db.c.submissions.countDocuments({ taskid: 'mcq_multiple' })).toBe(1);
	});

	it('TASK-17 copies the random values (as doubles) and the state, and counts attempts', async () => {
		await env.db.c.userTasks.insertOne({
			courseid: 'task_showcase',
			taskid: 'random_inputs',
			username: 'alice',
			tried: 2,
			random: [0.5, 0.25],
			state: 's',
			grade: 0,
			submissionid: null,
			succeeded: false
		} as never);
		await submit('random_inputs', { sum: '1' });
		const input = await env.db.getInput((await subs())[0].input);
		expect(input).toMatchObject({ '@random': [0.5, 0.25], '@state': 's', '@attempts': '3' });
	});

	it('TASK-16 submits for the whole group with joined usernames and e-mails', async () => {
		await env.db.c.groups.insertOne({
			courseid: 'task_showcase',
			description: 'A',
			size: 3,
			students: ['alice', 'bob', 'ghost'],
			audiences: []
		});
		await submit('group_task', { q: '0' });
		const [doc] = await subs();
		expect(doc.username).toEqual(['alice', 'bob', 'ghost']);
		expect(await env.db.getInput(doc.input)).toMatchObject({
			'@username': 'alice,bob,ghost',
			'@email': 'alice@x.org,bob@x.org,'
		});
		expect((await userTask('bob', 'group_task'))?.tokens.amount).toBe(1);
		// Staff submit alone.
		await submit('group_task', { q: '0' }, 'superadmin');
		expect((await subs())[1].username).toEqual(['superadmin']);
	});

	it('TASK-14 consumes tokens at submit time and refuses beyond the limit (staff unlimited)', async () => {
		for (let i = 0; i < 2; i++) {
			await submit('limited_amount');
			await env.db.c.submissions.updateMany({}, { $set: { status: 'done' } });
		}
		await expect(submit('limited_amount')).rejects.toThrow('You are not allowed to submit for this task.');
		expect((await userTask('alice', 'limited_amount'))?.tokens.amount).toBe(2);
		expect(await env.db.c.submissions.countDocuments()).toBe(2);
		expect(await env.db.db.collection('fs.files').countDocuments()).toBe(2);
		const root = 'superadmin';
		for (let i = 0; i < 3; i++) {
			await submit('limited_amount', {}, root);
			await env.db.c.submissions.updateMany({}, { $set: { status: 'done' } });
		}
		expect((await userTask('superadmin', 'limited_amount'))?.tokens.amount).toBe(3);
	});

	it('TASK-15 keeps the evaluated, waiting and newest submissions and deletes the others with their files', async () => {
		const ids: ObjectId[] = [];
		for (let i = 0; i < 3; i++) {
			ids.push((await submit('stored_two')).id);
			await env.db.c.submissions.updateMany({}, { $set: { status: 'done' } });
			if (i === 0) await env.db.c.userTasks.updateOne({ username: 'alice' }, { $set: { submissionid: ids[0] } });
		}
		const { removed } = await submit('stored_two');
		expect(removed).toEqual([String(ids[2])]); // ids[1] was pruned by the 3rd submission
		expect((await subs()).map((s) => String(s._id))).toEqual([String(ids[0]), expect.any(String)]);
		expect(await env.db.db.collection('fs.files').countDocuments()).toBe(2);
	});

	it('TASK-07 reports an unavailable environment as a crash without job id', async () => {
		env.backend.environments = {};
		await submit('mcq_single');
		await flush();
		const [doc] = await subs();
		expect(doc).toMatchObject({ status: 'error', result: 'crash', text: 'Environment not available.' });
		expect(doc).not.toHaveProperty('jobid');
		env.backend.environments = { mcq: ['mcq'], docker: ['default'] };
	});

	it('TASK-25 calls the new_submission hook, which may add fields', async () => {
		plugins().addHook('new_submission', ({ submission }: { submission: Record<string, unknown> }) => {
			submission.plugin_field = 1;
		});
		await submit('mcq_single', { capital: '0' });
		expect((await subs())[0]).toHaveProperty('plugin_field', 1);
	});
});

describe('completeJob', () => {
	it('TASK-09 stores the result, archive and updates the user stats (best mode)', async () => {
		const { id } = await submit('code_python', { code: 'x' }, 'alice', true);
		expect(env.backend.last.job.debug).toBe(true);
		const archive = new Uint8Array([1, 2, 3]);
		env.backend.last.cb.onDone(
			result(['failed', 'bad'], {
				grade: 25,
				problems: { code: ['failed', 'p'] },
				tests: { skill_loop: true },
				custom: { n: 1 },
				state: '1',
				archive,
				stdout: 'out',
				stderr: 'err'
			})
		);
		await flush();
		const doc = (await subs())[0];
		expect(doc).toMatchObject({
			status: 'done',
			result: 'failed',
			grade: 25,
			text: 'bad',
			problems: { code: ['failed', 'p'] },
			tests: { skill_loop: true },
			custom: { n: 1 },
			state: '1',
			stdout: 'out',
			stderr: 'err'
		});
		expect(doc).not.toHaveProperty('jobid');
		expect(Buffer.from(await env.db.getFile(doc.archive!))).toEqual(Buffer.from(archive));
		expect(await userTask('alice', 'code_python')).toMatchObject({
			tried: 1,
			grade: 25,
			succeeded: false,
			state: '1',
			submissionid: id
		});
		// A lower grade does not replace the evaluated submission; a higher or equal one does.
		await submit('code_python', { code: 'x' });
		env.backend.last.cb.onDone(result(['crash', 'oops']));
		await flush();
		expect(await userTask('alice', 'code_python')).toMatchObject({ tried: 2, grade: 25, submissionid: id });
		expect((await subs())[1]).toMatchObject({ status: 'error', result: 'crash' });
		const third = await submit('code_python', { code: 'x' });
		env.backend.last.cb.onDone(result(['success', ''], { grade: 100 }));
		await flush();
		expect(await userTask('alice', 'code_python')).toMatchObject({
			tried: 3,
			grade: 100,
			succeeded: true,
			submissionid: third.id
		});
	});

	it('TASK-13 last mode always takes the newest submission', async () => {
		await submit('eval_last');
		env.backend.last.cb.onDone(result(['success', ''], { grade: 100 }));
		await flush();
		const second = await submit('eval_last');
		env.backend.last.cb.onDone(result(['failed', ''], { grade: 0 }));
		await flush();
		expect(await userTask('alice', 'eval_last')).toMatchObject({ grade: 0, succeeded: false, submissionid: second.id });
	});

	it('TASK-25 notifies the submission_done hook and listeners (errors ignored)', async () => {
		const hook = vi.fn();
		plugins().addHook('submission_done', hook);
		const listener = vi.fn();
		const off = m.onSubmissionDone(listener);
		const bad = m.onSubmissionDone(() => Promise.reject(new Error('x')));
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		await submit('mcq_single');
		env.backend.last.cb.onDone(result(['success', '']));
		await flush();
		expect(hook).toHaveBeenCalledWith(expect.objectContaining({ newsub: true, archive: null }));
		expect(listener.mock.calls[0][0].submission.status).toBe('done');
		off();
		bad();
		err.mockRestore();
	});

	it('TASK-09 turns a too large result into an error and ignores deleted submissions', async () => {
		await submit('code_python', { code: 'x' });
		const job = env.backend.last;
		job.cb.onDone(result(['success', 'x'.repeat(17 * 1024 * 1024)]));
		await flush();
		await new Promise((r) => setTimeout(r, 300));
		expect((await subs())[0]).toMatchObject({
			status: 'error',
			grade: 0,
			text: 'Maximum submission size exceeded. Check feedback, stdout, stderr and state.'
		});
		expect((await userTask('alice', 'code_python'))?.tried).toBe(0);
		await m.completeJob(new ObjectId(), result(['success', '']), true, course);
	});

	it('TASK-12 stores the SSH credentials of a running job and removes them at the end', async () => {
		await submit('outcomes', { mode: 'sleep' }, 'alice', 'ssh');
		const { cb } = env.backend.last;
		cb.onSsh!({ host: null, port: null, user: null, password: null });
		cb.onSsh!({ host: 'h', port: 22, user: 'worker', password: 'pw' });
		await flush();
		expect((await subs())[0]).toMatchObject({ ssh_host: 'h', ssh_port: 22, ssh_user: 'worker', ssh_password: 'pw' });
		cb.onDone(result(['killed', '']));
		await flush();
		expect((await subs())[0]).not.toHaveProperty('ssh_host');
	});
});

describe('kill, find, delete', () => {
	it("TASK-11 kills only one's own waiting submission with a job", async () => {
		const { id } = await submit('outcomes', { mode: 'sleep' });
		expect(await m.killSubmission(String(id), 'bob')).toBe(false);
		expect(await m.killSubmission('bad', 'alice')).toBe(false);
		expect(await m.killSubmission(String(id), 'alice')).toBe(true);
		expect(env.backend.killed).toEqual([env.backend.last.id]);
	});

	it('findSubmission validates ids and applies the filter', async () => {
		const { id } = await submit('mcq_single');
		expect(await m.findSubmission(String(id), { courseid: 'other' })).toBeNull();
		expect(await m.findSubmission(42, {})).toBeNull();
		expect((await m.findSubmission(String(id), { courseid: 'task_showcase' }))?._id).toEqual(id);
	});
});

describe('replaySubmission', () => {
	it('TASK-24 replays in place with priority 1 and recomputes the evaluated submission', async () => {
		const { id } = await submit('code_python', { code: 'x' });
		env.backend.last.cb.onDone(result(['success', ''], { grade: 100, archive: new Uint8Array([1]) }));
		await flush();
		const sub = (await m.findSubmission(String(id), {}))!;
		await m.replaySubmission(sub, course, task('code_python'));
		const doc = (await subs())[0];
		expect(doc).toMatchObject({ status: 'waiting', jobid: env.backend.last.id });
		expect(doc).not.toHaveProperty('archive');
		expect(doc.last_replay).toBeInstanceOf(Date);
		expect(env.backend.last.job).toMatchObject({ priority: 1, launcher: "Frontend - ['alice']" });
		env.backend.last.cb.onDone(result(['failed', ''], { grade: 50 }));
		await flush();
		expect(await userTask('alice', 'code_python')).toMatchObject({ tried: 1, grade: 50, submissionid: id });
	});

	it('TASK-24 replays in last mode and deleteSubmissions removes archives', async () => {
		const { id } = await submit('eval_last');
		env.backend.last.cb.onDone(result(['success', ''], { archive: new Uint8Array([1]) }));
		await flush();
		await m.replaySubmission((await m.findSubmission(String(id), {}))!, course, task('eval_last'));
		env.backend.last.cb.onDone(result(['failed', ''], { archive: new Uint8Array([2]) }));
		await flush();
		expect(await userTask('alice', 'eval_last')).toMatchObject({ grade: 0, submissionid: id });
		expect(await m.deleteSubmissions({ _id: id })).toEqual([String(id)]);
		expect(await env.db.db.collection('fs.files').countDocuments()).toBe(0);
	});

	it('TASK-24 replays as a copy for a staff member', async () => {
		const { id } = await submit('code_python', { code: 'x' });
		const sub = (await m.findSubmission(String(id), {}))!;
		const copy = await m.replaySubmission(sub, course, task('code_python'), {
			copy: { username: 'bob', userIp: '9.9.9.9' },
			debug: 'ssh'
		});
		const doc = (await m.findSubmission(String(copy), {}))!;
		expect(doc).toMatchObject({ username: ['bob'], user_ip: '9.9.9.9', status: 'waiting' });
		expect(await env.db.getInput(doc.input)).toMatchObject({
			code: 'x',
			'@username': 'bob',
			'@email': 'bob@x.org',
			'@attempts': '1'
		});
		expect(env.backend.last.job.debug).toBe('ssh');
	});
});

describe('recovery', () => {
	it('TASK-25 errors only the old waiting submissions unknown to the backend queue', async () => {
		const { id: lost } = await submit('mcq_single');
		const { id: alive } = await submit('mcq_multiple');
		await env.db.c.submissions.updateOne({ _id: alive }, { $set: { jobid: 'other-frontend' } });
		env.backend.queue = null;
		const pending = m.recoverSubmissions(1000, 10);
		await new Promise((r) => setTimeout(r, 30));
		env.backend.queue = { running: [['other-frontend']], waiting: [] };
		expect(await pending).toBe(1);
		expect(await m.findSubmission(String(lost), {})).toMatchObject({
			status: 'error',
			text: 'Internal error. Server restarted',
			grade: 0
		});
		expect(await m.findSubmission(String(alive), {})).toMatchObject({ status: 'waiting' });
		expect(await m.recoverSubmissions(30, 10)).toBe(0);
		const once = m.ensureRecovery();
		await new Promise((r) => setTimeout(r, 300));
		env.backend.queue = { running: [], waiting: [] };
		expect(await once).toBe(1);
		expect(m.ensureRecovery()).toBe(once);
	});
});
