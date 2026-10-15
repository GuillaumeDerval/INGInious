/** Component tests of the people & results pages (CSTU-01..17) with loaded data. */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Students from './+page.svelte';
import Audience from '../edit/audience/[audienceid]/+page.svelte';
import Student from '../student/[username]/+page.svelte';
import Submissions from '../submissions/+page.svelte';
import Stats from '../stats/+page.svelte';
import Submission from '../../../submission/[submissionid]/+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://x/admin/c/submissions?users=bob&page=2') } }));

const layout = { adminCourse: { id: 'c', name: 'Course C' }, user: { realname: 'Ann Admin' } };
const member = {
	username: 'bob',
	realname: 'Bob',
	email: 'bob@x.org',
	task_tried: 2,
	task_succeeded: 1,
	total_tries: 3,
	grade: 40,
	task_grades: {}
};
const audiences = [{ id: 'a1', description: 'Lab', students: ['bob'], tutors: ['tut'], tried: 1, done: 0, mine: true }];
const groups = {
	groups: [{ id: 'g1', description: 'G1', size: 2, members: [{ value: 'bob', label: 'Bob (bob)' }], audiences: [] }],
	audiences: [],
	ungrouped: 0,
	matching: 1,
	page: 1,
	pages: 1
};
/** A page of a list (server pagination). */
const paged = <T>(rows: T[], pages = 1) => ({ rows, matching: rows.length, page: 1, pages });
const options = { users: [], audiences: [], tasks: [], org_categories: [], search: [] };
const query = { users: [], audiences: [], tasks: [], org_categories: [], show_id: false, show_tags: false };

describe('user management page', () => {
	const data = (tab: string, admin = true, q = '') => ({
		...layout,
		admin,
		tab,
		q,
		counts: { students: 1, staff: 1, audiences: 1, groups: 1 },
		staff: tab === 'staff' ? [{ ...member, username: 'ann', realname: '', email: '' }] : null,
		students: tab === 'students' ? paged([member], 2) : null,
		audiences: tab === 'audiences' ? { ...paged(audiences), ids: ['a1', 'a2'] } : null,
		groups: tab === 'groups' ? groups : null
	});
	it('CSTU-01/02 students tab with admin controls', async () => {
		render(Students, { data: data('students'), form: { message: 'Done.' } } as never);
		await expect.element(page.getByText('Number of students : 1')).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Bob', exact: true }))
			.toHaveAttribute('href', '/admin/c/student/bob');
		await expect.element(page.getByRole('button', { name: 'Add student' })).toBeVisible();
		await expect.element(page.getByText('Done.')).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '?users=bob&page=2');
		await page.getByRole('checkbox', { name: 'Select', exact: true }).click();
		await expect.element(page.getByText('1 selected')).toBeVisible();
		await page.getByRole('button', { name: 'Unregister selected' }).click();
		await expect.element(page.getByRole('alertdialog')).toBeVisible();
	});
	it('CSTU-01/02 search: matching count and "unregister the matching students"', async () => {
		render(Students, { data: data('students', true, 'bo') } as never);
		await expect.element(page.getByRole('searchbox')).toHaveValue('bo');
		await expect.element(page.getByText('1 results')).toBeVisible();
		await page.getByTitle('More actions').click();
		await page.getByRole('button', { name: 'Unregister the 1 matching students' }).click();
		await expect.element(page.getByRole('alertdialog')).toHaveTextContent('This will remove 1 students');
		render(Students, { data: { ...data('students', true, 'zz'), students: paged([]) } } as never);
		await expect.element(page.getByText('Nothing matches your search.')).toBeVisible();
	});
	it('CSTU-01 staff tab and tutor view', async () => {
		render(Students, { data: data('staff', false) } as never);
		await expect.element(page.getByRole('link', { name: 'ann' })).toBeVisible();
	});
	it('CSTU-04/06 audiences tab', async () => {
		render(Students, { data: data('audiences') } as never);
		await expect
			.element(page.getByRole('link', { name: 'Lab', exact: true }))
			.toHaveAttribute('href', '/admin/c/edit/audience/a1');
		await page.getByText('Import / export').click();
		await expect.element(page.getByText('Upload (will erase current repartition)')).toBeVisible();
		await expect.element(page.getByTitle('You tutor this audience')).toBeVisible();
	});
	it('CSTU-04 tutor views', async () => {
		render(Students, {
			data: {
				...data('audiences', false),
				counts: { students: 0, staff: 1, audiences: 1, groups: null },
				audiences: { ...paged([{ ...audiences[0], mine: false }]), ids: ['a1'] }
			}
		} as never);
		await expect.element(page.getByRole('link', { name: 'Lab', exact: true })).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Submissions of all audiences' }))
			.toHaveAttribute('href', '/admin/c/submissions?audiences=a1');
		render(Students, { data: { ...data('students', false), students: paged([]) } } as never);
		await expect.element(page.getByText('No student registered yet')).toBeVisible();
		render(Students, { data: { ...data('audiences', false, 'x'), audiences: { ...paged([]), ids: [] } } } as never);
		await expect.element(page.getByText('Nothing matches your search.')).toBeVisible();
	});
	it('CSTU-07/08 groups tab', async () => {
		render(Students, { data: data('groups') } as never);
		await expect.element(page.getByRole('heading', { name: 'G1' })).toBeVisible();
		await expect.element(page.getByText('Bob (bob)')).toBeVisible();
	});
});

