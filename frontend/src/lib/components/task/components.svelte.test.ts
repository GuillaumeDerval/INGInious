// Component tests of the task page building blocks (TASK-01..21).
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { SafeHtml } from '#lib/utils/safe-html.js';
import ProblemCard from './ProblemCard.svelte';
import TaskInfo from './TaskInfo.svelte';
import SubmissionHistory from './SubmissionHistory.svelte';
import SubmissionResult from './SubmissionResult.svelte';
import TaskTags from './TaskTags.svelte';
import DebugInfo from './DebugInfo.svelte';
import * as client from './task-client.js';
import { loading } from '#lib/components/layout/loading.svelte.js';
import type { ProblemData, SubmissionJson, TaskInfoData } from './types.js';

const html = (s: string) => s as SafeHtml;
const problem = (extra: Partial<ProblemData>): ProblemData => ({
	id: 'q',
	type: 'code_single_line',
	title: 'Question',
	header: html('<p>Header</p>'),
	...extra
});
const info: TaskInfoData = {
	author: 'Me',
	contactUrl: 'mailto:a@b',
	deadline: null,
	neverAccessible: false,
	pastSoftDeadline: false,
	status: 'notattempted',
	grade: 12.345,
	tried: 2,
	limit: { amount: -1, period: -1 },
	categories: ['c1', 'c2'],
	left: null
};
const submission = (extra: Partial<SubmissionJson> = {}): SubmissionJson => ({
	id: 'abc',
	status: 'done',
	result: 'success',
	grade: 100,
	submittedOn: '2024-01-01T00:00:00Z',
	title: 'Passed!',
	text: html('<p>Bravo</p>'),
	problems: {},
	tests: {},
	replace: true,
	...extra
});

describe('ProblemCard', () => {
	it('TASK-03/06 renders a text input with its feedback', async () => {
		render(ProblemCard, { problem: problem({}), value: 'hel', feedback: ['success', html('<p>Correct word.</p>')] });
		await expect.element(page.getByRole('heading', { name: 'Question' })).toBeVisible();
		await expect.element(page.getByText('Correct word.')).toBeVisible();
		const input = page.getByRole('textbox', { name: 'Question' });
		await expect.element(input).toHaveValue('hel');
		await input.fill('hello ');
		await expect.element(input).toHaveValue('hello ');
	});

	it('TASK-02 renders a code editor with a hidden input', async () => {
		const { container } = render(ProblemCard, {
			problem: problem({ type: 'code', title: '', language: 'python' }),
			value: 'def f(): pass',
			feedback: ['timeout', html('<p>slow</p>')]
		});
		await expect.element(page.getByText('slow')).toBeVisible();
		expect((container.querySelector('input[name=q]') as HTMLInputElement).value).toBe('def f(): pass');
	});

	it('TASK-05 single and multiple choices', async () => {
		const choices = [
			{ index: 2, html: html('<p>Two</p>') },
			{ index: 0, html: html('<p>Zero</p>') }
		];
		const single = render(ProblemCard, { problem: problem({ type: 'multiple_choice', choices }), value: '' });
		await page.getByRole('radio', { name: 'Zero' }).click();
		await expect.element(page.getByRole('radio', { name: 'Zero' })).toBeChecked();
		single.unmount();
		render(ProblemCard, { problem: problem({ type: 'multiple_choice', multiple: true, choices }), value: ['2'] });
		await expect.element(page.getByRole('checkbox', { name: 'Two' })).toBeChecked();
		await page.getByRole('checkbox', { name: 'Zero' }).click();
		await page.getByRole('checkbox', { name: 'Two' }).click();
		await expect.element(page.getByRole('checkbox', { name: 'Two' })).not.toBeChecked();
		await expect.element(page.getByRole('checkbox', { name: 'Zero' })).toBeChecked();
	});

	it('TASK-04 file upload with the previously submitted file', async () => {
		render(ProblemCard, {
			problem: problem({ type: 'file', allowedExts: ['.txt', '.py'], maxSize: 1024 }),
			value: '',
			filename: 'a.txt',
			downloadUrl: '/dl'
		});
		await expect.element(page.getByText('Allowed extensions: .txt, .py')).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: /download the file you submitted previously \(a\.txt\)/ }))
			.toHaveAttribute('href', '/dl');
	});

	it('TASK-04 file upload without size limit', async () => {
		render(ProblemCard, { problem: problem({ type: 'file', title: '', allowedExts: [] }), value: '' });
		await expect.element(page.getByText('Allowed extensions:')).toBeVisible();
	});
});

