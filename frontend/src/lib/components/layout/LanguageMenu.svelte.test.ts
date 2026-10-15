// Component tests of LanguageMenu (AUTH-10): POSTs the chosen language.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import LanguageMenu from './LanguageMenu.svelte';

let submitted: { action: string; data: Record<string, string> } | null;
/** Captures form submissions instead of navigating away. */
const capture = (e: Event) => {
	e.preventDefault();
	const form = e.target as HTMLFormElement;
	submitted = {
		action: form.getAttribute('action')!,
		data: Object.fromEntries(new FormData(form)) as Record<string, string>
	};
};
beforeEach(() => {
	submitted = null;
	document.addEventListener('submit', capture);
});
afterEach(() => document.removeEventListener('submit', capture));

describe('LanguageMenu', () => {
	it('lists the languages and posts the selection', async () => {
		render(LanguageMenu, { current: 'fr', returnTo: '/courselist?x=1' });
		await page.getByRole('button', { name: 'Language' }).click();
		await expect.element(page.getByRole('menuitem', { name: 'Français' })).toHaveAttribute('aria-current', 'true');
		await page.getByRole('menuitem', { name: 'Deutsch' }).click();
		await expect
			.poll(() => submitted)
			.toEqual({ action: '/language', data: { language: 'de', redirect: '/courselist?x=1' } });
	});

	it('works with the keyboard', async () => {
		render(LanguageMenu, { current: 'en', returnTo: '/' });
		(page.getByRole('button', { name: 'Language' }).element() as HTMLElement).focus();
		await userEvent.keyboard('{Enter}');
		await expect.element(page.getByRole('menuitem', { name: 'English' })).toBeVisible();
		await userEvent.keyboard('{ArrowDown}{Enter}');
		await expect.poll(() => submitted?.data.language).toBeTruthy();
	});
});
