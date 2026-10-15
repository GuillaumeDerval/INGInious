// Component tests of AppShell (CORE-01, AUTH-18): chrome per login state, LTI, toggles, flash.
import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import AppShell from './AppShell.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>Page content</p>' }));
const base = {
	lang: 'en',
	currentPath: '/courselist',
	returnTo: '/courselist',
	version: '9.9',
	children
};

describe('AppShell', () => {
	it('anonymous: sign in, register, language menu and content', async () => {
		render(AppShell, { ...base, user: null });
		await expect.element(page.getByText('Page content')).toBeVisible();
		const nav = page.getByRole('complementary').getByRole('navigation');
		await expect.element(nav.getByRole('link', { name: 'Course list' })).toHaveAttribute('aria-current', 'page');
		await expect.element(nav.getByRole('link', { name: 'Register' })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Language' })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'INGInious', exact: true })).toHaveAttribute('href', '/');
		await expect.element(page.getByText('Running INGInious v.9.9')).toBeVisible();
	});

	it('busy: loading bar and busy content', async () => {
		render(AppShell, { ...base, user: null, busy: true });
		await expect.element(page.getByRole('progressbar', { name: 'Loading...' })).toBeVisible();
		await expect.element(page.getByRole('main')).toHaveAttribute('aria-busy', 'true');
	});

	it('anonymous without registration', async () => {
		render(AppShell, { ...base, user: null, allowRegistration: false });
		await expect.element(page.getByRole('link', { name: 'Register' })).not.toBeInTheDocument();
	});

	it('logged in superadmin: administration section, extra sections, user menu, flash', async () => {
		render(AppShell, {
			...base,
			user: { username: 'admin', realname: 'Admin', superadmin: true },
			sections: [{ title: 'My course', items: [{ label: 'Tasks', href: '/course/x' }] }],
			flash: { kind: 'success', message: 'Welcome back' }
		});
		const nav = page.getByRole('complementary').getByRole('navigation');
		await expect.element(nav.getByRole('link', { name: 'My courses' })).toBeVisible();
		await expect.element(nav.getByRole('heading', { name: 'Administration' })).toBeVisible();
		await expect.element(nav.getByRole('link', { name: 'Marketplace' })).toBeVisible();
		await expect.element(nav.getByRole('link', { name: 'Tasks' })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'User menu' })).toBeVisible();
		await expect.element(page.getByText('Welcome back')).toBeVisible();
	});

	it('student: no administration', async () => {
		render(AppShell, { ...base, user: { username: 's', realname: 'S', superadmin: false } });
		await expect.element(page.getByRole('link', { name: 'Course list' }).first()).toBeVisible();
		await expect.element(page.getByText('Administration')).not.toBeInTheDocument();
	});

	it('LTI: minimal chrome', async () => {
		render(AppShell, {
			...base,
			user: { username: 's', realname: 'S', superadmin: false },
			lti: true
		});
		await expect.element(page.getByText('Page content')).toBeVisible();
		await expect.element(page.getByRole('navigation')).not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Open menu' })).not.toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'INGInious', exact: true })).not.toBeInTheDocument();
		await expect.element(page.getByText(/Powered by/)).toBeVisible();
	});

	it('menu button collapses the sidebar on desktop and opens a drawer on mobile', async () => {
		await page.viewport(1280, 800);
		const screen = render(AppShell, { ...base, user: null });
		const toggle = page.getByRole('button', { name: 'Open menu' });
		await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');
		await toggle.click();
		await expect.element(page.getByRole('complementary')).not.toBeInTheDocument();
		await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
		await toggle.click();
		await expect.element(page.getByRole('complementary')).toBeInTheDocument();

		await page.viewport(400, 800);
		await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
		const button = toggle.element();
		await toggle.click();
		const drawer = page.getByRole('dialog');
		await expect.element(drawer.getByRole('link', { name: 'Sign in' })).toBeVisible();
		// The page behind the drawer is hidden from assistive technologies: check the element itself.
		expect(button.getAttribute('aria-expanded')).toBe('true');
		// A navigation closes the drawer.
		await screen.rerender({ currentPath: '/signin' });
		await expect.element(drawer).not.toBeInTheDocument();
		await toggle.click();
		await drawer.getByRole('button', { name: 'Close' }).click();
		await expect.element(drawer).not.toBeInTheDocument();
		await page.viewport(1280, 800);
	});
});
