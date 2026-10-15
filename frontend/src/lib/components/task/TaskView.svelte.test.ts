// Component tests of the whole task page (TASK-01/08/09/10/11/12/17/21).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import type { SafeHtml } from '#lib/utils/safe-html.js';
import TaskView from './TaskView.svelte';
import type { SubmissionJson, TaskPageData } from './types.js';

const html = (s: string) => s as SafeHtml;
const submission = (extra: Partial<SubmissionJson> = {}): SubmissionJson => ({
	id: 'n1',
	status: 'done',
	result: 'success',
	grade: 100,
	submittedOn: '2024-01-01T00:00:00Z',
	title: 'Passed!',
	text: html('<p>Bravo</p>'),
	problems: { word: ['failed', html('<p>Bad word</p>')] },
	tests: { skill: true },
	replace: true,
	...extra
});
const data = (extra: Partial<TaskPageData> = {}): TaskPageData => ({
	courseId: 'c',
	courseName: 'Course',
	taskId: 't',
	name: 'My task',
	context: html('<p>Statement</p>'),
	problems: [
		{ id: 'word', type: 'code_single_line', title: 'Question 1: Word', header: html(''), default: 'hel' },
		{
			id: 'pick',
			type: 'multiple_choice',
			title: 'Question 2: Pick',
			header: html(''),
			multiple: true,
			choices: [{ index: 0, html: html('<p>A</p>') }]
		},
		{ id: 'up', type: 'file', title: 'Question 3: Upload', header: html(''), allowedExts: ['.txt'], maxSize: 100 }
	],
	random: [0.5],
	username: 'alice',
	registered: true,
	staff: false,
	admin: false,
	blocked: null,
	registerUrl: null,
	info: {
		author: '',
		contactUrl: null,
		deadline: null,
		neverAccessible: false,
		pastSoftDeadline: false,
		status: 'notattempted',
		grade: 0,
		tried: 0,
		limit: { amount: -1, period: -1 },
		categories: [],
		left: null
	},
	evaluationMode: 'best',
	tags: [{ id: 'skill', name: 'Loops', type: 0 }],
	submissions: [
		{ id: 'old', status: 'done', result: 'failed', grade: 0, submittedOn: '2023-01-01T00:00:00Z', tags: [] }
	],
	more: false,
	submissionCount: 1,
	evaluated: 'old',
	waiting: null,
	group: null,
	prev: 'p',
	next: 'n',
	courseHidden: false,
	taskHidden: false,
	menu: [],
	webterm: null,
	...extra
});

/** Installs a fake fetch answering per action. */
function server(answers: Record<string, unknown[]>) {
	const calls: FormData[] = [];
	vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
		const body = init.body as FormData;
		calls.push(body);
		const list = answers[String(body.get('@action'))];
		const answer = list.length > 1 ? list.shift() : list[0];
		// Error answers come with an HTTP error status (403 refused submission, 404 unknown submission).
		return Response.json(answer, { status: (answer as { status: string }).status === 'error' ? 403 : 200 });
	});
	return calls;
}

