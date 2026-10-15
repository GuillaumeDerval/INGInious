// Component tests of the authentication components (AUTH-05/07/08/09/11/16).
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import SigninForm from './SigninForm.svelte';
import PasswordFields from './PasswordFields.svelte';
import TosCheckbox from './TosCheckbox.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

const tos = { terms: '/pages/terms', privacy: '/pages/privacy' };
describe('auth components', () => {
	it('SigninForm shows providers above the password form', async () => {
		render(SigninForm, {
			methods: [
				{ id: 'gh', name: 'Github', imlink: null },
				{ id: 'saml', name: 'SSO', imlink: '/sso.png' }
			],
			redirect: '/course/a',
			login: 'jdoe'
		});
		await expect.element(page.getByRole('button', { name: 'Sign in with Github' })).toBeVisible();
		expect(document.querySelector('form[action="/auth/signin/saml"] img')!.getAttribute('src')).toBe('/sso.png');
		expect(document.querySelectorAll('input[name="redirect"][value="/course/a"]')).toHaveLength(3);
		await expect.element(page.getByLabelText('Username')).toHaveValue('jdoe');
		await expect.element(page.getByText('or', { exact: true })).toBeVisible();
		document.body.innerHTML = '';
		render(SigninForm, { methods: [{ id: 'gh', name: 'Github', imlink: null }], redirect: '/', passwordForm: false });
		await expect.element(page.getByLabelText('Password')).not.toBeInTheDocument();
		await expect.element(page.getByText('or', { exact: true })).not.toBeInTheDocument();
		document.body.innerHTML = '';
		render(SigninForm, { methods: [], redirect: '/' });
		await expect.element(page.getByLabelText('Username')).toHaveValue('');
		await expect.element(page.getByRole('link', { name: 'Lost password?' })).toBeVisible();
	});

	it('SigninForm is also the form of form-based external methods (LDAP)', async () => {
		render(SigninForm, { methods: [], redirect: '/', external: { imlink: '/l.png' } });
		expect(document.querySelector('img[src="/l.png"]')).not.toBeNull();
		await expect.element(page.getByLabelText('Password')).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Lost password?' })).not.toBeInTheDocument();
		document.body.innerHTML = '';
		render(SigninForm, { methods: [], redirect: '/', external: { imlink: null } });
		expect(document.querySelector('img')).toBeNull();
	});

	it('PasswordFields hints the strength and the mismatch', async () => {
		render(PasswordFields, {});
		await expect.element(page.getByText('Password (min. 10 characters) :')).toBeVisible();
		await userEvent.fill(page.getByLabelText(/^Password/), 'abcdefghi');
		await expect.element(page.getByText('Too short')).toBeVisible();
		await userEvent.fill(page.getByLabelText(/^Password/), 'abcdefghij');
		await expect.element(page.getByText('Weak')).toBeVisible();
		await userEvent.fill(page.getByLabelText(/^Password/), 'Abcdefgh1!xyzwvut');
		await expect.element(page.getByText('Strong')).toBeVisible();
		await userEvent.fill(page.getByLabelText(/Confirm password/), 'x');
		await expect.element(page.getByText("Passwords don't match !")).toBeVisible();
		document.body.innerHTML = '';
		render(PasswordFields, { newPassword: true, required: false, minLength: 12 });
		await expect.element(page.getByText('New password (min. 12 characters) :')).toBeVisible();
		await expect.element(page.getByLabelText(/New password/)).not.toBeRequired();
		await expect.element(page.getByLabelText(/Confirm new password/)).toBeVisible();
	});

	it('TosCheckbox links both pages', async () => {
		render(TosCheckbox, { links: tos, checked: true });
		await expect.element(page.getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', '/pages/terms');
		await expect.element(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/pages/privacy');
		await expect.element(page.getByRole('checkbox')).toBeChecked();
	});
});
