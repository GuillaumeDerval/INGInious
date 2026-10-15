// Component tests of the toaster helpers and of Toaster.svelte.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Toaster from './Toaster.svelte';
import { busyEnhance, notify, toastEnhance, toaster } from './toaster.js';
import { loading } from './loading.svelte.js';

afterEach(() => toaster.remove());

/** Submit function of an enhanced form, as called by SvelteKit's `enhance`. */
type Submit = (input: unknown) => ((o: unknown) => Promise<void>) | void;

/** Fake `enhance` input: a form with a submit button. */
function submission() {
	const form = document.createElement('form');
	const submitter = document.createElement('button');
	form.append(submitter);
	return { formElement: form, submitter, cancel: vi.fn() };
}

/** Runs the callback returned by toastEnhance with a fake action result. */
async function run(result: unknown, success?: string) {
	const update = vi.fn(async () => {});
	const callback = (toastEnhance(success) as unknown as Submit)(submission())!;
	await callback({ result, update });
	expect(update).toHaveBeenCalledWith({ reset: false });
}

describe('toaster', () => {
	it('renders notifications of every kind', async () => {
		render(Toaster);
		notify('success', 'Saved!');
		notify('error', 'Broken!');
		toaster.create({ type: 'warning', description: 'Careful' });
		toaster.create({ description: 'No type' });
		await expect.element(page.getByText('Saved!')).toBeVisible();
		await expect.element(page.getByText('Broken!')).toBeVisible();
		await expect.element(page.getByText('Careful')).toBeVisible();
		await expect.element(page.getByText('No type')).toBeVisible();
	});

	it('toastEnhance shows action messages', async () => {
		render(Toaster);
		await run({ type: 'success', data: { message: 'From action' } });
		await run({ type: 'success', data: {} }, 'Default success');
		await run({ type: 'success' });
		await run({ type: 'failure', data: { message: 'Bad input' } });
		await run({ type: 'failure', data: { message: '' } });
		await run({ type: 'error', error: { message: 'Boom' } });
		await run({ type: 'error' });
		await run({ type: 'redirect', location: '/' });
		await expect.element(page.getByText('From action')).toBeVisible();
		await expect.element(page.getByText('Default success')).toBeVisible();
		await expect.element(page.getByText('Bad input')).toBeVisible();
		await expect.element(page.getByText('Boom')).toBeVisible();
		await expect.element(page.getByText('An error occurred.').first()).toBeVisible();
	});

	it('keeps form values unless a reset is asked (edit vs creation forms)', async () => {
		const update = vi.fn(async () => {});
		const callback = (toastEnhance(undefined, { reset: true }) as unknown as Submit)(submission())!;
		await callback({ result: { type: 'success', data: {} }, update });
		expect(update).toHaveBeenCalledWith({ reset: true });
	});

	it('marks the form busy until the result is applied and ignores a second submission', async () => {
		const input = submission();
		const submit = busyEnhance() as unknown as Submit;
		const callback = submit(input)!;
		expect(input.formElement.getAttribute('aria-busy')).toBe('true');
		expect(input.submitter.getAttribute('aria-busy')).toBe('true');
		expect(loading.active).toBe(true);
		expect(submit(input)).toBeUndefined();
		expect(input.cancel).toHaveBeenCalledOnce();
		const update = vi.fn(async () => {
			throw new Error('navigation failed');
		});
		await expect(callback({ result: { type: 'success' }, update })).rejects.toThrow('navigation failed');
		expect(input.formElement.hasAttribute('aria-busy')).toBe(false);
		expect(input.submitter.hasAttribute('aria-busy')).toBe(false);
		expect(loading.active).toBe(false);
		// Implicit submission (Enter in a field) without a submit button.
		const noButton = { ...submission(), submitter: null };
		await submit(noButton)!({ result: { type: 'success' }, update: vi.fn(async () => {}) });
		expect(noButton.formElement.hasAttribute('aria-busy')).toBe(false);
	});
});
