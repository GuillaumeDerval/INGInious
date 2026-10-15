// Component test of the root layout: shell, nested navigation and preferences.
import { describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Layout from './+layout.svelte';
import { t } from '#lib/i18n/index.js';

const state = vi.hoisted(() => ({
	page: {
		url: new URL('http://x/course/c1?tab=1'),
		data: { nav: [{ title: 'Course', items: [{ label: 'Tasks', href: '/course/c1' }] }] } as Record<string, unknown>
	},
	navigating: { to: null as unknown }
}));
vi.mock('$app/state', () => state);
const env = vi.hoisted(() => ({ browser: true }));
vi.mock('$app/env', () => ({
	get browser() {
		return env.browser;
	}
}));

const data = {
	user: null,
	lang: 'fr',
	isLti: false,
	timezone: 'UTC',
	codeIndentation: '4',
	version: '1.0',
	allowRegistration: true,
	privacyHref: '/pages/privacy',
	flash: null,
	catalog: { 'Course list': 'Liste des cours' }
};
const children = createRawSnippet(() => ({ render: () => '<p>Child page</p>' }));

describe('+layout.svelte', () => {
	it('renders the shell with nested sections and the browser catalog', async () => {
		// The global stylesheet is loaded here: the sidebar only shows on large screens.
		await page.viewport(1280, 800);
		render(Layout, { data, children } as never);
		await expect.element(page.getByText('Child page')).toBeVisible();
		await expect
			.element(page.getByRole('complementary').getByRole('link', { name: 'Tasks' }))
			.toHaveAttribute('aria-current', 'page');
		await expect.element(page.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
		expect(t('Course list')).toBe('Liste des cours');
		expect((document.querySelector('input[name=redirect]') as HTMLInputElement).value).toBe('/course/c1?tab=1');
	});

	it('works without nested navigation (and as on the server)', async () => {
		state.page.data = {};
		env.browser = false;
		render(Layout, { data: { ...data, catalog: {} }, children } as never);
		await expect.element(page.getByRole('complementary').getByRole('link', { name: 'Course list' })).toBeVisible();
	});

	it('is busy while a navigation is pending', async () => {
		state.navigating.to = { url: new URL('http://x/courselist') };
		render(Layout, { data, children } as never);
		await expect.element(page.getByRole('progressbar')).toBeInTheDocument();
		await expect.element(page.getByRole('main')).toHaveAttribute('aria-busy', 'true');
		state.navigating.to = null;
	});
});
