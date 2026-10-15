// Component tests of Footer (CORE-01, AUTH-18).
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Footer from './Footer.svelte';

describe('Footer', () => {
	it('shows version, licence and the privacy link when configured', async () => {
		render(Footer, { version: '1.2.3', privacyHref: '/pages/privacy' });
		await expect.element(page.getByText('Running INGInious v.1.2.3')).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'INGInious is distributed under AGPL license' })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/pages/privacy');
	});

	it('shows the short LTI text and no privacy link by default', async () => {
		render(Footer, { version: '1.2.3', lti: true });
		await expect.element(page.getByText(/Powered by INGInious v.1.2.3/)).toBeVisible();
		await expect.element(page.getByText('Running INGInious')).not.toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: 'Privacy Policy' })).not.toBeInTheDocument();
	});
});