/** Selects a file in the upload input. */
function selectFile(name: string) {
	const input = document.querySelector('input[type=file]') as HTMLInputElement;
	const transfer = new DataTransfer();
	transfer.items.add(new File(['x'], name));
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

afterEach(() => vi.unstubAllGlobals());

describe('TaskView', () => {
	it('TASK-08/09 validates, submits, polls and shows the result', async () => {
		const calls = server({
			submit: [{ status: 'ok', submissionid: 'n1', remove: ['old'] }],
			check: [
				{
					status: 'ok',
					submission: submission({ status: 'waiting', result: 'waiting', text: html('<b>Queued</b>'), problems: {} })
				},
				{ status: 'ok', submission: submission() }
			],
			kill: [{ status: 'done' }]
		});
		render(TaskView, { data: data(), pollMs: 1500 });
		await expect.element(page.getByText('Statement')).toBeVisible();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect.element(page.getByText('Please answer to all the questions.')).toBeVisible();
		await page.getByRole('checkbox', { name: 'A' }).click();
		selectFile('a.txt');
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect.element(page.getByText('Queued')).toBeVisible();
		await page.getByRole('button', { name: 'Kill' }).click();
		await expect.element(page.getByText('Passed!')).toBeVisible();
		await expect.element(page.getByText('Bad word')).toBeVisible();
		await expect.element(page.getByText('Loops').first()).toBeVisible();
		await expect.element(page.getByTestId('task-tries')).toHaveTextContent('1');
		await expect.element(page.getByTestId('task-status')).toHaveTextContent('Succeeded');
		const sent = calls[0];
		expect([
			sent.get('@action'),
			sent.get('word'),
			sent.getAll('pick'),
			sent.get('@random_0'),
			(sent.get('up') as File).name
		]).toEqual(['submit', 'hel', ['0'], '0.5', 'a.txt']);
		expect(calls.some((c) => c.get('@action') === 'kill')).toBe(true);
		expect(document.querySelector('[data-submission=old]')).toBeNull();
	});

	it('TASK-08 shows submission and polling errors', async () => {
		server({
			submit: [
				{ status: 'error', text: 'Not allowed' },
				{ status: 'ok', submissionid: 'n1', remove: [] }
			],
			check: [{ status: 'error', text: 'Internal error' }]
		});
		render(TaskView, { data: data({ problems: [data().problems[0]] }) });
		await page.getByRole('textbox').click();
		await userEvent.keyboard('{Control>}{Enter}{/Control}');
		await expect.element(page.getByText('Not allowed')).toBeVisible();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect.element(page.getByText('Internal error')).toBeVisible();
	});

	it('TASK-10 reloads an old submission, and a waiting one on load', async () => {
		const input = { word: 'hello', pick: ['0'], up: { filename: 'a.txt', value: '' } };
		server({
			load: [
				{
					status: 'ok',
					submission: submission({ id: 'w', status: 'waiting', result: 'waiting', replace: false, input })
				},
				{ status: 'ok', submission: submission({ id: 'old', result: 'failed', grade: 10, replace: false, input: {} }) },
				{ status: 'error', text: 'Gone' }
			],
			check: [{ status: 'ok', submission: submission({ id: 'w', replace: false }) }]
		});
		render(TaskView, {
			data: data({
				waiting: 'w',
				submissions: [
					{ id: 'w', status: 'waiting', result: 'crash', grade: 0, submittedOn: '2024-01-01T00:00:00Z', tags: [] },
					data().submissions[0]
				]
			})
		});
		await expect.element(page.getByRole('textbox', { name: 'Question 1: Word' })).toHaveValue('hello');
		await expect
			.element(page.getByRole('link', { name: /download the file/ }))
			.toHaveAttribute('href', '/course/c/t/$input/w/up');
		await expect.element(page.getByText('Passed!')).toBeVisible();
		// The followed submission is the displayed one; it is not the evaluated one (no badge).
		const current = () => document.querySelector('[data-testid="history"] [aria-current="true"]');
		expect(current()?.getAttribute('data-submission')).toBe('w');
		await expect.element(page.getByTestId('result-date').getByText('Best submission')).not.toBeInTheDocument();
		await page.getByTestId('history').getByText('Failed').click();
		await expect.element(page.getByRole('textbox', { name: 'Question 1: Word' })).toHaveValue('');
		// The reloaded evaluated submission is marked in the history and in the result card.
		await expect.poll(() => current()?.getAttribute('data-submission')).toBe('old');
		await expect.element(page.getByTestId('result-date').getByText('Best submission')).toBeVisible();
		await page.getByTestId('history').getByText('Failed').click();
		await expect.element(page.getByText('Gone')).toBeVisible();
	});

	it('TASK-10 loads older submissions page by page', async () => {
		const older = {
			id: 'o2',
			status: 'done',
			result: 'success',
			grade: 100,
			submittedOn: '2022-01-01T00:00:00Z',
			tags: []
		};
		const calls = server({
			history: [{ status: 'ok', submissions: [older], more: false }]
		});
		render(TaskView, { data: data({ more: true, submissionCount: 42 }) });
		const history = page.getByTestId('history');
		await expect.element(page.getByText('42')).toBeVisible();
		await page.getByRole('button', { name: 'Load older submissions' }).click();
		await expect.element(history.getByText('Succeeded')).toBeVisible();
		expect(calls[0].get('before')).toBe('old');
		await expect.element(page.getByRole('button', { name: 'Load older submissions' })).not.toBeInTheDocument();
		vi.unstubAllGlobals();
		server({ history: [{ status: 'error', text: 'Internal error' }] });
		render(TaskView, { data: data({ more: true }) });
		await page.getByRole('button', { name: 'Load older submissions' }).last().click();
		await expect.element(page.getByText('Internal error')).toBeVisible();
	});

	it('TASK-10 follows a waiting submission older than the loaded history', async () => {
		server({ load: [{ status: 'ok', submission: submission({ id: 'w9', input: {}, replace: false }) }] });
		render(TaskView, { data: data({ waiting: 'w9' }) });
		await expect.element(page.getByText('Passed!')).toBeVisible();
		expect(page.getByTestId('history').getByRole('button').elements()).toHaveLength(1);
	});

	it('TASK-01 saves and restores the answers locally', async () => {
		localStorage.clear();
		render(TaskView, { data: data() });
		await page.getByRole('button', { name: 'Load my work from memory' }).click();
		const input = page.getByRole('textbox', { name: 'Question 1: Word' });
		await input.fill('saved');
		await page.getByRole('button', { name: 'Save my work in memory' }).click();
		await input.fill('changed');
		await page.getByRole('button', { name: 'Load my work from memory' }).click();
		await expect.element(input).toHaveValue('saved');
	});

	it('TASK-01 uses a single centred column when the task has no statement', async () => {
		render(TaskView, { data: data({ context: html('') }) });
		await expect.element(page.getByRole('textbox', { name: 'Question 1: Word' })).toBeVisible();
		expect(page.getByRole('article').elements()).toHaveLength(0);
	});

	it('TASK-01/12/16/21 staff, admin, blocked and group variants', async () => {
		server({
			submit: [{ status: 'ok', submissionid: 'n1', remove: [] }],
			check: [{ status: 'ok', submission: submission({ debug: { stdout: 'OUT' } }) }]
		});
		const r = render(TaskView, {
			data: data({
				problems: [data().problems[0]],
				staff: true,
				admin: true,
				courseHidden: true,
				taskHidden: true,
				menu: [{ label: 'Board', href: '/b' }],
				prev: null,
				next: null
			})
		});
		await expect.element(page.getByText(/This course is currently invisible/)).toBeVisible();
		await page.getByText('Staff tools').click();
		await expect.element(page.getByRole('link', { name: 'Edit task' })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Board' })).toBeVisible();
		await page.getByRole('button', { name: 'SSH debug' }).click();
		await expect.element(page.getByText('Debug information')).toBeVisible();
		r.unmount();
		const g = render(TaskView, {
			data: data({
				blocked: 'Please enroll in the course to submit.',
				username: null,
				registered: false,
				group: { description: 'Team A' }
			})
		});
		await expect.element(page.getByRole('button', { name: 'Please enroll in the course to submit.' })).toBeDisabled();
		await expect.element(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Group: Team A' })).toBeVisible();
		g.unmount();
		render(TaskView, {
			data: data({ blocked: 'x', registerUrl: '/register/c', group: { description: null }, staff: true, menu: [] })
		});
		await expect.element(page.getByRole('link', { name: 'Enroll in the course' })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Group: Group management' })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Edit task' })).not.toBeInTheDocument();
	});

	it('LTI-05 LTI mode: actions go to the LTI URL, no navigation nor links to other pages', async () => {
		const urls: string[] = [];
		vi.stubGlobal(
			'fetch',
			async (url: string) => (urls.push(url), Response.json({ status: 'ok', submission: submission() }))
		);
		render(TaskView, {
			data: data({
				actionUrl: '/lti/task?session_id=tok',
				waiting: 'w1',
				staff: true,
				menu: [{ label: 'X', href: '/x' }]
			})
		});
		await expect.element(page.getByText('Passed!')).toBeVisible();
		expect(urls).toEqual(['/lti/task?session_id=tok']);
		expect(page.getByRole('link').elements()).toHaveLength(0);
		expect(page.getByText('Staff tools').elements()).toHaveLength(0);
	});
});
