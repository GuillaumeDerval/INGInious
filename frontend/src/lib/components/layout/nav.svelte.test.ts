// Component tests of NavMenu and of the navigation model helpers (CORE-01).
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import HouseIcon from '@lucide/svelte/icons/house';
import NavMenu from './NavMenu.svelte';
import { activeHref, type NavSection } from './nav.js';

const sections: NavSection[] = [
	{
		items: [
			{ label: 'Home', href: '/', icon: HouseIcon },
			{ label: 'Course', href: '/course/x' }
		]
	},
	{
		title: 'Tasks',
		items: [
			{ label: 'Task 1', href: '/course/x/t1?tab=a' },
			{ label: 'Sub', href: '/course/x/t1/sub' }
		]
	},
	{ title: 'Empty', items: [] }
];

describe('activeHref', () => {
	it('picks the longest matching href', () => {
		expect(activeHref(sections, '/course/x/t1?tab=a')).toBe('/course/x/t1?tab=a');
		// Without its query parameter the "Task 1" entry does not match: its parent does.
		expect(activeHref(sections, '/course/x/t1')).toBe('/course/x');
		expect(activeHref(sections, '/course/x/t1/sub/deep')).toBe('/course/x/t1/sub');
		expect(activeHref(sections, '/course/x/other')).toBe('/course/x');
	});

	it('matches query parameters of tab-like entries', () => {
		const tabs: NavSection[] = [
			{
				items: [
					{ label: 'Students', href: '/admin/c/students' },
					{ label: 'Audiences', href: '/admin/c/students?tab=audiences' },
					{ label: 'Groups', href: '/admin/c/students?tab=groups' }
				]
			}
		];
		expect(activeHref(tabs, '/admin/c/students')).toBe('/admin/c/students');
		expect(activeHref(tabs, '/admin/c/students?tab=groups&x=1')).toBe('/admin/c/students?tab=groups');
		expect(activeHref(tabs, '/admin/c/students?tab=staff')).toBe('/admin/c/students');
	});
	it('only matches "/" exactly', () => {
		expect(activeHref(sections, '/')).toBe('/');
		expect(activeHref(sections, '/elsewhere')).toBeNull();
	});
});

describe('NavMenu', () => {
	it('renders sections, titles and the active item', async () => {
		render(NavMenu, { sections, currentPath: '/course/x/t1?tab=a' });
		await expect.element(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
		await expect.element(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
		await expect.element(page.getByText('Empty')).not.toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'Task 1' })).toHaveAttribute('aria-current', 'page');
		await expect.element(page.getByRole('link', { name: 'Course' })).not.toHaveAttribute('aria-current');
		await expect.element(page.getByRole('link', { name: 'Sub' })).toHaveAttribute('href', '/course/x/t1/sub');
	});

	it('honours an explicit active flag and a custom label', async () => {
		render(NavMenu, {
			sections: [
				{
					items: [
						{ label: 'Forced', href: '/a', active: true },
						{ label: 'Off', href: '/b', active: false }
					]
				}
			],
			currentPath: '/b',
			label: 'Course menu'
		});
		await expect.element(page.getByRole('navigation', { name: 'Course menu' })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Forced' })).toHaveAttribute('aria-current', 'page');
		await expect.element(page.getByRole('link', { name: 'Off' })).not.toHaveAttribute('aria-current');
	});

	it('renders a context header section', async () => {
		render(NavMenu, {
			sections: [{ title: 'Algorithms 101', context: 'Course administration', contextHref: '/course/algo', items: [] }],
			currentPath: '/x'
		});
		await expect.element(page.getByRole('heading', { name: 'Algorithms 101' })).toBeVisible();
		await expect.element(page.getByRole('link', { name: /Algorithms 101/ })).toHaveAttribute('href', '/course/algo');
		await expect.element(page.getByText('Course administration')).toBeVisible();
	});
});
