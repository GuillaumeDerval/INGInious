/** Component tests of the people & results components (CSTU-01..17). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createRawSnippet } from 'svelte';
import Table from './Table.svelte';
import GroupsEditor from './GroupsEditor.svelte';
import QueryForm from './QueryForm.svelte';
import SubmissionTable from './SubmissionTable.svelte';
import StatsChart, { themeColor } from './StatsChart.svelte';
import { Chart } from 'chart.js';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

let submitted: Record<string, FormDataEntryValue[]> | null;
const capture = (e: Event) => {
	e.preventDefault();
	const data = new FormData(e.target as HTMLFormElement, (e as SubmitEvent).submitter);
	submitted = {};
	for (const [k, v] of data) (submitted[k] ??= []).push(v);
};
beforeEach(() => {
	submitted = null;
	document.addEventListener('submit', capture);
});
afterEach(() => document.removeEventListener('submit', capture));

describe('Table', () => {
	it('CSTU-01 searches, links, selects rows', async () => {
		const rows = [
			{ id: 'a', name: 'Alice', n: 1 },
			{ id: 'b', name: 'Bob', n: 2 }
		];
		const custom = createRawSnippet(() => ({ render: () => '<b>custom</b>' }));
		const actions = createRawSnippet(() => ({ render: () => '<i>act</i>' }));
		const form = document.createElement('form');
		document.body.append(form);
		render(Table, {
			target: form,
			props: {
				columns: [
					{ key: 'name', label: 'Name', href: (r: { id: string }) => (r.id === 'a' ? `/u/${r.id}` : null) },
					{ key: 'n', label: 'N', text: (r: { n: number }) => r.n * 10 },
					{ key: 'c', label: 'C', custom: true }
				],
				rows,
				custom,
				actions,
				select: (r: { id: string }) => r.id
			} as never
		});
		await expect.element(page.getByRole('link', { name: 'Alice' })).toHaveAttribute('href', '/u/a');
		await expect.element(page.getByText('20')).toBeVisible();
		await page.getByLabelText('Select all').click();
		expect([...form.querySelectorAll<HTMLInputElement>('input[name=selected]')].map((c) => c.checked)).toEqual([
			true,
			true
		]);
		await expect.element(page.getByText('2 selected')).toBeVisible();
		await page.getByLabelText('Select all').click();
		await expect.element(page.getByRole('toolbar')).not.toBeInTheDocument();
		await page.getByRole('searchbox').fill('zzz');
		await expect.element(page.getByText('Nothing matches your search.')).toBeVisible();
		await page.getByRole('searchbox').fill('bob');
		await expect.element(page.getByText('Alice')).not.toBeInTheDocument();
		await expect.element(page.getByText('custom')).toBeVisible();
		form.remove();
	});
	it('shows the first rows until "Show all" is clicked', async () => {
		render(Table, {
			columns: [{ key: 'x', label: 'X' }],
			rows: [{ x: 'r1' }, { x: 'r2' }, { x: 'r3' }],
			limit: 2,
			searchable: false
		});
		await expect.element(page.getByText('r3')).not.toBeInTheDocument();
		await page.getByRole('button', { name: 'Show all (3)' }).click();
		await expect.element(page.getByText('r3')).toBeVisible();
	});
	it('shows the empty state', async () => {
		render(Table, { columns: [{ key: 'x', label: 'X' }], rows: [], empty: 'Nothing here' });
		await expect.element(page.getByText('Nothing here')).toBeVisible();
	});
});

describe('GroupsEditor', () => {
	it('CSTU-07 shows a page of groups, edits one group in the side panel and confirms deletions', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json([{ value: 'eve', label: 'Eve (eve)' }]))
		);
		render(GroupsEditor, {
			groups: [
				{
					id: 'g1',
					description: 'G1',
					size: 1,
					audiences: ['a1', 'gone'],
					members: [
						{ value: 'bob', label: 'Bob (bob)' },
						{ value: 'ghost', label: 'ghost (ghost)' }
					]
				},
				{ id: 'g2', description: 'G2', size: 2, audiences: [], members: [] }
			],
			audiences: [{ id: 'a1', description: 'A1' }],
			ungrouped: 7,
			action: (name: string) => `?/${name}`,
			pickerUrl: '/students.json'
		});
		await expect.element(page.getByText('2/1')).toBeVisible();
		await expect.element(page.getByText('0/2')).toBeVisible();
		await expect.element(page.getByText('No member yet.')).toBeVisible();
		await expect.element(page.getByText('gone')).toBeVisible();
		await expect.element(page.getByText('7')).toBeVisible();
		// Edit G1: remove a member, add one found by the search (the size grows), toggle an audience
		// (unknown audience ids are dropped).
		await page.getByRole('button', { name: 'Edit group' }).first().click();
		const panel = page.getByRole('dialog', { name: 'Edit group' });
		await panel.getByRole('button', { name: 'Remove ghost (ghost)' }).click();
		await panel.getByRole('combobox').fill('ev');
		await panel.getByRole('option', { name: 'Eve (eve)' }).click();
		await panel.getByText('A1').click();
		await panel.getByRole('button', { name: 'Update' }).click();
		expect(JSON.parse(String(submitted!.groups[0]))).toEqual([
			{ id: 'g1', description: 'G1', size: 2, audiences: [], students: ['bob', 'eve'] }
		]);
		// New group, then cancel.
		await page.getByRole('button', { name: 'New group' }).click();
		await expect.element(panel.getByRole('textbox', { name: 'Description' })).toHaveValue('New group');
		await panel.getByRole('button', { name: 'Close' }).click();
		await page.getByRole('button', { name: 'New group' }).click();
		await panel.getByRole('button', { name: 'Cancel' }).click();
		// Destructive actions are confirmed and posted.
		await page.getByRole('button', { name: 'Delete group' }).nth(1).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
		expect(submitted).toEqual({ id: ['g2'] });
		await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
		await page.getByRole('button', { name: 'Clean groups' }).click();
		await expect.element(page.getByRole('alertdialog')).toHaveTextContent('removed from his group');
		await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
		await page.getByRole('button', { name: 'Delete all groups' }).click();
		await expect.element(page.getByRole('alertdialog')).toHaveTextContent('Every group');
		vi.unstubAllGlobals();
	});
	it('CSTU-07 empty page', async () => {
		render(GroupsEditor, { groups: [], audiences: [], ungrouped: 0, action: () => '', pickerUrl: '' });
		await expect.element(page.getByText('No group yet')).toBeVisible();
		await page.getByRole('button', { name: 'New group' }).click();
		await expect.element(page.getByText('Restrict to audiences')).not.toBeInTheDocument();
	});
});

describe('QueryForm', () => {
	const options = {
		users: [
			{ value: 'bob', label: 'Bob', mine: true },
			{ value: 'eve', label: 'Eve' }
		],
		audiences: [],
		tasks: [{ value: 't1', label: 'Task 1' }],
		org_categories: [],
		search: [] as ('users' | 'tasks')[]
	};
	const query = {
		users: ['eve'],
		audiences: [],
		tasks: [],
		org_categories: [],
		eval: true,
		crashes_only: false,
		grade_min: 5,
		grade_max: null,
		date_after: '',
		date_before: '',
		limit: null,
		sort_by: 'grade',
		order: 1,
		stat: 'normal'
	};
	it('CSTU-11 checks lists and submits the filters', async () => {
		render(QueryForm, { query, options });
		await page.getByText('Filters').click();
		const boxes = () => [...document.querySelectorAll<HTMLInputElement>('input[name=users]')].map((c) => c.checked);
		expect(boxes()).toEqual([false, true]);
		await page.getByRole('button', { name: 'Tutored only' }).click();
		expect(boxes()).toEqual([true, false]);
		await page.getByRole('button', { name: 'All (Students)' }).click();
		expect(boxes()).toEqual([true, true]);
		await page.getByRole('button', { name: 'None (Students)' }).click();
		expect(boxes()).toEqual([false, false]);
		await expect.element(page.getByText('Nothing to show.').first()).toBeInTheDocument();
		await page.getByRole('button', { name: 'Filter' }).click();
		expect(submitted).toMatchObject({ eval: ['on'], grade_min: ['5'], sort_by: ['grade'], order: ['1'] });
	});
	it('CSTU-11 searches the long lists on the server', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json([{ value: 't2', label: 'Task 2' }]))
		);
		render(QueryForm, {
			query: { ...query, tasks: ['t1', 'gone'] },
			options: { ...options, search: ['users', 'tasks'] }
		});
		await page.getByText('Filters').click();
		const values = (name: string) =>
			[...document.querySelectorAll<HTMLInputElement>(`input[type=hidden][name=${name}]`)].map((i) => i.value);
		expect([values('users'), values('tasks')]).toEqual([['eve'], ['t1', 'gone']]);
		await expect.element(page.getByText('gone')).toBeVisible();
		expect(page.getByRole('button', { name: 'All (Tasks)' }).elements()).toHaveLength(0);
		await page.getByRole('button', { name: 'None (Tasks)' }).click();
		expect(values('tasks')).toEqual([]);
		await page.getByRole('button', { name: 'Tutored only (Students)' }).click();
		expect(values('users')).toEqual(['bob']);
		await page.getByRole('combobox', { name: 'Tasks' }).fill('2');
		await page.getByRole('option', { name: 'Task 2' }).click();
		expect(values('tasks')).toEqual(['t2']);
		vi.unstubAllGlobals();
	});
	it('CSTU-17 statistics variant', async () => {
		render(QueryForm, { query, options, stats: true });
		await page.getByText('Filters').click();
		expect(document.querySelector('select[name=stat]')).not.toBeNull();
		await expect.element(page.getByText('Only evaluation submissions')).not.toBeInTheDocument();
	});
});

describe('SubmissionTable', () => {
	it('CSTU-11 renders the rows with their actions', async () => {
		const row = {
			id: 'abc',
			users: ['bob'],
			task: 'answer',
			userIds: ['bob'],
			taskid: 'answer',
			submittedOn: '2026-10-10T10:00:00Z',
			lastReplay: null,
			result: 'success',
			grade: 100,
			eval: true,
			tags: [{ label: 'Good', tone: 'success' as const, title: 'desc' }]
		};
		const form = document.createElement('form');
		document.body.append(form);
		render(SubmissionTable, {
			target: form,
			props: {
				rows: [row, { ...row, id: 'w', result: 'waiting', eval: false, users: ['Bob Name'], task: 'Answer task' }],
				base: '/admin/c',
				admin: true,
				showId: true,
				showTags: true
			}
		});
		await expect.element(page.getByRole('link', { name: 'abc' })).toHaveAttribute('href', '/submission/abc');
		await expect.element(page.getByTitle('Evaluation submission')).toBeVisible();
		await expect.element(page.getByText('Good').first()).toBeVisible();
		// Names are shown with their ids under them; ids shown alone are not repeated.
		await expect.element(page.getByText('Bob Name')).toBeVisible();
		await expect.element(page.getByText('Answer task')).toBeVisible();
		expect(page.getByText('bob', { exact: true }).elements()).toHaveLength(2);
		expect(page.getByText('answer', { exact: true }).elements()).toHaveLength(2);
		await page.getByRole('button', { name: 'Replay submission' }).first().click();
		expect(submitted!.submissionid).toEqual(['abc']);
		form.remove();
	});
});

describe('StatsChart', () => {
	it('CSTU-17 draws the line and bar charts with the theme colours', async () => {
		const series = (a: number[], v: number[]) => [
			{ label: 'All', data: a, color: 'primary' as const },
			{ label: 'Valid', data: v, color: 'success' as const }
		];
		const { unmount } = render(StatsChart, {
			labels: ['2026-10-10T00:00:00.000Z', '2026-10-11T00:00:00.000Z'],
			series: series([2, 3], [1, 0]),
			dates: 'day',
			summary: '5 submissions, 1 valid'
		});
		await expect.element(page.getByRole('img', { name: '5 submissions, 1 valid' })).toBeVisible();
		render(StatsChart, {
			labels: ['2026-10-10T00:00:00.000Z'],
			series: series([1], [1]),
			dates: 'hour',
			summary: 'hourly'
		});
		render(StatsChart, { labels: ['t1'], series: series([1], [1]), type: 'bar', horizontal: true, summary: 'bars' });
		await expect.element(page.getByRole('img', { name: 'bars' })).toBeVisible();
		unmount();
	});
	it('CSTU-17 labels every bar and dashes the running bucket', async () => {
		const series = (n: number) => [{ label: 'All', data: Array(n).fill(1), color: 'primary' as const }];
		const labels = Array.from({ length: 12 }, (_, i) => `Task number ${i} with a rather long name`);
		render(StatsChart, { labels, series: series(12), type: 'bar', horizontal: true, summary: 'bars' });
		const bars = page.getByRole('img', { name: 'bars' });
		await expect.element(bars).toBeVisible();
		// The chart grows with the bars (2.5rem each + 3rem) and every label is drawn, truncated.
		expect((bars.element() as HTMLElement).offsetHeight).toBe(33 * 16);
		const chart = Chart.getChart(bars.element().querySelector('canvas')!)!;
		expect(chart.scales.y.ticks).toHaveLength(12);
		const drawn = chart.scales.y.getLabelItems().map((item) => item.label);
		expect(drawn[0]).toBe('Task number 0 with a ra…');
		const dates = ['2026-10-13T00:00:00.000Z', '2026-10-14T00:00:00.000Z', '2026-10-15T00:00:00.000Z'];
		const dash = async (partial: boolean, summary: string) => {
			render(StatsChart, { labels: dates, series: series(3), dates: 'day', partial, summary });
			await expect.element(page.getByRole('img', { name: summary })).toBeVisible();
			const line = Chart.getChart(page.getByRole('img', { name: summary }).element().querySelector('canvas')!)!;
			const segment = line.data.datasets[0] as unknown as {
				segment: { borderDash: (ctx: { p1DataIndex: number }) => number[] | undefined };
			};
			return [1, 2].map((i) => segment.segment.borderDash({ p1DataIndex: i }));
		};
		expect(await dash(true, 'running')).toEqual([undefined, [5, 4]]);
		expect(await dash(false, 'complete')).toEqual([undefined, undefined]);
	});
	it('resolves theme colours to rgba', () => {
		expect(themeColor('rgb(10, 20, 30)', 0.5)).toBe('rgba(10, 20, 30, 0.5)');
	});
});
