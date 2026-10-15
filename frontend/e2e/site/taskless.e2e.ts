/**
 * Integration tests of the taskless-hello-world plugin (SITE-21) on an extra
 * server where it is enabled. The job runs on the "default" docker
 * environment of the Colima stack, with a run command (`run_cmd` option)
 * doing what the run.py of the legacy plugin container does.
 */
import { test, expect } from '../fixtures.js';
import { useApp } from '../auth/helpers.js';

/** The legacy container's run.py (the run command is split on spaces and needs an absolute path: base64-encoded script). */
const RUN = `from inginious_container_api import feedback, input
feedback.set_global_feedback("Hello World! I am " + input.get_input("hello_world_name"))
feedback.set_global_result("success")
`;
useApp(6, {
	plugins: [
		{
			plugin_module: 'inginious.frontend.plugins.taskless-hello-world',
			environment: 'default',
			run_cmd: `/usr/bin/python3 -c exec(__import__('base64').b64decode('${Buffer.from(RUN).toString('base64')}'))`
		}
	]
});

test('SITE-21 a superadmin runs a taskless job and sees the result of the grader', async ({ loginAs }) => {
	test.setTimeout(120_000);
	const page = await loginAs('superadmin');
	await page.goto('/taskless_hello_world');
	await page.getByLabel('Input your name').fill('Bob');
	await page.getByRole('button', { name: 'Run Job' }).click();
	await expect(page.getByRole('status')).toContainText('Hello World! I am Bob', { timeout: 100_000 });
	await expect(page.getByRole('status')).toContainText('Succeeded');
});

test('SITE-21 the taskless job page is reserved to superadmins', async ({ loginAs }) => {
	const page = await loginAs('e2e_student1');
	expect((await page.goto('/taskless_hello_world'))!.status()).toBe(403);
});