describe('TaskInfo', () => {
	it('TASK-01 shows the task facts as an info card', async () => {
		render(TaskInfo, { info, courseId: 'c', group: { description: 'Team A' } });
		await expect.element(page.getByText('Not yet attempted')).toBeVisible();
		await expect.element(page.getByTestId('task-grade')).toHaveTextContent('12.35%');
		await expect.element(page.getByText('No limitation')).toBeVisible();
		await expect.element(page.getByTestId('deadline')).toHaveTextContent('No deadline');
		await expect.element(page.getByText('c2')).toBeVisible();
		await expect.element(page.getByText('Author(s)')).toBeVisible();
		await expect.element(page.getByText('Me', { exact: true })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Contact link' })).toHaveAttribute('href', 'mailto:a@b');
		await expect.element(page.getByRole('link', { name: 'Group: Team A' })).toHaveAttribute('href', '/group/c');
		await expect.element(page.getByTestId('grade-source')).toHaveTextContent('Grade of your best submission');
	});

	it('TASK-01 states that the grade is the one of the last submission', async () => {
		render(TaskInfo, { info, courseId: 'c', mode: 'last' });
		await expect.element(page.getByTestId('grade-source')).toHaveTextContent('Grade of your last submission');
	});

	it('TASK-14/16/18 limits, deadlines and missing group', async () => {
		const r = render(TaskInfo, {
			courseId: 'c',
			group: { description: null },
			info: {
				...info,
				author: '',
				contactUrl: null,
				status: null,
				categories: [],
				limit: { amount: 1, period: 2 },
				left: 0,
				deadline: '2021-01-01T00:00:00Z',
				pastSoftDeadline: true
			}
		});
		await expect.element(page.getByText('0 submissions left (1 submissions every 2 hour(s))')).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Group: Group management' })).toBeVisible();
		await expect.element(page.getByText('Attempts')).not.toBeInTheDocument();
		r.unmount();
		render(TaskInfo, {
			courseId: 'c',
			info: { ...info, status: 'waiting', limit: { amount: 2, period: -1 }, left: 1, neverAccessible: true }
		});
		await expect.element(page.getByText('1 submissions left (2 submissions)')).toBeVisible();
		await expect.element(page.getByTestId('deadline')).toHaveTextContent("It's too late");
	});
});

describe('SubmissionHistory', () => {
	it('TASK-10 lists submissions, marks the evaluated one and reloads the clicked one', async () => {
		const onselect = vi.fn();
		const subs = [
			{ id: 's2', status: 'waiting', result: 'crash', grade: 0, submittedOn: '2024-01-02T00:00:00Z', tags: [] },
			{ id: 's1', status: 'done', result: 'success', grade: 100, submittedOn: '2024-01-01T00:00:00Z', tags: ['Loops'] }
		];
		const onmore = vi.fn();
		const r = render(SubmissionHistory, {
			submissions: subs,
			count: 30,
			more: true,
			evaluated: 's1',
			mode: 'last',
			onselect,
			onmore
		});
		await expect.element(page.getByText('30')).toBeVisible();
		await page.getByRole('button', { name: 'Load older submissions' }).click();
		expect(onmore).toHaveBeenCalled();
		await expect.element(page.getByTestId('evaluated')).toHaveTextContent('Last submission');
		// Nothing is displayed yet: no entry is current.
		await expect.element(page.getByTestId('displayed')).not.toBeInTheDocument();
		await expect.element(page.getByTitle('Loops').first()).toHaveTextContent('1');
		await page.getByTestId('history').getByText('Waiting').click();
		expect(onselect).toHaveBeenCalledWith('s2');
		r.unmount();
		render(SubmissionHistory, { submissions: subs, count: 2, evaluated: 's1', mode: 'best', onselect });
		await expect.element(page.getByTestId('evaluated')).toHaveTextContent('Best submission');
	});

	it('TASK-10 marks the displayed submission', async () => {
		const subs = [
			{ id: 's2', status: 'done', result: 'failed', grade: 0, submittedOn: '2024-01-02T00:00:00Z', tags: [] },
			{ id: 's1', status: 'done', result: 'success', grade: 100, submittedOn: '2024-01-01T00:00:00Z', tags: [] }
		];
		const props = { submissions: subs, count: 2, evaluated: 's1', mode: 'best' as const, onselect: () => {} };
		const r = render(SubmissionHistory, { ...props, current: 's2' });
		const entry = (id: string) => page.getByTestId('history').element().querySelector(`[data-submission="${id}"]`)!;
		expect(entry('s2').getAttribute('aria-current')).toBe('true');
		expect(entry('s1').hasAttribute('aria-current')).toBe(false);
		expect(entry('s2').querySelector('[data-testid="displayed"]')?.textContent).toBe('Displayed');
		r.unmount();
		// The evaluated submission can be the displayed one: both markers.
		render(SubmissionHistory, { ...props, current: 's1' });
		expect(entry('s1').getAttribute('aria-current')).toBe('true');
		expect(entry('s1').textContent).toContain('Displayed');
		expect(entry('s1').textContent).toContain('Best submission');
	});

	it('TASK-10 empty history', async () => {
		render(SubmissionHistory, { submissions: [], count: 0, evaluated: null, mode: 'best', onselect: () => {} });
		await expect.element(page.getByText(/No submission yet/)).toBeVisible();
	});
});

describe('SubmissionResult', () => {
	it('TASK-09 shows a graded result', async () => {
		render(SubmissionResult, { submission: submission() });
		await expect.element(page.getByText('Passed!')).toBeVisible();
		await expect.element(page.getByText('Bravo')).toBeVisible();
		await expect.element(page.getByText('Submission #abc')).toBeVisible();
		await expect.element(page.getByTestId('result-date')).toHaveTextContent(/^Submitted on \w+/);
		await expect.element(page.getByTestId('result-date').getByText('Best submission')).not.toBeInTheDocument();
	});

	it('TASK-09 marks the evaluated submission', async () => {
		const r = render(SubmissionResult, { submission: submission(), evaluated: 'best' });
		await expect.element(page.getByTestId('result-date').getByText('Best submission')).toBeVisible();
		r.unmount();
		render(SubmissionResult, { submission: submission(), evaluated: 'last' });
		await expect.element(page.getByTestId('result-date').getByText('Last submission')).toBeVisible();
	});

	it('TASK-11/12 waiting with kill button and SSH instructions (with and without webterm)', async () => {
		const onkill = vi.fn();
		const ssh = { host: 'h', port: 2222, user: 'worker', password: 'pw' };
		const r = render(SubmissionResult, {
			submission: submission({ status: 'waiting', result: 'waiting', text: html('<b>SSH server active</b>'), ssh }),
			onkill,
			webterm: 'https://term'
		});
		await page.getByRole('button', { name: 'Kill' }).click();
		expect(onkill).toHaveBeenCalled();
		await expect
			.element(page.getByTitle('SSH console'))
			.toHaveAttribute('src', 'https://term?host=h&port=2222&password=pw');
		await expect
			.element(
				page.getByText(
					'ssh worker@h -p 2222 -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o PreferredAuthentications=password'
				)
			)
			.toBeVisible();
		r.unmount();
		render(SubmissionResult, { submission: submission({ status: 'waiting', result: 'waiting', ssh }) });
		await expect.element(page.getByText('Paste this command into your terminal:')).toBeVisible();
	});
});

describe('TaskTags and DebugInfo', () => {
	it('TASK-20 shows the tags of the result', async () => {
		const tags = [
			{ id: 'skill', name: 'Loops', type: 0 },
			{ id: 'misc', name: 'Off-by-one', type: 1 },
			{ id: 'none', name: 'Never', type: 0 }
		];
		render(TaskTags, {
			tags,
			tests: { skill: true, misc: true, none: false, '*auto-tag-1': 'a'.repeat(30), '*auto-tag-2': 'short' }
		});
		await expect.element(page.getByText('Loops')).toBeVisible();
		await expect.element(page.getByText('Off-by-one')).toBeVisible();
		await expect.element(page.getByText('Never')).not.toBeInTheDocument();
		await expect.element(page.getByText(`${'a'.repeat(28)}…`)).toBeVisible();
		await expect.element(page.getByText('short')).toBeVisible();
	});

	it('TASK-20 renders nothing without tags', async () => {
		const { container } = render(TaskTags, { tags: [], tests: {} });
		expect(container.textContent?.trim()).toBe('');
	});

	it('TASK-21 displays the raw data as text', async () => {
		render(DebugInfo, { data: { stdout: '<b>out</b>', custom: { passed: 1 }, username: ['a', 'b'] } });
		await page.getByText('Debug information').click();
		await expect.element(page.getByText('<b>out</b>')).toBeVisible();
		await expect.element(page.getByText('a, b')).toBeVisible();
		await expect.element(page.getByText('passed')).toBeVisible();
	});
});

describe('task-client', () => {
	it('maps results to alert kinds', () => {
		expect(['success', 'waiting', 'timeout', 'killed', 'crash'].map(client.alertKind)).toEqual([
			'success',
			'info',
			'warning',
			'warning',
			'error'
		]);
	});

	it('validates answers', () => {
		const form = document.createElement('form');
		form.innerHTML = '<input type="file" name="f">';
		const problems = [problem({ id: 'a' }), problem({ id: 'b', optional: true }), problem({ id: 'f', type: 'file' })];
		expect(client.validateAnswers(problems.slice(0, 2), { a: '', b: '' }, form)).toBe(
			'Please answer to all the questions.'
		);
		expect(client.validateAnswers(problems.slice(0, 2), { a: 'x', b: '' }, form)).toBeNull();
		expect(client.validateAnswers(problems, { a: 'x', b: '' }, form)).toBe('Please answer to all the questions.');
	});

	it('saves and loads answers', () => {
		localStorage.clear();
		expect(client.loadAnswers('c', 't')).toBeNull();
		client.saveAnswers('c', 't', { a: 'x' });
		expect(client.loadAnswers('c', 't')).toEqual({ a: 'x' });
		localStorage.setItem('c/t', '{bad');
		expect(client.loadAnswers('c', 't')).toBeNull();
		expect([client.inputToAnswer('x'), client.inputToAnswer(['1']), client.inputToAnswer({})]).toEqual([
			'x',
			['1'],
			''
		]);
	});

	it('posts actions and reports network errors', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response('{"status":"ok"}'))
			.mockRejectedValueOnce(new Error('down'));
		vi.stubGlobal('fetch', fetch);
		const form = client.actionForm('check', { submissionid: '1' });
		expect(await client.postAction('/u', form)).toEqual({ status: 'ok' });
		expect(fetch.mock.calls[0][1].body.get('@action')).toBe('check');
		expect(await client.postAction('/u', form)).toEqual({ status: 'error', text: 'Internal error' });
		// The loading bar is shown during user actions, not during background polling.
		let release!: (r: Response) => void;
		fetch.mockReturnValueOnce(new Promise((r) => (release = r)));
		const action = client.postAction('/u', form);
		expect(loading.active).toBe(true);
		release(new Response('{"status":"ok"}'));
		await action;
		fetch.mockReturnValueOnce(new Promise((r) => (release = r)));
		const poll = client.postAction('/u', form, true);
		expect(loading.active).toBe(false);
		release(new Response('{"status":"ok"}'));
		await poll;
		vi.unstubAllGlobals();
	});
});
