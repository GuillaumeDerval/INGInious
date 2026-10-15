/**
 * Port of the legacy "taskless-hello-world" plugin (SITE-21): the page
 * /taskless_hello_world (routes/taskless_hello_world) runs a grading job that
 * belongs to no course nor task (a "taskless job": `courseId`/`taskId` null)
 * with the visitor's name as input (`hello_world_name`) and shows the global
 * result and feedback of the grader. Options (new): `environment_type`
 * (default "docker"), `environment` (default "taskless-hello-world", the image
 * of the legacy plugin), `run_cmd` (command run in the container instead of
 * its run file, e.g. to use another environment) and `timeout` (seconds,
 * default 60).
 *
 * Behaviour: the page is restricted to superadmins and a job that does not end in time (e.g. environment
 * present on no agent: the backend queues it forever) is killed instead of
 * blocking the request indefinitely.
 */
import { t } from '#lib/i18n/index.js';
import type { PluginConfig } from '../../config.js';
import type { SPResult } from '../../backend/client.js';
import type { PluginRegistry } from '../index.js';
import { services } from '../../app.js';

/** Legacy module name of the plugin. */
export const MODULE = 'inginious.frontend.plugins.taskless-hello-world';

let options: PluginConfig = { plugin_module: MODULE };

/** Keeps the plugin options (the page checks `requirePlugin`). */
export function init(_registry: PluginRegistry, opts: PluginConfig): void {
	options = opts;
}

/**
 * Runs the taskless job for `name` (legacy `ClientSync.new_job` call).
 * @returns the global result and feedback (backend errors are crash results).
 */
export function helloWorld(name: string): Promise<SPResult> {
	const { backend } = services();
	return new Promise((resolve) => {
		let timer: NodeJS.Timeout | undefined;
		const job = {
			priority: 0,
			courseId: null,
			taskId: null,
			problems: {},
			input: { hello_world_name: name },
			environmentType: String(options.environment_type ?? 'docker'),
			environment: String(options.environment ?? 'taskless-hello-world'),
			environmentParameters: options.run_cmd ? { run_cmd: String(options.run_cmd) } : {},
			debug: false,
			launcher: 'Plugin - taskless Hello World'
		};
		const id = backend.newJob(job, { onDone: (r) => (clearTimeout(timer), resolve(r.result)) });
		const timeout = () => (backend.killJob(id!), resolve(['timeout', t('The job did not end in time.')]));
		if (id) timer = setTimeout(timeout, Number(options.timeout ?? 60) * 1000);
	});
}
