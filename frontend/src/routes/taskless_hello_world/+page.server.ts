/** /taskless_hello_world (SITE-21): page of the "taskless-hello-world" plugin, superadmins only. */
import { z } from 'zod';
import { parseForm } from '#lib/server/forms.js';
import { requirePlugin } from '#lib/server/plugins/index.js';
import { helloWorld, MODULE } from '#lib/server/plugins/bundled/inginious.frontend.plugins.taskless-hello-world.js';
import { requireSuperadmin, type GuardEvent } from '#lib/server/security/guards.js';
import type { Actions, PageServerLoad } from './$types';

/** 404 when the plugin is disabled, superadmins only. */
function guard(event: GuardEvent): void {
	requirePlugin(MODULE);
	requireSuperadmin(event);
}

export const load: PageServerLoad = (event) => guard(event);

export const actions: Actions = {
	/** Runs the job and returns its result (the request waits for the grader). */
	default: async (event) => {
		guard(event);
		const { name } = await parseForm(event.request, z.object({ name: z.string() }));
		const [result, feedback] = await helloWorld(name);
		return { result, feedback };
	}
};
