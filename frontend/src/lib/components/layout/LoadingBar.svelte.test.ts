// Component tests of LoadingBar and of the loading state (loading.svelte.ts).
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import LoadingBar from './LoadingBar.svelte';
import { loading, start, track } from './loading.svelte.js';

describe('LoadingBar', () => {
	it('appears only after the delay and disappears when loading ends', async () => {
		const bar = page.getByRole('progressbar', { name: 'Loading...' });
		const { rerender } = render(LoadingBar, { active: false, delay: 0 });
		await new Promise((r) => setTimeout(r, 20));
		await expect.element(bar).not.toBeInTheDocument();
		await rerender({ active: true, delay: 0 });
		await expect.element(bar).toBeVisible();
		await rerender({ active: false, delay: 0 });
		await expect.element(bar).not.toBeInTheDocument();
	});

	it('does not flash for responses faster than the delay', async () => {
		const { rerender } = render(LoadingBar, { active: true, delay: 300 });
		await new Promise((r) => setTimeout(r, 50));
		await rerender({ active: false, delay: 300 });
		await new Promise((r) => setTimeout(r, 400));
		await expect.element(page.getByRole('progressbar')).not.toBeInTheDocument();
	});
});

describe('loading state', () => {
	it('is active while tracked requests are pending', async () => {
		expect(loading.active).toBe(false);
		let resolve!: (v: string) => void;
		const request = track(new Promise<string>((r) => (resolve = r)));
		const end = start();
		expect(loading.active).toBe(true);
		resolve('done');
		expect(await request).toBe('done');
		expect(loading.active).toBe(true);
		end();
		expect(loading.active).toBe(false);
		await expect(track(Promise.reject(new Error('boom')))).rejects.toThrow('boom');
		expect(loading.active).toBe(false);
	});
});
