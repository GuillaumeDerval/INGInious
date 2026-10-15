// Component tests of the NAV area pages (rendering of their load data).
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import type { SafeHtml } from '#lib/utils/safe-html.js';
import CourseList from './courselist/+page.svelte';
import MyCourses from './mycourses/+page.svelte';
import Register from './register/[courseid]/+page.svelte';
import Course from './course/[courseid]/+page.svelte';
import Group from './group/[courseid]/+page.svelte';
import Queue from './queue/+page.svelte';
import Marketplace from './marketplace/+page.svelte';
import MarketCourse from './marketplace/[courseid]/+page.svelte';
import ComingTasks from './coming_tasks/+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://x/list?q=al&page=2'), params: {} } }));

const html = (s: string) => s as SafeHtml;
const card = (id: string, name: string) => ({
	id,
	name,
	description: html('<p>desc</p>'),
	isLti: false,
	ltiUrl: null,
	autoRegistration: false,
	password: false,
	registered: false,
	preview: false
});
const show = (Page: unknown, data: Record<string, unknown>) => render(Page as never, { data, params: {} } as never);

describe('NAV pages', () => {
	it('NAV-01 /courselist shows a page of the courses found by the server', async () => {
		const list = { q: 'al', count: 30, page: 2, pages: 3 };
		show(CourseList, { courses: [card('a', 'Alpha'), card('b', 'Beta')], loggedIn: true, ...list });
		await expect.element(page.getByText('Public courses')).toBeVisible();
		await expect.element(page.getByRole('searchbox')).toHaveValue('al');
		await expect.element(page.getByText('30 courses')).toBeVisible();
		expect(page.getByRole('article').elements()).toHaveLength(2);
		await expect.element(page.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '?q=al&page=3');
		show(CourseList, { courses: [], loggedIn: true, ...list, count: 0, pages: 1, page: 1 });
		await expect.element(page.getByText('No course found.')).toBeVisible();
		show(CourseList, { courses: [], loggedIn: false, ...list });
		await expect.element(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
	});

	it('NAV-01 /courselist states the access of each course and offers a single call-to-action', async () => {
		const cases: [Record<string, unknown>, string, string | null, string | null][] = [
			[{ registered: true }, 'Registered', 'Open', '/course/c1'],
			[{ autoRegistration: true }, 'Registration open', 'Register', '/register/c1'],
			[{ autoRegistration: true, password: true }, 'Password required', 'Register', '/register/c1'],
			[{ preview: true }, 'Preview available', 'Preview', '/course/c1'],
			[{}, 'Registration closed', null, null],
			[{ isLti: true, ltiUrl: 'https://lms/x' }, 'External platform', 'Open', 'https://lms/x'],
			[{ isLti: true }, 'External platform', null, null]
		];
		for (const [extra, chip, cta, href] of cases) {
			document.body.innerHTML = '';
			show(CourseList, { courses: [{ ...card('c1', 'Course 1'), ...extra }], loggedIn: true, page: 1, pages: 1 });
			const article = page.getByRole('article');
			await expect.element(article.getByText(chip)).toBeVisible();
			await expect.element(article.getByText('desc')).toBeVisible();
			const links = article.getByRole('link').elements();
			expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual(cta ? [[cta, href]] : []);
		}
	});

	it('NAV-02/03 /mycourses shows pins, progress, roles and states, filters and searches', async () => {
		const item = (id: string, extra: Record<string, unknown> = {}) => ({
			id,
			name: `NAV ${id}`,
			lti: false,
			archived: false,
			hidden: false,
			archiveDate: null,
			role: 'student',
			pinned: false,
			grade: 50,
			succeeded: 1,
			total: 4,
			deadline: null,
			...extra
		});
		const courses = [
			item('open', { pinned: true, deadline: new Date(Date.now() + 3_600_000 * 5).toISOString() }),
			item('lti', { lti: true, role: 'admin' }),
			item('archive', { archived: true, hidden: true, archiveDate: '2026-01-01T00:00:00Z', role: 'tutor' }),
			item('closed', { hidden: true })
		];
		const names = () =>
			Array.from(document.querySelectorAll('article[data-course-id]')).map((e) => e.getAttribute('data-course-id'));
		const list = { q: '', filter: 'hidden', total: 4, count: 4, page: 1, pages: 1 };
		show(MyCourses, { courses, lastTried: [], superadmin: true, ...list });
		document.querySelector('summary')!.click();
		await expect.element(page.getByRole('button', { name: 'Create new course' })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Unpin' })).toHaveAttribute('aria-pressed', 'true');
		expect(page.getByRole('button', { name: 'Pin', exact: true }).elements()).toHaveLength(3);
		await expect.element(page.getByText('Administrator')).toBeVisible();
		await expect.element(page.getByText('LTI course')).toBeVisible();
		await expect.element(page.getByText(/Archive - .*2026/)).toBeVisible();
		await expect.element(page.getByText('Hidden course')).toBeVisible();
		await expect.element(page.getByText('in 5 hours')).toBeVisible();
		await expect.element(page.getByText('1 / 4 tasks succeeded').first()).toBeVisible();
		expect(names()).toEqual(['open', 'lti', 'archive', 'closed']);
		// Filters are links (the page number is reset), the active one is marked.
		await expect
			.element(page.getByRole('link', { name: 'Hidden', exact: true }))
			.toHaveAttribute('aria-current', 'true');
		await expect
			.element(page.getByRole('link', { name: 'Pinned', exact: true }))
			.toHaveAttribute('href', '?q=al&filter=pinned');
		await expect.element(page.getByRole('link', { name: 'All', exact: true })).toHaveAttribute('href', '?q=al');
		await expect.element(page.getByRole('searchbox')).toHaveValue('');
		document.body.innerHTML = '';
		show(MyCourses, { courses: [], lastTried: [], superadmin: false, ...list, count: 0 });
		await expect.element(page.getByText('No course found.')).toBeVisible();
		document.body.innerHTML = '';
		show(MyCourses, { courses: [], lastTried: [], superadmin: false, ...list, total: 0, count: 0 });
		await expect.element(page.getByText('You are not registered to any course')).toBeVisible();
	});

	it('NAV-06 /register shows the password field when needed', async () => {
		show(Register, { id: 'c', name: 'C', password: true });
		await expect.element(page.getByLabelText('Password')).toHaveAttribute('type', 'password');
		show(Register, { id: 'd', name: 'D', password: false });
		await expect.element(page.getByRole('heading', { name: "Enroll in the course 'D'" })).toBeVisible();
	});

	it('NAV-09 /course renders the student and preview variants', async () => {
		const base = {
			course: { id: 'c', name: 'Course C', description: html('<p>About text</p>'), categories: ['easy'] },
			anonymous: false,
			registered: true,
			staff: true,
			succeeded: 1,
			total: 2,
			hidden: true,
			canUnregister: true,
			canRegister: false,
			grade: 77,
			lastTried: [],
			sections: [
				{
					title: 'S',
					path: '0',
					closed: false,
					sections: null,
					stats: { '': [0, 1] },
					tasks: [
						{
							id: 't',
							name: 'Task T',
							succeeded: false,
							grade: 0,
							weight: 1,
							open: true,
							categories: [],
							deadline: null
						}
					]
				}
			]
		};
		show(Course, base);
		await expect.element(page.getByText(/currently invisible for students/)).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'My courses' })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Course administration' })).toHaveAttribute('href', '/admin/c');
		await expect.element(page.getByText('1 / 2 tasks succeeded')).toBeVisible();
		await userEvent.click(page.getByRole('button', { name: 'easy' }));
		expect(page.getByRole('link', { name: /Task T/ }).elements()).toHaveLength(0);
		await userEvent.click(page.getByRole('button', { name: 'All' }));
		await expect.element(page.getByRole('link', { name: /Task T/ })).toBeVisible();
		await userEvent.click(page.getByText('About this course'));
		await expect.element(page.getByText('About text')).toBeVisible();
		document.body.innerHTML = '';
		show(Course, {
			...base,
			course: { ...base.course, description: null, categories: [] },
			anonymous: true,
			registered: false,
			staff: false,
			hidden: false,
			canRegister: false
		});
		await expect.element(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Course list' })).toBeVisible();
		document.body.innerHTML = '';
		show(Course, { ...base, anonymous: false, registered: false, staff: false, hidden: false, canRegister: true });
		await expect
			.element(page.getByRole('link', { name: 'Enroll in the course' }))
			.toHaveAttribute('href', '/register/c');
		document.body.innerHTML = '';
		show(Course, { ...base, staff: false, hidden: false });
		await expect.element(page.getByRole('button', { name: 'Unregister from this course' })).toBeVisible();
	});

	it('NAV-16 /group renders every state', async () => {
		const g = { id: 'g', description: 'Group A', available: 1, members: [] };
		const base = {
			course: { id: 'c', name: 'C' },
			choice: true,
			hasGroups: true,
			mine: null,
			groups: [g],
			grade: 0,
			lastTried: [],
			canUnregister: false
		};
		const texts: [Record<string, unknown>, string][] = [
			[{ mine: g }, 'My group : Group A'],
			[
				{ hasGroups: false, groups: [] },
				'No set group in this course. If you think this is a mistake, please contact the course administrator.'
			],
			[
				{ groups: [] },
				"Groups have been set up but you're not allowed to register in anyone. Please contact the course administrator."
			],
			[{}, 'Join in'],
			[
				{ choice: false },
				"You're not yet registered to a group. Please contact the course administrator for more information."
			]
		];
		for (const [extra, text] of texts) {
			document.body.innerHTML = '';
			show(Group, { ...base, ...extra });
			await expect.element(page.getByText(text).first()).toBeVisible();
		}
	});

	it('NAV-17 /queue lists jobs', async () => {
		show(Queue, {
			running: [
				{ id: 'j1', agent: 'ag', info: 'c/t', launcher: 'core', start: 0, end: null, kill: true },
				{ id: 'j2', agent: 'ag', info: 'c/u', launcher: 'core', start: 0, end: 1000, kill: false }
			],
			waiting: [
				{ id: 'j3', info: 'x', launcher: 'core', max: null, kill: false },
				{ id: 'j4', info: 'y', launcher: 'core', max: 20, kill: false }
			]
		});
		await expect.element(page.getByText('No timeout set').first()).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Kill' })).toBeVisible();
		await expect.element(page.getByText('20')).toBeVisible();
		document.body.innerHTML = '';
		show(Queue, { running: [], waiting: [] });
		await expect.element(page.getByText('There are no jobs running')).toBeVisible();
	});

	it('NAV-18/19 marketplace pages', async () => {
		const m = show(Marketplace, { courses: [{ id: 'demo', name: 'Demo', shortDesc: '<b>raw</b>' }] });
		await expect.element(page.getByText('<b>raw</b>')).toBeVisible();
		await m.rerender({ data: { courses: [{ id: 'demo', name: 'Demo 2', shortDesc: 'x' }] } } as never);
		await expect.element(page.getByText('Demo 2')).toBeVisible();
		await m.rerender({ data: { courses: [] } } as never);
		await expect.element(page.getByText('No public courses available')).toBeVisible();
		show(MarketCourse, {
			id: 'demo',
			name: 'Demo',
			description: html('<p>Long</p>'),
			info: [['License', 'GPL']],
			link: 'https://x'
		});
		await expect.element(page.getByText('GPL')).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'https://x' })).toHaveAttribute('rel', 'noopener noreferrer');
		show(MarketCourse, { id: 'd2', name: 'D2', description: html(''), info: [], link: null });
	});

	it('NAV-20 /coming_tasks lists tasks', async () => {
		show(ComingTasks, {
			planner: '7',
			lastTried: [],
			courses: [
				{
					id: 'c',
					name: 'C',
					count: 1,
					tasks: [{ id: 't', name: 'Task', deadline: '2099-10-20T12:00:00Z', grade: 10 }]
				}
			],
			page: 1,
			pages: 2
		});
		await expect.element(page.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '?q=al&page=2');
		await expect.element(page.getByRole('link', { name: /Task/ })).toHaveAttribute('href', '/course/c/t');
		await expect
			.element(page.getByRole('link', { name: 'unlimited' }))
			.toHaveAttribute('href', '?time_planner=unlimited');
		show(ComingTasks, { planner: 'unlimited', lastTried: [], courses: [] });
		await expect.element(page.getByText('You have no upcoming tasks')).toBeVisible();
	});
});
