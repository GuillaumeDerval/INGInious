/**
 * Unit tests of the ltibestsubmission plugin (SITE-20, LTI-14).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ltiEvent, settle, setupLti, type LtiEnv } from '../../../../../tests/fixtures/lti/setup.js';
import type { LtiData } from '../../db/types.js';
import { resetPlugins } from '../index.js';
import * as plugin from './inginious.frontend.plugins.ltibestsubmission.js';

let env: LtiEnv;
const URL = 'http://tool/lti/bestsubmission';

/** An LTI session of the LMS user "lms-1" on `taskid`, logged in as `username` when given. */
async function session(taskid: string, username?: string, lti: Partial<LtiData> = {}) {
	const s = env.sessions.create(true);
	s.doc.lti = {
		version: '1.1',
		email: '',
		username: 'lms-1',
		realname: 'LMS',
		roles: [],
		task: ['lti_test', taskid],
		redir_url: '/lti/task',
		consumer_key: 'ltikey',
		...lti
	} as LtiData;
	if (username) Object.assign(s.doc, { loggedin: true, username, realname: username });
	return s;
}

/** Calls the endpoint and returns the JSON body. */
const call = async (s: Awaited<ReturnType<typeof session>>) =>
	(await plugin.bestSubmission(ltiEvent(URL, { session: s }))).json();

/** Stores a submission of alice and makes it her evaluated one. */
async function evaluated(taskid: string, input: Record<string, unknown>, result = 'success') {
	const { insertedId } = await env.db.c.submissions.insertOne({
		courseid: 'lti_test',
		taskid,
		username: ['alice'],
		status: 'done',
		result,
		grade: 100,
		submitted_on: new Date('2024-01-02T03:04:05Z'),
		input: await env.db.putInput(input),
		stdout: 'secret',
		user_ip: '1.2.3.4'
	} as never);
	await env.db.c.userTasks.updateOne(
		{ courseid: 'lti_test', taskid, username: 'alice' },
		{ $set: { submissionid: insertedId } },
		{ upsert: true }
	);
	return String(insertedId);
}

beforeAll(async () => {
	env = await setupLti();
	// A task with every summarized problem type (and a skipped file problem).
	mkdirSync(join(env.dir, 'lti_test', 'mixed'));
	writeFileSync(
		join(env.dir, 'lti_test', 'mixed', 'task.yaml'),
		`name: Mixed
context: Mixed *context*
environment_type: mcq
environment_id: mcq
problems:
  m:
    type: multiple_choice
    header: Many
    multiple: true
    choices: [{ text: A, valid: true }, { text: B, valid: true }, { text: C }]
  t:
    type: match
    header: Match
    answer: x
  c:
    type: code
    language: python
  f:
    type: file
    header: File
`
	);
});
afterAll(() => env.cleanup());
beforeEach(async () => {
	await env.db.c.submissions.deleteMany({});
	await env.db.c.userTasks.deleteMany({});
	await resetPlugins().load([{ plugin_module: plugin.MODULE }], { [plugin.MODULE]: async () => plugin });
});

describe('ltibestsubmission', () => {
	it('SITE-20 returns the evaluated submission with the question/answer summary (whitelisted fields)', async () => {
		const id = await evaluated('mcq1', { q1: '0', '@email': 'alice@x' });
		const body = await call(await session('mcq1', 'alice'));
		expect(body).toEqual({
			status: 'success',
			submission: {
				_id: id,
				courseid: 'lti_test',
				taskid: 'mcq1',
				status: 'done',
				result: 'success',
				grade: 100,
				submitted_on: '2024-01-02T03:04:05.000Z',
				input: { q1: '0', '@email': 'alice@x' }
			},
			question_answer: [{ question: 'Pick the right one', answer: 'Right', success: true, type: 'mcq' }],
			task_context: expect.stringContaining('A task for LTI tests.')
		});
	});

	it('SITE-20 summarizes multiple choice (several answers), match and code problems; skips files', async () => {
		await evaluated('mixed', { m: ['0', '2'], t: 'x', c: 'print(1)', f: { filename: 'a.txt', value: 'zz' } }, 'failed');
		const body = await call(await session('mixed', 'alice'));
		expect(body.question_answer).toEqual([
			{ question: 'Many', answer: ['A', 'C'], success: false, type: 'mcq' },
			{ question: 'Match', answer: 'x', success: false, type: 'match' },
			{ question: '', answer: 'print(1)', success: false, type: 'code' }
		]);
		expect(body.submission.input.f).toEqual({ filename: 'a.txt', value: '' });
		expect(body.task_context).toBe('Mixed *context*');
		await evaluated('mixed', { m: ['1', '0'], t: 'x', c: '' });
		expect((await call(await session('mixed', 'alice'))).question_answer[0]).toMatchObject({ success: true });
		await evaluated('mixed', { m: '9', t: 'x', c: '' });
		expect((await call(await session('mixed', 'alice'))).question_answer[0]).toMatchObject({
			answer: [''],
			success: false
		});
	});

	it('SITE-20 no evaluated submission → null; unbound → error; no LTI session or plugin disabled → 404', async () => {
		expect(await call(await session('mcq1', 'alice'))).toEqual({ status: 'success', submission: null });
		expect(await call(await session('mcq1'))).toEqual({ status: 'error', message: 'user not bound with lti' });
		const normal = env.sessions.create();
		expect((await settle(() => plugin.bestSubmission(ltiEvent(URL, { session: normal })))).status).toBe(404);
		resetPlugins();
		expect((await settle(async () => call(await session('mcq1', 'alice')))).status).toBe(404);
	});

	it('LTI-14 LTI 1.3 sessions are checked like every LTI page (deployment secret)', async () => {
		const s = await session('mcq1', 'alice', {
			version: '1.3',
			platform_instance_id: 'https://platform.example/tool-client-1/dep-1',
			course_secret: 'WRONG'
		});
		expect((await settle(() => call(s))).status).toBe(403);
		s.doc.lti!.course_secret = 's3cr3t';
		await evaluated('mcq1', { q1: '1' }, 'failed');
		expect((await call(s)).question_answer).toEqual([
			{ question: 'Pick the right one', answer: 'Wrong', success: false, type: 'mcq' }
		]);
	});
});
