// Component tests of the authentication pages (rendering of their load data).
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { SafeHtml } from '#lib/utils/safe-html.js';
import Home from './+page.svelte';
import StaticPage from './pages/[pageid]/+page.svelte';
import Signin from './signin/+page.svelte';
import Logout from './logout/+page.svelte';
import Register from './register/+page.svelte';
import PrefsLayout from './preferences/+layout.svelte';
import Profile from './preferences/profile/+page.svelte';
import Bindings from './preferences/bindings/+page.svelte';
import Delete from './preferences/delete/+page.svelte';
import Callback from './auth/callback/[authid]/+page.svelte';
import FormPage from './auth/page/[authid]/+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://x/preferences/profile') } }));

/** Renders a page with load data (and an optional action result). */
const show = (Page: unknown, data: Record<string, unknown>, form: unknown = null) =>
	render(Page as never, { data, form, params: {} } as never);
const reset = () => (document.body.innerHTML = '');
const tos = { terms: '/pages/terms', privacy: '/pages/privacy' };
const profile = {
	username: '',
	realname: 'J',
	email: 'j@x.org',
	language: 'en',
	timezone: 'UTC',
	codeIndentation: '4',
	hasPassword: false
};

describe('auth pages', () => {
	it('AUTH-01/02 home and static pages render the rich text', async () => {
		show(Home, { title: 'Welcome', html: '<p>Hello</p>' as SafeHtml });
		await expect.element(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
		reset();
		show(StaticPage, { title: 'Terms', html: '<p>The terms</p>' as SafeHtml });
		await expect.element(page.getByText('The terms')).toBeVisible();
	});

	it('AUTH-05/06 sign-in and logout pages', async () => {
		show(Signin, { methods: [], redirect: '/', passwordForm: true }, { login: 'jdoe' });
		await expect.element(page.getByLabelText('Username')).toHaveValue('jdoe');
		reset();
		show(Signin, { methods: [], redirect: '/', passwordForm: true });
		await expect.element(page.getByLabelText('Username')).toHaveValue('');
		reset();
		show(Logout, {});
		await expect.element(page.getByRole('button', { name: 'Log out' })).toBeVisible();
	});

	it('AUTH-07/08 the registration page switches between activation, reset and registration', async () => {
		const data = { tos: null, activate: null, reset: null, invalidReset: false };
		show(Register, data, { reset: { token: 't', realname: 'J', username: 'jd' } });
		await expect.element(page.getByText('Set new password for J [jd]')).toBeVisible();
		reset();
		show(Register, { ...data, reset: { token: 'r', realname: 'John', username: 'jdoe' } });
		await expect.element(page.getByText('Set new password for John [jdoe]')).toBeVisible();
		reset();
		show(Register, { ...data, tos, activate: 'tok' });
		await expect.element(page.getByRole('button', { name: 'Activate my account' })).toBeVisible();
		reset();
		show(Register, { ...data, tos, invalidReset: true });
		await expect.element(page.getByText('Invalid reset hash.')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
		await expect.element(page.getByRole('checkbox')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Reset my password' })).toBeVisible();
		reset();
		show(Register, data);
		await expect.element(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
		await expect.element(page.getByRole('checkbox')).not.toBeInTheDocument();
	});

	it('AUTH-11/12/13 preferences layout: current tab and isolated deletion', async () => {
		const layout = (allowDeletion: boolean) =>
			render(PrefsLayout as never, { data: { allowDeletion }, children: (() => {}) as never } as never);
		layout(true);
		await expect.element(page.getByRole('link', { name: 'My profile' })).toHaveAttribute('aria-current', 'page');
		await expect.element(page.getByRole('link', { name: 'Delete my account' })).toHaveClass(/text-error/);
		reset();
		layout(false);
		await expect.element(page.getByRole('link', { name: 'Delete my account' })).not.toBeInTheDocument();
	});

	it('AUTH-11 the profile page pre-fills the values and hides what does not apply', async () => {
		const full = { ...profile, username: 'jdoe', language: 'fr', timezone: 'Mars/Base', codeIndentation: 'tabs' };
		show(Profile, { profile: { ...full, hasPassword: true }, passwords: true, tos, tosSigned: true });
		await expect.element(page.getByLabelText('Username :')).toBeDisabled();
		await expect.element(page.getByLabelText('Email address :')).toBeDisabled();
		await expect.element(page.getByLabelText('Language :')).toHaveValue('fr');
		await expect.element(page.getByLabelText('Timezone :')).toHaveValue('Mars/Base');
		await expect.element(page.getByLabelText('Code indentation :')).toHaveValue('tabs');
		await expect.element(page.getByLabelText('Old password :')).toBeVisible();
		await expect.element(page.getByRole('checkbox')).toBeChecked();
		await expect.element(page.getByText('Please set a new username')).not.toBeInTheDocument();
		reset();
		show(Profile, { profile, passwords: true, tos, tosSigned: false });
		await expect.element(page.getByLabelText('Username :')).toBeEnabled();
		await expect.element(page.getByLabelText('Old password :')).not.toBeInTheDocument();
		await expect.element(page.getByText('Please set a new username')).toBeVisible();
		await expect.element(page.getByText('Please accept the Terms of Service and Data Privacy')).toBeVisible();
		reset();
		show(Profile, { profile: full, passwords: false, tos: null, tosSigned: false });
		await expect.element(page.getByLabelText(/New password/)).not.toBeInTheDocument();
	});

	it('AUTH-12/13 bindings and deletion pages', async () => {
		show(Bindings, {
			bindings: [
				{ id: 'gh', name: 'Github', identifier: '999', additional: [], configured: true },
				{ id: 'saml', name: 'saml', identifier: 'u1', additional: [['studentid', '42']], configured: false }
			],
			available: [{ id: 'go', name: 'Google' }]
		});
		await expect.element(page.getByText('999')).toBeVisible();
		await expect.element(page.getByText('saml.studentid')).toBeVisible();
		expect(page.getByRole('button', { name: 'Refresh fields' }).elements()).toHaveLength(1);
		expect(page.getByRole('button', { name: 'Revoke access' }).elements()).toHaveLength(2);
		await expect.element(page.getByRole('option', { name: 'Google' })).toBeInTheDocument();
		reset();
		show(Bindings, { bindings: [], available: [] });
		await expect.element(page.getByText('No authentication binding.')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Add new binding' })).not.toBeInTheDocument();
		reset();
		show(Delete, { email: 'j@x.org' });
		await page.getByRole('button', { name: 'Delete my account' }).click();
		await expect.element(page.getByRole('alertdialog')).toBeVisible();
	});

	it('AUTH-16/17 LDAP form and SAML re-post', async () => {
		show(FormPage, { name: 'LDAP', imlink: '/l.png' });
		await expect.element(page.getByRole('heading', { name: 'LDAP' })).toBeVisible();
		expect(document.querySelector('img[src="/l.png"]')).not.toBeNull();
		await expect.element(page.getByLabelText('Password')).toBeVisible();
		reset();
		const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
		show(Callback, {}, { repost: { SAMLResponse: 'r', RelayState: 's' } });
		await expect.poll(() => submit.mock.calls.length).toBe(1);
		expect(document.querySelector<HTMLInputElement>('input[name="SAMLResponse"]')!.value).toBe('r');
		reset();
		show(Callback, {});
		expect(document.querySelector('form')).toBeNull();
		submit.mockRestore();
	});
});
