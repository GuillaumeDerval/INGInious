// Component tests of UserMenu (AUTH-18).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import UserMenu from './UserMenu.svelte';

let action: string | null;
/** Captures form submissions instead of navigating away. */
const capture = (e: Event) => {
	e.preventDefault();
	action = (e.target as HTMLFormElement).getAttribute('action');
};
/** Keeps link clicks from navigating the test iframe away. */
const stay = (e: Event) => {
	if ((e.target as Element).closest('a')) e.preventDefault();
};
beforeEach(() => {
	action = null;
	document.addEventListener('submit', capture);
	document.addEventListener('click', stay);
});
afterEach(() => {
	document.removeEventListener('submit', capture);
	document.removeEventListener('click', stay);
});

describe('UserMenu', () => {
	it('shows the user links and logs out with a POST', async () => {
		render(UserMenu, {
			user: { username: 'jdoe', realname: 'John Ronald Doe', superadmin: false }
		});
		await expect.element(page.getByText('JR')).toBeVisible();
		await page.getByRole('button', { name: 'User menu' }).click();
		for (const [name, href] of [
			['My courses', '/mycourses'],
			['Course list', '/courselist'],
			['Preferences', '/preferences'],
			['Service status', '/queue']
		]) {
			await expect.element(page.getByRole('menuitem', { name })).toHaveAttribute('href', href);
		}
		await expect.element(page.getByRole('menuitem', { name: 'Administration' })).not.toBeInTheDocument();
		await page.getByRole('menuitem', { name: 'Log out' }).click();
		await expect.poll(() => action).toBe('/logout');
	});

	it('shows Administration to superadmins and falls back to the username', async () => {
		render(UserMenu, { user: { username: 'admin', realname: '', superadmin: true } });
		await expect.element(page.getByText('A', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'User menu' }).click();
		await expect
			.element(page.getByRole('menuitem', { name: 'Administration' }))
			.toHaveAttribute('href', '/administrator/users');
		await page.getByRole('menuitem', { name: 'My courses' }).click();
		expect(action).toBeNull();
	});
});
