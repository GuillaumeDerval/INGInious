// Component tests of the site area pages (rendering of their load data).
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Users from './administrator/users/+page.svelte';
import Taskless from './taskless_hello_world/+page.svelte';
import Boards from './scoreboard/[courseid]/+page.svelte';
import Board from './scoreboard/[courseid]/[scoreboardid]/+page.svelte';
import Contest from './contest/[courseid]/+page.svelte';
import ContestAdmin from './contest/[courseid]/admin/+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/state', () => ({ page: { status: 200 } }));

/** Renders a page with load data (and an optional action result). */
const show = (Page: unknown, data: Record<string, unknown>, form: unknown = null) =>
	render(Page as never, { data, form, params: {} } as never);
const rows = [
	{ username: 'root', realname: 'Root', email: 'r@x.org', pending: false, bindings: {} },
	{ username: 'pend', realname: '', email: 'p@x.org', pending: true, bindings: { github: '42' } },
	{ username: 'evil', realname: '<script>x</script>', email: 'e@x.org', pending: false, bindings: {} }
];

describe('site pages', () => {
	it('SITE-01..05 the user table shows users with their actions (none for the current user)', async () => {
		show(Users, { rows, me: 'root', q: '', page: 1, pages: 2 }, { message: 'User created.' });
		await expect.element(page.getByText('User created.')).toBeInTheDocument();
		await expect.element(page.getByText('<script>x</script>')).toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: 'pend' }).first()).toBeInTheDocument();
		await expect.element(page.getByText('42')).toBeInTheDocument();
		expect(page.getByRole('button', { name: 'Delete' }).all()).toHaveLength(2);
		expect(page.getByRole('button', { name: 'Activate' }).all()).toHaveLength(1);
		expect(page.getByRole('button', { name: 'Revoke access' }).all()).toHaveLength(1);
		await expect.element(page.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '?q=&page=2');
		await page.getByRole('button', { name: 'Activate' }).click();
		await expect.element(page.getByText('This will activate pend.')).toBeInTheDocument();
		document.body.innerHTML = '';
		show(Users, { rows: [], me: 'root', q: 'x', page: 2, pages: 2 });
		await expect.element(page.getByText('No user found.')).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '?q=x&page=1');
	});

	it('SITE-21 the taskless job page shows the form, then the result', async () => {
		show(Taskless, {});
		await expect.element(page.getByLabelText('Input your name')).toBeVisible();
		await expect.element(page.getByRole('status')).not.toBeInTheDocument();
		document.body.innerHTML = '';
		show(Taskless, {}, { result: 'success', feedback: 'Hello World! I am Bob' });
		await expect.element(page.getByRole('status')).toHaveTextContent('Hello World! I am Bob');
	});

	it('SITE-13 scoreboard pages list the boards and show a ranking', async () => {
		show(Boards, { id: 'c', course: 'C', boards: ['One', 'Two'] });
		await expect.element(page.getByRole('link', { name: 'Two' })).toHaveAttribute('href', '/scoreboard/c/1');
		document.body.innerHTML = '';
		show(Board, {
			id: 'c',
			course: 'C',
			name: 'One',
			header: ['', 'Student(s)', 'Score'],
			rows: [[{ v: 1 }, { v: 'Alice' }, { v: 20 }]],
			emphasis: [2]
		});
		await expect.element(page.getByRole('heading', { name: 'One', level: 1 })).toBeVisible();
		await expect.element(page.getByRole('cell', { name: 'Alice' })).toBeVisible();
	});

	it('SITE-14 contest scoreboard and settings pages', async () => {
		const contest = {
			id: 'c',
			course: 'C',
			header: ['Rank'],
			rows: [],
			emphasis: [],
			activity: [],
			start: '2026-01-01T10:00:00Z',
			end: '2026-01-01T15:00:00Z'
		};
		show(Contest, { ...contest, started: false, finished: false });
		await expect.element(page.getByText('Contest has not started yet.')).toBeVisible();
		document.body.innerHTML = '';
		show(Contest, { ...contest, started: true, finished: false });
		await expect.element(page.getByText('The scoreboard will refresh every 30 seconds.')).toBeVisible();
		await expect.element(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
		document.body.innerHTML = '';
		show(ContestAdmin, {
			id: 'c',
			course: 'C',
			settings: { enabled: true, start: '2026-01-01 10:00:00', end: '2026-01-01 15:00:00', blackout: 1, penalty: 20 }
		});
		await expect.element(page.getByLabelText('Contest starts')).toHaveValue('2026-01-01 10:00:00');
		await expect.element(page.getByLabelText('Penalty for wrong submissions (in minutes)')).toHaveValue(20);
		await expect.element(page.getByRole('checkbox')).toBeChecked();
	});
});
