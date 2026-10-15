// Component tests of the navigation components (NAV-08/10/12/16/18/21).
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import LastTried from './LastTried.svelte';
import TaskList from './TaskList.svelte';
import GroupCard from './GroupCard.svelte';
import StudentSide from './StudentSide.svelte';
import ImportForm from './ImportForm.svelte';
import DeadlineChip from './DeadlineChip.svelte';
import ListSearch from './ListSearch.svelte';
import { UI_PREFS_KEY } from '#lib/components/ui/prefs.js';
import type { SectionView, TaskItem } from './types.js';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

describe('LastTried', () => {
	it('NAV-21 shows the outcome of each entry in the dashboard strip', async () => {
		const item = (taskid: string, status: string, result: string) => ({
			courseid: 'c',
			taskid,
			courseName: 'C',
			taskName: taskid.toUpperCase(),
			status,
			result
		});
		render(LastTried, {
			items: [
				item('a', 'done', 'success'),
				item('b', 'done', 'save'),
				item('c', 'waiting', ''),
				item('d', 'error', '')
			],
			showCourse: true,
			strip: true
		});
		const links = page.getByRole('link').elements();
		expect(links.map((l) => l.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'C A Succeeded',
			'C B',
			'C C Waiting',
			'C D Internal error'
		]);
		await expect.element(page.getByRole('heading', { name: 'Continue where you left off' })).toBeVisible();
		expect(links[0].getAttribute('href')).toBe('/course/c/a');
	});

	it('NAV-21 shows course names in the side card on demand', async () => {
		render(LastTried, {
			items: [{ courseid: 'c', taskid: 't', courseName: 'C', taskName: 'T', status: 'done', result: 'save' }],
			showCourse: true
		});
		await expect.element(page.getByRole('link', { name: 'C T' })).toBeVisible();
	});

	it('NAV-21 shows task names only on course pages', async () => {
		render(LastTried, {
			items: [{ courseid: 'c', taskid: 't', courseName: 'C', taskName: 'T', status: 'done', result: 'failed' }]
		});
		await expect.element(page.getByRole('link', { name: 'T Failed' })).toBeVisible();
		await expect.element(page.getByRole('heading', { name: 'Last tried exercises' })).toBeVisible();
	});

	it('NAV-21 shows an empty state', async () => {
		render(LastTried, { items: [] });
		await expect.element(page.getByText('No submissions')).toBeVisible();
		document.body.innerHTML = '';
		render(LastTried, { items: [], strip: true });
		await expect.element(page.getByText('No submissions')).toBeVisible();
	});
});

describe('TaskList', () => {
	const task = (id: string, extra = {}): TaskItem => ({
		id,
		name: `Task ${id}`,
		succeeded: false,
		grade: 0,
		weight: 1,
		open: true,
		categories: [],
		deadline: null,
		...extra
	});
	/** A terminal section with its counts. */
	const terminal = (title: string, path: string, closed: boolean, tasks: TaskItem[]): SectionView => {
		const stats: SectionView['stats'] = { '': [0, 0] };
		for (const task of tasks)
			for (const k of ['', ...task.categories]) {
				const [d, n] = stats[k] ?? [0, 0];
				stats[k] = [d + +task.succeeded, n + 1];
			}
		return { title, path, closed, sections: null, tasks, stats };
	};
	const basics = terminal('Basics', '0.0', false, [
		task('t1', { succeeded: true, grade: 100, categories: ['easy'] }),
		task('t2', {
			categories: ['hard'],
			weight: 3,
			deadline: new Date(Date.now() + 86_400_000 * 10).toISOString()
		})
	]);
	const advanced = terminal('Advanced', '0.1', true, [task('t3')]);
	const sections: SectionView[] = [
		{
			title: 'Part 1',
			path: '0',
			closed: false,
			sections: [basics, advanced],
			tasks: [],
			stats: { '': [1, 3], easy: [1, 1], hard: [0, 1] }
		},
		terminal('Deadlines', '1', false, [task('tpast', { open: false })])
	];

	it('NAV-10 renders nested sections, states and grades', async () => {
		render(TaskList, { sections, courseid: 'c', registered: true });
		await expect.element(page.getByRole('heading', { name: 'Part 1' })).toBeVisible();
		await expect.element(page.getByRole('link', { name: /Task t1/ })).toHaveAttribute('href', '/course/c/t1');
		await expect.element(page.getByLabelText('Succeeded')).toBeVisible();
		await expect.element(page.getByText('deadline reached')).toBeVisible();
		await expect.element(page.getByText('Weight: 3')).toBeVisible();
		await expect.element(page.getByText('in 10 days')).toBeVisible();
		const t3 = () => document.querySelector('a[href="/course/c/t3"]')!.checkVisibility();
		expect(t3()).toBe(false);
		await userEvent.click(page.getByText('Advanced'));
		expect(t3()).toBe(true);
		expect(page.getByRole('progressbar').elements().length).toBeGreaterThan(0);
	});

	it('NAV-10 loads the tasks of a section sent without them when it is opened', async () => {
		const lazy = { ...advanced, tasks: null };
		const fetch = vi.spyOn(window, 'fetch').mockResolvedValueOnce(Response.json([task('t3')]));
		render(TaskList, { sections: [lazy, { ...lazy, path: '9', title: 'Broken' }], courseid: 'c', registered: true });
		await expect.element(page.getByText('0 / 1').first()).toBeVisible();
		await userEvent.click(page.getByText('Advanced'));
		await expect.element(page.getByRole('link', { name: /Task t3/ })).toBeVisible();
		expect(fetch).toHaveBeenCalledWith('/course/c/$section?path=0.1', { headers: { accept: 'application/json' } });
		await userEvent.click(page.getByText('Advanced'));
		await userEvent.click(page.getByText('Advanced'));
		expect(fetch).toHaveBeenCalledTimes(1);
		fetch.mockRejectedValueOnce(new Error('offline'));
		await userEvent.click(page.getByText('Broken'));
		await expect.element(page.getByText('Internal error')).toBeVisible();
		fetch.mockRestore();
	});

	it('NAV-10 explains a section without visible task instead of counting 0 / 0', async () => {
		const empty = terminal('Week 6', '2', false, []);
		render(TaskList, {
			sections: [empty, { ...empty, path: '3', title: 'Lazy', tasks: null }],
			courseid: 'c',
			registered: true
		});
		await expect.element(page.getByRole('heading', { name: 'Week 6' })).toBeVisible();
		expect(page.getByText('No task available yet').elements()).toHaveLength(2);
		expect(page.getByText('0 / 0').elements()).toHaveLength(0);
		// Nothing to load for an empty section sent without its tasks.
		expect(page.getByText('Loading...').elements()).toHaveLength(0);
	});

	it('NAV-12 filters tasks by category, without grades for visitors', async () => {
		render(TaskList, { sections, courseid: 'c', category: 'hard', level: 7 });
		await expect.element(page.getByRole('link', { name: /Task t2/ })).toBeVisible();
		expect(page.getByRole('link', { name: /Task t1/ }).elements()).toHaveLength(0);
		expect(page.getByRole('progressbar').elements()).toHaveLength(0);
	});
});

