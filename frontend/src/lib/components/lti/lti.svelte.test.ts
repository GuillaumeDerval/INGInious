// Component tests of the LTI pages (LTI-04 login/bind, LTI-10 deep-link picker; LTI-05 is TaskView's LTI mode).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import LtiLogin from './LtiLogin.svelte';
import LtiBind from './LtiBind.svelte';
import DeepLinkPicker from './DeepLinkPicker.svelte';

const nav = vi.hoisted(() => ({ invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => nav);
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('LtiLogin', () => {
	it('LTI-04 offers the bind link in a new tab and polls for the binding', async () => {
		render(LtiLogin, { bindUrl: '/lti/bind?lti_session_id=tok', pollMs: 20 });
		const link = page.getByRole('link', { name: 'Bind your INGInious account' });
		await expect.element(link).toHaveAttribute('target', '_blank');
		await expect.element(link).toHaveAttribute('href', '/lti/bind?lti_session_id=tok');
		await vi.waitFor(() => expect(nav.invalidateAll.mock.calls.length).toBeGreaterThan(1));
		const before = nav.invalidateAll.mock.calls.length;
		await userEvent.click(page.getByRole('button', { name: 'Refresh' }));
		expect(nav.invalidateAll.mock.calls.length).toBeGreaterThan(before);
	});
});

describe('LtiBind', () => {
	const props = {
		user: { username: 'alice', realname: 'Alice' },
		lti: {
			tool_name: 'MockLMS',
			tool_description: 'Desc',
			tool_url: 'http://lms',
			context_label: 'C101',
			context_title: 'Course',
			username: 'lms-1',
			realname: 'LMS One'
		}
	};

	it('LTI-04 shows what will be bound, errors, and the success message', async () => {
		const closed = vi.fn();
		vi.stubGlobal('close', closed);
		render(LtiBind, { ...props, message: 'Your account is already bound with this context.' });
		await expect.element(page.getByText('Alice [alice]')).toBeVisible();
		await expect.element(page.getByText('C101 - Course')).toBeVisible();
		await expect.element(page.getByText('lms-1 - LMS One')).toBeVisible();
		await expect.element(page.getByText('Your account is already bound with this context.')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Bind my account' })).toBeVisible();
		await userEvent.click(page.getByRole('button', { name: 'Cancel' }));
		expect(closed).toHaveBeenCalled();
		document.body.innerHTML = '';
		render(LtiBind, props);
		await expect.element(page.getByRole('button', { name: 'Bind my account' })).toBeVisible();
		expect(page.getByRole('alert').elements()).toHaveLength(1);
		document.body.innerHTML = '';
		render(LtiBind, { ...props, bound: true });
		await expect.element(page.getByText(/Your account is now bound/)).toBeVisible();
		expect(page.getByRole('button').elements()).toHaveLength(0);
	});
});

describe('DeepLinkPicker', () => {
	const courses = [
		{ id: 'c1', name: 'Course 1', tasks: [{ id: 't1', name: 'Task 1' }] },
		{ id: 'c2', name: 'Course 2', tasks: [] }
	];

	it('LTI-10 picks a course then a task', async () => {
		render(DeepLinkPicker, { courses });
		const select = page.getByRole('button', { name: 'Select' });
		await expect.element(select).toBeDisabled();
		await userEvent.selectOptions(page.getByLabelText('Course'), 'c2');
		await expect.element(page.getByText('-- No task available --')).toBeInTheDocument();
		await userEvent.selectOptions(page.getByLabelText('Course'), 'c1');
		await userEvent.selectOptions(page.getByLabelText('Task'), 't1');
		await expect.element(select).toBeEnabled();
	});

	it('LTI-10 posts the signed response to the platform; explains an empty list', async () => {
		const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
		render(DeepLinkPicker, { courses, response: { url: 'https://lms/return', jwt: 'a.b.c' } });
		await vi.waitFor(() => expect(submit).toHaveBeenCalled());
		const form = document.querySelector<HTMLFormElement>('form[action="https://lms/return"]')!;
		expect(new FormData(form).get('JWT')).toBe('a.b.c');
		submit.mockRestore();
		document.body.innerHTML = '';
		render(DeepLinkPicker, { courses: [], response: { message: 'x' } });
		await expect.element(page.getByText('No LTI course available')).toBeVisible();
	});
});
