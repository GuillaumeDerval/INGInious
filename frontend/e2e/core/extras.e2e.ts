/**
 * Integration tests of features that need a specific server configuration:
 * the per-user API key used as WebDAV password (AUTH-19, `webdav_host` set) and
 * the task editor example plugin (SITE-17, plugin enabled).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, installCourse, withDb } from '../fixtures.js';
import { useApp, appUrl } from '../auth/helpers.js';
import { E2E } from '../setup-data.js';

/** Course used by these tests (superadmin is one of its admins). */
const COURSE = 'e2e_core_extras';

test.beforeAll(() => {
	installCourse('task_showcase', COURSE);
});

test.describe('API key', () => {
	useApp(8, { webdav_host: `${appUrl(8)}/dav` });

	test('AUTH-19 the API key is generated once on request, shown as WebDAV password and accepted by WebDAV', async ({
		loginAs,
		request
	}) => {
		// Only this test uses the API key of superadmin.
		await withDb((db) => db.collection('users').updateOne({ username: 'superadmin' }, { $unset: { apikey: '' } }));
		const page = await loginAs('superadmin');
		await page.goto(`/admin/${COURSE}/tasks`);
		const password = page.getByLabel('Password', { exact: true });
		await expect(page.getByText('WebDAV access')).toBeVisible();
		await expect(page.getByLabel('Username', { exact: true })).toHaveValue('superadmin');
		// CADM-06: viewing the page does not create the key, the button does.
		await expect(password).toHaveCount(0);
		const stored = () =>
			withDb(async (db) => (await db.collection('users').findOne({ username: 'superadmin' }))?.apikey);
		expect(await stored()).toBeUndefined();
		await page.getByRole('button', { name: 'Generate secret' }).click();
		await expect(password).toBeAttached();
		const key = await password.inputValue();
		expect(await stored()).toBe(key);
		expect(key).toMatch(/^[0-9a-f]{80}$/);
		await page.reload();
		await expect(password).toHaveValue(key);
		const propfind = (password: string) =>
			request.fetch(`${appUrl(8)}/dav/${COURSE}/`, {
				method: 'PROPFIND',
				headers: { Authorization: `Basic ${btoa(`superadmin:${password}`)}`, Depth: '1' }
			});
		expect((await propfind(key)).status()).toBe(207);
		expect((await propfind('0'.repeat(80))).status()).toBe(401);
	});
});

test.describe('task editor plugin', () => {
	useApp(9, { plugins: [{ plugin_module: 'inginious.frontend.plugins.task_editor_hook_example' }] });

	test('SITE-17 the example plugin adds editor tabs and validates the task hint', async ({ loginAs }) => {
		const page = await loginAs('superadmin');
		await page.goto(`/admin/${COURSE}/edit/task/code_python`);
		await expect(page.getByRole('tab', { name: 'Example tab', exact: true })).toBeVisible();
		await page.getByRole('tab', { name: 'Example tab 2' }).click();
		await expect(page.getByText(`(id: "${COURSE}")`)).toBeVisible();
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('You must provide a task hint in Example tab 2').first()).toBeVisible();
		await page.getByLabel('Task hint').fill('Think about loops');
		await page.getByRole('button', { name: 'Save' }).click();
		const taskYaml = () => readFileSync(join(E2E.tasksDir, COURSE, 'code_python', 'task.yaml'), 'utf8');
		await expect.poll(taskYaml).toContain('example_task_hint: Think about loops');
		expect(taskYaml()).toContain('example_field: test');
	});
});
