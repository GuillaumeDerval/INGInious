// Component tests of ConfirmDialog.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ConfirmDialog from './ConfirmDialog.svelte';

let submitted: Record<string, string> | null;
/** Captures native form submissions instead of navigating away. */
const capture = (e: Event) => {
	if (e.defaultPrevented) return;
	e.preventDefault();
	submitted = Object.fromEntries(new FormData(e.target as HTMLFormElement)) as Record<string, string>;
	submitted.action = (e.target as HTMLFormElement).getAttribute('action')!;
};
beforeEach(() => {
	submitted = null;
	document.addEventListener('submit', capture);
});
afterEach(() => document.removeEventListener('submit', capture));

describe('ConfirmDialog', () => {
	it('requires the confirmation text and submits the form', async () => {
		render(ConfirmDialog, {
			title: 'Delete course',
			description: 'Forever',
			triggerLabel: 'Delete',
			confirmText: 'c1',
			action: '?/delete',
			fields: { id: 'c1' }
		});
		await page.getByRole('button', { name: 'Delete' }).click();
		const dialog = page.getByRole('alertdialog');
		await expect.element(dialog.getByText('Forever')).toBeVisible();
		const confirm = dialog.getByRole('button', { name: 'Confirm' });
		await expect.element(confirm).toBeDisabled();
		await dialog.getByLabelText('Type "c1" to confirm.').fill('c1');
		await expect.element(confirm).toBeEnabled();
		await confirm.click();
		expect(submitted).toEqual({ id: 'c1', action: '?/delete' });
	});

	it('calls onconfirm without action, can be cancelled and opened programmatically', async () => {
		const onconfirm = vi.fn();
		const screen = render(ConfirmDialog, {
			title: 'Reset',
			tone: 'primary',
			confirmLabel: 'Do it',
			onconfirm,
			open: true
		});
		const dialog = page.getByRole('alertdialog');
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect.element(dialog).not.toBeInTheDocument();
		await screen.rerender({ open: true });
		await dialog.getByRole('button', { name: 'Do it' }).click();
		expect(onconfirm).toHaveBeenCalledOnce();
		expect(submitted).toBeNull();
		await expect.element(dialog).not.toBeInTheDocument();
	});

	it('works without callback and with the primary trigger', async () => {
		render(ConfirmDialog, { title: 'Nothing', triggerLabel: 'Open', tone: 'primary' });
		await page.getByRole('button', { name: 'Open' }).click();
		await page.getByRole('button', { name: 'Confirm' }).click();
		await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
	});

	it('clears the typed confirmation after an onconfirm confirmation', async () => {
		const onconfirm = vi.fn();
		render(ConfirmDialog, { title: 'Wipe', triggerLabel: 'Wipe', confirmText: 'c1', onconfirm });
		await page.getByRole('button', { name: 'Wipe' }).click();
		await page.getByRole('textbox').fill('c1');
		await page.getByRole('button', { name: 'Confirm' }).click();
		expect(onconfirm).toHaveBeenCalledOnce();
		await page.getByRole('button', { name: 'Wipe' }).click();
		await expect.element(page.getByRole('textbox')).toHaveValue('');
		await expect.element(page.getByRole('button', { name: 'Confirm' })).toBeDisabled();
	});
});
