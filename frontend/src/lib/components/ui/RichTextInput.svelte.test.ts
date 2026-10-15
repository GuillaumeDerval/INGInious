/**
 * Component tests of RichTextInput (markup switch hiding the #MD marker, preview).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import RichTextInput from './RichTextInput.svelte';

afterEach(() => vi.unstubAllGlobals());

/** Props of RichTextInput whose bindable `value` is mirrored in `box.value`. */
function bound(value: string, props: { label: string; previewUrl?: string }) {
	const box = { value };
	return {
		box,
		props: {
			...props,
			get value() {
				return box.value;
			},
			set value(v: string) {
				box.value = v;
			}
		}
	};
}

describe('RichTextInput', () => {
	it('hides the #MD marker and switches the markup language', async () => {
		const { box, props } = bound('#MD\n**hi**', { label: 'Context' });
		render(RichTextInput, props);
		await expect.element(page.getByRole('radio', { name: 'Markdown' })).toHaveAttribute('aria-checked', 'true');
		await expect.element(page.getByText('#MD')).not.toBeInTheDocument();
		expect(box.value).toBe('#MD\n**hi**');
		await page.getByRole('radio', { name: 'reStructuredText' }).click();
		await vi.waitFor(() => expect(box.value).toBe('**hi**'));
		await page.getByRole('radio', { name: 'Markdown' }).click();
		await vi.waitFor(() => expect(box.value).toBe('#MD\n**hi**'));
	});

	it('defaults to reStructuredText and has no preview without endpoint', async () => {
		render(RichTextInput, { value: 'Title\n=====', label: 'Description' });
		await expect.element(page.getByRole('radio', { name: 'reStructuredText' })).toHaveAttribute('aria-checked', 'true');
		await expect.element(page.getByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
		// Prose: long lines wrap inside the editor.
		await expect.poll(() => document.querySelector('.cm-content.cm-lineWrapping')).not.toBeNull();
	});

	it('shows a server-rendered preview and goes back to edition', async () => {
		const fetchMock = vi.fn(async () => new Response('<p><strong>hi</strong></p>'));
		vi.stubGlobal('fetch', fetchMock);
		render(RichTextInput, { value: '**hi**', label: 'Context', previewUrl: '/preview' });
		await page.getByRole('button', { name: 'Preview' }).click();
		await expect.element(page.getByText('hi', { exact: true })).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith('/preview', expect.objectContaining({ method: 'POST', body: '**hi**' }));
		await page.getByRole('button', { name: 'Edit' }).click();
		await expect.element(page.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
	});

	it('reports preview failures', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('no', { status: 403 }))
		);
		render(RichTextInput, { value: 'x', label: 'Context', previewUrl: '/preview' });
		await page.getByRole('button', { name: 'Preview' }).click();
		await expect.element(page.getByText('Preview unavailable.')).toBeInTheDocument();
	});
});