describe('other pages', () => {
	it('CSTU-05 audience edition', async () => {
		render(Audience, {
			data: {
				...layout,
				audience: { id: 'a1', description: 'Lab', tutors: ['tut'], students: [{ value: 'bob', label: 'Bob (bob)' }] },
				staff: [{ value: 'tut', label: 'Tut (tut)' }]
			}
		} as never);
		await expect.element(page.getByRole('checkbox', { name: 'Tut (tut)' })).toBeChecked();
		await expect.element(page.getByText('Bob (bob)')).toBeVisible();
	});
	it('CSTU-09/10 student page', async () => {
		const tasks = [
			{ taskid: 't1', name: 'T1', status: 'failed', tried: 2, grade: 50, submissionid: 's1', visible: true },
			{ taskid: 't2', name: 'T2', status: 'notviewed', tried: 0, grade: 0, submissionid: null, visible: false }
		];
		const totals = { tasks: 2, succeeded: 0, attempted: 1, submissions: 2 };
		const list = { username: 'bob', realname: 'Bob', q: '', status: '', totals, matching: 2, page: 1, pages: 1 };
		render(Student, {
			data: { ...layout, ...list, rows: tasks },
			form: { message: 'Task state reset.' }
		} as never);
		await expect.element(page.getByText('0 / 2')).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'All', exact: true })).toHaveAttribute('aria-current', 'page');
		await expect
			.element(page.getByRole('link', { name: 'Succeeded' }))
			.toHaveAttribute('href', '?users=bob&status=succeeded');
		await expect.element(page.getByRole('link', { name: 'Failed (50%)' })).toHaveAttribute('href', '/submission/s1');
		await expect.element(page.getByText('Not served by the task dispenser')).toBeVisible();
		await expect.element(page.getByText('Task state reset.')).toBeVisible();
		await page.getByRole('button', { name: 'Reset state' }).first().click();
		await expect.element(page.getByRole('alertdialog')).toHaveTextContent('reset the state for T1');
		await page.getByRole('button', { name: 'Cancel' }).click();
		render(Student, {
			data: {
				...layout,
				...list,
				status: 'failed',
				rows: [
					{ ...tasks[0], status: 'succeeded', submissionid: null },
					{ ...tasks[1], status: 'notattempted', visible: true }
				]
			}
		} as never);
		await expect.element(page.getByRole('cell', { name: 'Not attempted (viewed)' })).toBeVisible();
		render(Student, { data: { ...layout, ...list, q: 'zz', rows: [], matching: 0 } } as never);
		await expect.element(page.getByText('Nothing matches your search.')).toBeVisible();
	});
	it('CSTU-11..14 submissions page', async () => {
		const row = {
			id: 's1',
			users: ['bob'],
			task: 'answer',
			userIds: ['bob'],
			taskid: 'answer',
			submittedOn: '2026-10-10T10:00:00Z',
			lastReplay: null,
			result: 'failed',
			grade: 0,
			eval: false,
			tags: []
		};
		render(Submissions, {
			data: {
				...layout,
				admin: true,
				query,
				options,
				rows: [row],
				count: 1,
				page: 2,
				pages: 3,
				error: 'Invalid dates',
				layouts: ['taskid/username']
			},
			form: { message: '1 selected submissions were set for replay.' }
		} as never);
		await expect.element(page.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '?users=bob&page=1');
		await expect.element(page.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '?users=bob&page=3');
		await expect.element(page.getByText('Invalid dates')).toBeVisible();
		await page.getByLabelText('Select all').click();
		await expect.element(page.getByRole('button', { name: 'Replay checked' })).toBeVisible();
		await page.getByRole('button', { name: 'Clear selection' }).click();
		await expect.element(page.getByRole('button', { name: 'Replay checked' })).not.toBeInTheDocument();
		render(Submissions, {
			data: {
				...layout,
				admin: false,
				query: { ...query, show_id: true, show_tags: true },
				options,
				rows: [],
				count: 0,
				page: 1,
				pages: 1,
				error: null,
				layouts: []
			}
		} as never);
		await expect.element(page.getByText('No submission matches the filters.')).toBeVisible();
	});
	it('CSTU-16/17 statistics page', async () => {
		const stats = {
			options,
			query: { ...query, stat: 'normal' },
			error: null,
			hourly: false,
			global: { total: 4, evalTotal: 2, evalSucceeded: 1 },
			tasks: [{ key: 'T1', id: 't1', submissions: 4, valid: 1 }],
			users: [{ key: 'bob', name: 'Bob B', submissions: 4, valid: 1 }],
			chart: { labels: ['2026-10-10T00:00:00.000Z'], all: [4], valid: [1], partial: true },
			tags: [
				{ name: 'Good', description: 'd', misconception: false, all: '25', best: '50' },
				{ name: 'Bad', description: 'd', misconception: true, all: '0', best: '0' }
			]
		};
		const data = (s: object | null) => ({
			...layout,
			tab: s ? 'submissions' : 'progress',
			stats: s,
			progress: s
				? null
				: Promise.resolve({
						rows: [{ id: 't1', name: 'T1', viewed: 1, attempted: 1, succeeded: 0, attempts: 2 }],
						page: 1,
						pages: 3
					})
		});
		render(Stats, { data: data(stats) } as never);
		await expect.element(page.getByText('25%').first()).toBeVisible();
		await expect.element(page.getByRole('cell', { name: '50%' })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Bob B' })).toHaveAttribute('href', '/admin/c/student/bob');
		// Ids in muted text under the names; the running day is explained.
		await expect.element(page.getByText('bob', { exact: true })).toBeVisible();
		await expect.element(page.getByText('t1', { exact: true })).toBeVisible();
		await expect.element(page.getByText('The dashed part is the current period, still in progress.')).toBeVisible();
		render(Stats, {
			data: data({ ...stats, global: { total: 0, evalTotal: 0, evalSucceeded: 0 }, tags: [], error: 'Invalid dates' })
		} as never);
		await expect.element(page.getByText('—')).toBeVisible();
		render(Stats, { data: data(null) } as never);
		await expect.element(page.getByRole('row', { name: /T1/ }).last()).toHaveTextContent('T11102');
		await expect.element(page.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '?users=bob&page=2');
		// Streamed progress: a spinner while it is computed, an error message if it fails.
		render(Stats, { data: { ...data(null), progress: new Promise(() => {}) } } as never);
		await expect.element(page.getByRole('status').filter({ hasText: 'Loading...' })).toBeVisible();
		render(Stats, { data: { ...data(null), progress: Promise.reject(new Error('down')) } } as never);
		await expect.element(page.getByText('An error occurred.')).toBeVisible();
	});
	it('CSTU-15 submission page', async () => {
		const base = {
			course: { id: 'c', name: 'Course C' },
			task: { id: 'answer', name: 'Answer' },
			user: { realname: 'Ann' },
			tags: [{ label: 'Good', tone: 'error', title: 'A misconception' }],
			debug: '{}'
		};
		const submission = {
			id: 's1234567890',
			status: 'done',
			result: 'failed',
			grade: 50,
			submittedOn: '2026-10-10T10:00:00Z',
			users: [{ username: 'bob', realname: 'Bob' }]
		};
		const inputs = [
			{ id: 'answer', name: 'The answer', defined: true, value: '42' },
			{ id: 'x', name: 'x', defined: false, value: 'y' }
		];
		render(Submission, {
			data: {
				...base,
				admin: true,
				submission,
				inputs,
				feedback: { text: '<p>Fine</p>', problems: { answer: ['failed', '<p>Per problem</p>'] } }
			}
		} as never);
		await page.getByText('Replay', { exact: true }).click();
		await expect.element(page.getByRole('button', { name: 'Replay/debug as Ann' })).toBeVisible();
		await expect.element(page.getByText('Per problem')).toBeVisible();
		await expect.element(page.getByTitle('A misconception')).toHaveTextContent('Good');
		await expect.element(page.getByText('This problem id is not defined in the task.')).toBeVisible();
		render(Submission, {
			data: {
				...base,
				admin: false,
				debug: null,
				submission: { ...submission, status: 'waiting', result: 'waiting' },
				inputs: [],
				feedback: null
			}
		} as never);
		await expect.element(page.getByText('This submission is being graded.')).toBeVisible();
	});
});
