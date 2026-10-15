// Component tests of FileDrop: selection, drag & drop, client-side checks.
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import FileDrop from './FileDrop.svelte';

const file = (name: string, size: number, type = '') => new File([new Uint8Array(size)], name, { type });

/** Selects files through the input, like the browser file picker. */
function select(input: HTMLInputElement, files: File[]) {
	const transfer = new DataTransfer();
	for (const f of files) transfer.items.add(f);
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Drops files on the drop zone. */
function drop(zone: Element, files: File[]) {
	const transfer = new DataTransfer();
	for (const f of files) transfer.items.add(f);
	zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
	zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
}

describe('FileDrop', () => {
	it('accepts valid files and lists them', async () => {
		const onchange = vi.fn();
		render(FileDrop, {
			name: 'archive',
			label: 'Upload',
			accept: '.zip, image/png, application/pdf',
			maxSize: 3 * 1048576,
			required: true,
			onchange
		});
		await expect.element(page.getByText(/Maximum size: 3.0 MB/)).toBeVisible();
		const input = page.getByLabelText('Upload').element() as HTMLInputElement;
		select(input, [file('a.ZIP', 10)]);
		await expect.element(page.getByText('a.ZIP')).toBeVisible();
		await expect.element(page.getByText('(10 B)')).toBeVisible();
		select(input, [file('b.png', 2048, 'image/png')]);
		await expect.element(page.getByText('(2.0 KB)')).toBeVisible();
		select(input, [file('c.pdf', 2 * 1048576, 'application/pdf')]);
		await expect.element(page.getByText('(2.0 MB)')).toBeVisible();
		expect(onchange).toHaveBeenLastCalledWith([expect.any(File)]);
	});

	it('rejects unsupported types and too large files', async () => {
		render(FileDrop, { name: 'f', label: 'Upload', accept: '.zip,text/plain', maxSize: 100 });
		const input = page.getByLabelText('Upload').element() as HTMLInputElement;
		select(input, [file('x.exe', 10, 'application/x-msdownload')]);
		await expect.element(page.getByRole('alert')).toHaveTextContent('File "x.exe" has an unsupported type.');
		expect(input.value).toBe('');
		await expect.element(input).toHaveAttribute('aria-invalid', 'true');
		select(input, [file('big.zip', 1000)]);
		await expect.element(page.getByRole('alert')).toHaveTextContent('File "big.zip" is too large (maximum 100 B).');
		select(input, [file('ok.txt', 5, 'text/plain')]);
		await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
	});

	it('supports drag and drop (keeps the first file)', async () => {
		render(FileDrop, { name: 'f', label: 'Upload' });
		const zone = page.getByText('Drop files here or click to browse.').element().closest('label')!;
		drop(zone, [file('one.txt', 1), file('two.txt', 1)]);
		await expect.element(page.getByText('one.txt')).toBeVisible();
		await expect.element(page.getByText('two.txt')).not.toBeInTheDocument();
		zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
		zone.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
		drop(zone, []);
		await expect.element(page.getByText('one.txt')).toBeVisible();
	});

	it('ignores drops when disabled by a fieldset', async () => {
		const fieldset = document.body.appendChild(document.createElement('fieldset'));
		render(FileDrop, { target: fieldset, props: { name: 'f', label: 'Upload' } });
		const zone = page.getByText('Drop files here or click to browse.').element().closest('label')!;
		drop(zone, [file('same.txt', 1)]);
		await expect.element(page.getByText('same.txt')).toBeVisible();
		fieldset.disabled = true;
		drop(zone, [file('late.txt', 1)]);
		await expect.element(page.getByText('late.txt')).not.toBeInTheDocument();
		fieldset.remove();
	});
});
