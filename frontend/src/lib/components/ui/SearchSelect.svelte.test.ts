// Component tests of SearchSelect (debounced autocomplete multi-select).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import SearchSelect from './SearchSelect.svelte';

const users = [
	{ value: 'alice', label: 'Alice' },
	{ value: 'bob', label: 'Bob' }
];
afterEach(() => vi.restoreAllMocks());

/** Mocks fetch with a JSON answer. */
function mockFetch(body: unknown, ok = true) {
	return vi
		.spyOn(window, 'fetch')
		.mockImplementation(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 }));
}
/** Values of the hidden inputs. */
const values = () =>
	Array.from(document.querySelectorAll<HTMLInputElement>('input[type=hidden][name=users]')).map((i) => i.value);

describe('SearchSelect', () => {
	it('searches, selects with mouse and keyboard, removes', async () => {
		const fetch = mockFetch(users);
		render(SearchSelect, { name: 'users', label: 'Users', url: '/api/users', delay: 0 });
		const input = page.getByRole('combobox', { name: 'Users' });
		await input.fill('a');
		expect(fetch).not.toHaveBeenCalled();
		await input.fill('al');
		await expect.element(page.getByRole('option', { name: 'Alice' })).toBeVisible();
		expect(fetch.mock.calls[0][0]).toBe('/api/users?q=al');
		await page.getByRole('option', { name: 'Alice' }).click();
		expect(values()).toEqual(['alice']);

		await input.fill('bo');
		await expect.element(page.getByRole('option', { name: 'Bob' })).toBeVisible();
		await expect.element(page.getByRole('option', { name: 'Alice' })).not.toBeInTheDocument();
		await userEvent.keyboard('{ArrowDown}');
		await expect.element(input).toHaveAttribute('aria-activedescendant');
		await userEvent.keyboard('{ArrowUp}{Enter}');
		expect(values()).toEqual(['alice', 'bob']);

		await userEvent.keyboard('{Backspace}');
		expect(values()).toEqual(['alice']);
		await page.getByRole('button', { name: 'Remove Alice' }).click();
		expect(values()).toEqual([]);
	});

	it('single mode replaces the selection; escape and short queries close the list', async () => {
		mockFetch(users);
		render(SearchSelect, {
			name: 'users',
			label: 'Users',
			url: '/api/users',
			delay: 0,
			multiple: false,
			selected: [users[1]]
		});
		const input = page.getByRole('combobox');
		await input.fill('ali');
		await expect.element(page.getByRole('listbox')).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
		await userEvent.keyboard('{Enter}');
		await input.fill('alic');
		await expect.element(page.getByRole('option', { name: 'Alice' })).toBeVisible();
		await userEvent.keyboard('{ArrowDown}{Enter}');
		expect(values()).toEqual(['alice']);
		await input.fill('al');
		await expect.element(page.getByRole('listbox')).toBeVisible();
		await input.fill('a');
		await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
		await userEvent.keyboard('{x}');
		await userEvent.keyboard('{Backspace}{Backspace}{Backspace}');
	});

	it('shows "No result" on errors and ignores network failures', async () => {
		mockFetch(null, false);
		render(SearchSelect, { name: 'users', label: 'Users', url: '/api/users', delay: 0 });
		const input = page.getByRole('combobox');
		await input.fill('zz');
		await expect.element(page.getByText('No result')).toBeVisible();
		await userEvent.keyboard('{ArrowDown}');
		vi.spyOn(window, 'fetch').mockRejectedValue(new Error('offline'));
		await input.fill('zzz');
		await expect.element(page.getByText('No result')).toBeVisible();
		input.element().dispatchEvent(new FocusEvent('blur'));
		await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
	});
});
