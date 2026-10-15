// Component tests of the error page (CORE-02) with a mocked `$app/state`.
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ErrorPage from './+error.svelte';

const state = vi.hoisted(() => ({
	page: { status: 404, error: { message: 'Not Found' } as { message: string } | null }
}));
vi.mock('$app/state', () => state);

/** Renders the error page for a status and message. */
function show(status: number, message: string | null) {
	state.page.status = status;
	state.page.error = message === null ? null : { message };
	return render(ErrorPage);
}

describe('+error.svelte', () => {
	it('404 hides the generic SvelteKit message', async () => {
		show(404, 'Not Found');
		await expect.element(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
		await expect.element(page.getByText('Error 404')).toBeVisible();
		await expect.element(page.getByTestId('error-message')).not.toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
		expect(document.title).toBe('Page not found | INGInious');
	});

	it('403 shows the specific message as text', async () => {
		show(403, '<b>You are not allowed</b>');
		await expect.element(page.getByRole('heading', { name: 'Forbidden' })).toBeVisible();
		await expect.element(page.getByTestId('error-message')).toHaveTextContent('<b>You are not allowed</b>');
	});

	it('other 4xx and 5xx statuses', async () => {
		show(400, 'Bad thing');
		await expect.element(page.getByRole('heading', { name: 'Error 400' })).toBeVisible();
		await expect.element(page.getByTestId('error-message')).toHaveTextContent('Bad thing');
		document.body.innerHTML = '';
		show(500, 'Internal Error');
		await expect.element(page.getByRole('heading', { name: 'Internal error' })).toBeVisible();
		await expect.element(page.getByText(/Something bad happened/)).toBeVisible();
		await expect.element(page.getByTestId('error-message')).not.toBeInTheDocument();
		document.body.innerHTML = '';
		show(502, null);
		await expect.element(page.getByTestId('error-message')).not.toBeInTheDocument();
	});
});
