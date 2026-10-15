/** Component tests of the course administration pages (CADM-03..16) with loaded data. */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Danger from './danger/+page.svelte';
import Settings from './settings/+page.svelte';
import Tasks from './tasks/+page.svelte';
import EditTask from './edit/task/[taskid]/+page.svelte';
import Files from './edit/task/[taskid]/files/+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
const appPage = vi.hoisted(() => ({
	url: new URL('http://x/admin/c/edit/task/t/files'),
	status: 200,
	form: null as unknown
}));
vi.mock('$app/state', () => ({ page: appPage }));

const layout = { adminCourse: { id: 'c', name: 'Course C' } };

describe('course administration pages', () => {
	it('CADM-15/16 danger zone', async () => {
		render(Danger, { data: { ...layout, archived: false }, form: { archive: 'c_a', message: 'Archived.' } } as never);
		await expect.element(page.getByText('Archived.')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Archive course data' })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Administration' })).toHaveAttribute('href', '/admin/c');
		render(Danger, { data: { ...layout, archived: true }, form: { message: 'Wrong course id.' } } as never);
		await expect.element(page.getByText('You cannot archive it again.', { exact: false })).toBeVisible();
	});
	it('CADM-03/04 settings with the LTI card', async () => {
		const values = {
			name: 'Course C',
			admins: [],
			tutors: [],
			is_lti: true,
			lti_secrets: { 'i/cid/d1': 's3cret' },
			tags: []
		};
		const client = { iss: 'i', clientId: 'cid', deploymentIds: ['d1', 'd2'], publicKey: 'PK', keysetHash: 'h' };
		const clients = [
			{ ...client, type: 'course' },
			{ ...client, type: 'global', deploymentIds: [] }
		];
		render(Settings, { data: { ...layout, values, clients } } as never);
		await expect.element(page.getByText('/lti1.3/jwks/c/h')).toBeVisible();
		await expect.element(page.getByText('/lti1.3/jwks/h')).toBeVisible();
		await expect.element(page.getByLabelText('Secret', { exact: true })).toHaveValue('s3cret');
		await page.getByRole('button', { name: 'Generate secret' }).click();
		await expect.element(page.getByRole('button', { name: 'Generate secret' })).not.toBeInTheDocument();
		await page.getByRole('button', { name: 'Delete' }).first().click();
		await expect.element(page.getByLabelText('Secret', { exact: true })).not.toHaveValue('s3cret');
		for (const title of ['General', 'Access & registration', 'LTI', 'Tags'])
			await expect.element(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
		await expect.element(page.getByText('/lti/c/<taskid>', { exact: false })).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Tags' })).toHaveAttribute('href', '#tags');
	});
	it('CADM-03 settings of an LTI course explain the hidden access card', async () => {
		render(Settings, {
			data: { ...layout, values: { is_lti: true, admins: [], tutors: [], tags: [], lti_secrets: {} }, clients: [] }
		} as never);
		await expect.element(page.getByText('Access and registration are managed by the LTI platform.')).toBeVisible();
		await expect.element(page.getByText('No LTI 1.3 client')).toBeVisible();
	});
	it('CADM-06..09 task list with WebDAV, legacy banner and combinatory tests', async () => {
		const data = {
			...layout,
			kind: 'combinatory_test',
			dispensers: ['toc', 'combinatory_test'],
			structure: { toc: [], config: {} },
			tasks: {},
			errors: {},
			legacy: true,
			webdav: { url: 'http://dav/c', username: 'ann', password: 'k3y' }
		};
		render(Tasks, { data } as never);
		await expect.element(page.getByLabelText('Password', { exact: true })).toHaveValue('k3y');
		await expect.element(page.getByRole('button', { name: 'Migrate tasks' })).toBeVisible();
		await expect.element(page.getByText('Combinatory tests')).toBeVisible();
		render(Tasks, { data: { ...data, kind: 'toc', legacy: false, webdav: null } } as never);
		await expect.element(page.getByRole('button', { name: 'Add section' }).last()).toBeVisible();
	});
	it('CADM-10..13 task editor with a plugin tab', async () => {
		render(EditTask, {
			data: {
				...layout,
				taskid: 't',
				values: { name: 'T', environment_type: 'docker', environment_id: 'default' },
				problems: [{ id: 'p', type: 'code', name: 'P' }],
				environments: { docker: ['default'] },
				tabs: [{ id: 'x', label: 'Plugin tab', text: 'Hello plugin', fields: [] }]
			}
		} as never);
		await page.getByRole('tab', { name: 'Plugin tab' }).click();
		await expect.element(page.getByText('Hello plugin')).toBeVisible();
		await page.getByRole('tab', { name: 'Problems' }).click();
		await expect.element(page.getByText('P', { exact: true }).first()).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Task files' }).last())
			.toHaveAttribute('href', '/admin/c/edit/task/t/files');
	});
	it('CADM-10 task editor lists a save error and opens the tab of the faulty field', async () => {
		appPage.status = 400;
		appPage.form = { message: 'Timeout limit (in seconds): a number >= 1 is expected.' };
		render(EditTask, {
			data: {
				...layout,
				taskid: 't',
				values: {
					name: '',
					environment_type: 'docker',
					environment_id: 'default',
					environment_parameters: { limits: { time: 0 } }
				},
				problems: [],
				environments: {},
				tabs: []
			}
		} as never);
		await expect.element(page.getByText('The task was not saved')).toBeVisible();
		await expect
			.element(page.getByRole('tab', { name: 'Grading environment' }))
			.toHaveAttribute('aria-selected', 'true');
		await expect
			.element(page.getByLabelText('Timeout limit (in seconds)', { exact: true }))
			.toHaveAttribute('aria-invalid', 'true');
		appPage.status = 200;
		appPage.form = null;
	});
	it('CADM-14 task files page', async () => {
		render(Files, { data: { ...layout, taskid: 't', files: [], opened: null } } as never);
		await expect
			.element(page.getByRole('link', { name: 'Edit task "t"' }))
			.toHaveAttribute('href', '/admin/c/edit/task/t');
		await expect.element(page.getByRole('link', { name: 'Task list' })).toHaveAttribute('href', '/admin/c/tasks');
	});
});