describe('GroupCard, StudentSide, ImportForm', () => {
	const group = {
		id: 'g1',
		description: 'Group A',
		available: 1,
		members: [
			{ username: 'a', realname: 'Alice', email: 'a@x' },
			{ username: 'b', realname: '', email: '' }
		]
	};

	it('NAV-16 renders members and actions', async () => {
		render(GroupCard, { group, canJoin: true });
		await expect.element(page.getByText('(available : 1)')).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Send an email' })).toHaveAttribute('href', 'mailto:a@x');
		await expect.element(page.getByText('b', { exact: true })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Join in' })).toBeVisible();
		render(GroupCard, { group: { ...group, description: 'Mine', members: [] }, mine: true, canLeave: true });
		await expect.element(page.getByText('My group : Mine')).toBeVisible();
		await expect.element(page.getByText('No registered member.')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Quit group' })).toBeVisible();
		render(GroupCard, { group: { ...group, description: 'Other' } });
		await expect.element(page.getByText('Other')).toBeVisible();
	});

	it('NAV-08 shows the unregistration dialog', async () => {
		const side = render(StudentSide, { course: { id: 'c', name: 'C' }, lastTried: [], canUnregister: true });
		await userEvent.click(page.getByRole('button', { name: 'Unregister from this course' }));
		await expect.element(page.getByText('Unregister from C')).toBeVisible();
		await side.rerender({ canUnregister: false });
		expect(page.getByRole('button', { name: 'Unregister from this course' }).elements()).toHaveLength(0);
	});

	it('NAV-18 renders the import form', async () => {
		render(ImportForm, { courseid: 'demo' });
		expect((document.querySelector('input[name=courseid]') as HTMLInputElement).value).toBe('demo');
		render(ImportForm, {});
		await expect.element(page.getByRole('button', { name: 'Import course' }).first()).toBeVisible();
	});
});

describe('DeadlineChip', () => {
	it('NAV-10 shows close deadlines relatively, far ones as dates, none without deadline', async () => {
		const now = Date.UTC(2026, 9, 14);
		render(DeadlineChip, { value: '2099-10-20T12:00:00Z', now });
		await expect.element(page.getByText('Oct 20, 2099')).toBeVisible();
		render(DeadlineChip, { value: new Date(now - 3 * 86_400_000).toISOString(), now });
		await expect.element(page.getByText('3 days ago')).toBeVisible();
		expect(page.getByText('3 days ago').element().closest('span.badge')!.className).toContain('bg-error-500');
		render(DeadlineChip, { value: new Date(now + 4 * 86_400_000).toISOString(), now });
		expect(page.getByText('in 4 days').element().closest('span.badge')!.className).toContain('bg-warning-500');
		render(DeadlineChip, { value: null, now });
		expect(document.querySelectorAll('span.badge')).toHaveLength(3);
	});
	it('falls back to UTC on an invalid time zone instead of failing', async () => {
		render(DeadlineChip, {
			props: { value: '2099-10-20T12:00:00Z', now: Date.UTC(2026, 9, 14) },
			context: new Map([[UI_PREFS_KEY, () => ({ locale: 'en', timeZone: 'Not/AZone', indentation: '4' })]])
		});
		await expect.element(page.getByText('Oct 20, 2099')).toBeVisible();
		expect(page.getByText('Oct 20, 2099').element().closest('span[title]')!.getAttribute('title')).toBe(
			'Oct 20, 2099, 12:00 PM'
		);
	});
});

describe('ListSearch', () => {
	it('NAV-01/02 submits the search when the user stops typing, keeping the other parameters', async () => {
		render(ListSearch, { value: 'alg', label: 'Search a course', params: { filter: 'pinned', page: '' } });
		const form = document.querySelector('form[role=search]') as HTMLFormElement;
		const sent: string[] = [];
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			sent.push(new URLSearchParams(new FormData(form) as never).toString());
		});
		const input = page.getByRole('searchbox', { name: 'Search a course' });
		await expect.element(input).toHaveValue('alg');
		await userEvent.fill(input, 'algo');
		await vi.waitFor(() => expect(sent).toEqual(['filter=pinned&q=algo']));
		await userEvent.type(input, '{Enter}');
		expect(sent).toHaveLength(2);
	});
});
