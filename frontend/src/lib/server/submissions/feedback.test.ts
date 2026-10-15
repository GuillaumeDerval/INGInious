import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { setupTask, type TaskEnv } from '../../../../tests/fixtures/task/setup.js';
import { getCourse, type Course } from '../courses/course.js';
import { plugins, resetPlugins } from '../plugins/index.js';
import * as f from './feedback.js';
import type { Submission } from './manager.js';

let env: TaskEnv;
let course: Course;
beforeAll(async () => {
	env = await setupTask();
	course = getCourse('task_showcase');
});
afterAll(() => env.cleanup());

/** A stored-like submission. */
const sub = (extra: Partial<Submission> = {}): Submission => ({
	_id: new ObjectId(),
	courseid: 'task_showcase',
	taskid: 'code_python',
	username: ['alice'],
	input: new ObjectId(),
	status: 'done',
	submitted_on: new Date('2024-01-01T00:00:00Z'),
	grade: 37.5,
	result: 'failed',
	text: 'Global *text*',
	problems: {},
	tests: {},
	...extra
});

describe('feedback', () => {
	it('TASK-19 renders global and problem feedback, legacy strings and malformed entries', () => {
		const fb = f.renderFeedback(sub({ problems: { a: ['success', '**ok**'], b: 'old style', c: 42 as never } }), false);
		expect(fb.text).toContain('<em>text</em>');
		expect(fb.problems.a).toEqual(['success', expect.stringContaining('<strong>ok</strong>')]);
		expect(fb.problems.b[0]).toBe('failed');
		expect(fb.problems.c).toEqual(['crash', expect.stringContaining('Feedback is badly formatted.')]);
		expect(f.renderFeedback(sub({ problems: undefined, result: undefined, text: '' }), true).text).toBe('');
	});

	it('TASK-09 titles of every result', () => {
		expect(f.resultTitle('failed', 37.5)).toBe('There are some errors in your answer. Your score is 37.5%.');
		expect(f.resultTitle('success', 100)).toContain('passed the tests');
		expect(f.resultTitle('timeout', 0)).toContain('timed out');
		expect(f.resultTitle('overflow', 0)).toContain('overflow');
		expect(f.resultTitle('killed', 0)).toBe('Your submission was killed.');
		expect(f.resultTitle('crash', 0)).toContain('An internal error occurred');
	});

	it('TASK-09 waiting texts follow the queue position', () => {
		const q = env.backend.queueInfo;
		q.set('a', [-1, 0]).set('b', [-1, 12]).set('c', [0, 0]).set('d', [1, 5]).set('e', [4, 5]);
		expect(f.waitingText(undefined)).toContain('Your submission has been sent');
		expect(f.waitingText('a')).toContain('almost done');
		expect(f.waitingText('b')).toContain('12 seconds');
		expect(f.waitingText('c')).toContain('next in the waiting queue');
		expect(f.waitingText('d')).toContain('one task in front');
		expect(f.waitingText('e')).toContain('4 tasks');
	});

	it('TASK-20 filters tags by visibility and role', () => {
		const tests = {
			skill_loop: true,
			skill_hidden: true,
			misc_off_by_one: false,
			cat_basics: true,
			'*auto-tag-1': 'auto',
			unknown: true
		};
		expect(f.visibleTests(tests, course, false)).toEqual({ skill_loop: true, misc_off_by_one: false });
		expect(f.visibleTests(tests, course, true)).toEqual({
			skill_loop: true,
			skill_hidden: true,
			misc_off_by_one: false,
			'*auto-tag-1': 'auto'
		});
		expect(f.visibleTests(undefined, course, true)).toEqual({});
		expect(f.summarize(sub({ tests }), course, false)).toMatchObject({
			tags: ['Loops'],
			grade: 37.5,
			submittedOn: '2024-01-01T00:00:00.000Z'
		});
		expect(f.summarize(sub({ result: undefined, grade: undefined as never }), course, false)).toMatchObject({
			result: 'crash',
			grade: 0
		});
		// A waiting submission (stored result: the "crash" default) is not shown as a crash.
		expect(f.summarize(sub({ status: 'waiting', result: 'crash' }), course, false).result).toBe('waiting');
	});

	it('TASK-21 truncates long strings of the debug dump', () => {
		expect(f.debugDump({ a: 'x'.repeat(1001), b: { c: 'y' }, ssh_host: 'h', ssh_password: 'secret' })).toEqual({
			a: `${'x'.repeat(1000)} <truncated>`,
			b: { c: 'y' },
			ssh_host: 'h'
		});
	});

	it('TASK-09/10/12/21 builds the JSON for viewers', async () => {
		resetPlugins();
		plugins().addHook('feedback_title', (a: { title: string }) => ({ ...a, title: `${a.title}!` }));
		const input = await env.db.putInput({ code: 'x', upload: { filename: 'a.txt', value: Buffer.from('abc') } });
		const done = sub({ input, tests: { skill_hidden: true } });
		const student = await f.submissionToJson(
			done,
			course,
			{ staff: false, admin: false, username: 'alice' },
			{ replace: true }
		);
		expect(student).toMatchObject({
			status: 'done',
			result: 'failed',
			grade: 37.5,
			replace: true,
			tests: {},
			title: expect.stringMatching(/37\.5%\.!$/)
		});
		expect(student).not.toHaveProperty('debug');
		const admin = await f.submissionToJson(
			done,
			course,
			{ staff: true, admin: true, username: 'root' },
			{ replace: false, reloading: true }
		);
		expect(admin.tests).toEqual({ skill_hidden: true });
		expect(admin.debug).toMatchObject({ grade: 37.5, input: String(input) });
		expect(admin.input).toEqual({ code: 'x', upload: { filename: 'a.txt', value: '' } });
		const waiting = await f.submissionToJson(
			sub({ status: 'waiting', ssh_host: 'h', ssh_port: 22, ssh_user: 'u', ssh_password: 'p' }),
			course,
			{ staff: false, admin: false, username: 'alice' },
			{ replace: false }
		);
		expect(waiting).toMatchObject({
			status: 'waiting',
			result: 'waiting',
			title: '',
			ssh: { host: 'h', port: 22, user: 'u', password: 'p' }
		});
		expect(waiting.text).toContain('SSH server active');
		// TASK-12: the SSH access is only sent to the user who launched the debug job; never in the debug dump.
		const debugJob = sub({ status: 'waiting', ssh_host: 'h', ssh_port: 22, ssh_user: 'u', ssh_password: 'p' });
		const other = await f.submissionToJson(
			debugJob,
			course,
			{ staff: true, admin: true, username: 'root' },
			{
				replace: false
			}
		);
		expect(other).not.toHaveProperty('ssh');
		expect(other.text).not.toContain('SSH server active');
		expect(other.debug).toMatchObject({ ssh_host: 'h', ssh_user: 'u' });
		expect(other.debug).not.toHaveProperty('ssh_password');
		const queued = await f.submissionToJson(
			sub({ status: 'waiting', result: undefined, grade: undefined as never }),
			course,
			{ staff: false, admin: false, username: 'alice' },
			{ replace: false }
		);
		expect(queued).toMatchObject({ grade: 0, text: expect.stringContaining('has been sent') });
		const crashed = await f.submissionToJson(
			sub({ status: 'error', result: undefined }),
			course,
			{ staff: false, admin: false, username: 'alice' },
			{ replace: false }
		);
		expect(crashed.result).toBe('crash');
		resetPlugins();
	});
});
