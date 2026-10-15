/**
 * Job queue status (NAV-17): snapshot of the running and waiting grading
 * jobs (refreshed every 10 s by the backend client). Superadmins and the
 * admins of the job's course may kill a job (POST only, unknown jobs refused).
 */
import { fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { services } from '#lib/server/app.js';
import { isCourseAdmin } from '#lib/server/courses/members.js';
import { findCourse } from '#lib/server/courses/course.js';
import { requireUser } from '#lib/server/security/guards.js';
import type { CurrentUser } from '../../app.d.ts';
import type { Actions, PageServerLoad } from './$types';

/** Superadmin, or admin of the course of a job whose info is "<courseid>/<taskid>". */
function killable(info: string, user: CurrentUser): boolean {
	const course = findCourse(info.split('/')[0]);
	return user.superadmin || (!!course && isCourseAdmin(course, user.username));
}

/**
 * The current snapshot as plain rows (times in epoch ms, null = no timeout). The backend always
 * sends a job info ("<courseid>/<taskid>", or the environment of course-less jobs, see
 * `handle_client_get_queue` of inginious.backend), and -1 as maximum time when unknown.
 */
function snapshot(user: CurrentUser) {
	const q = services().backend.queue;
	return {
		running: (q?.running ?? []).map(([id, , agent, info, launcher, start, max]) => ({
			id,
			agent,
			info: info!,
			launcher,
			start: start * 1000,
			end: max < 0 ? null : (start + max) * 1000,
			kill: killable(info!, user)
		})),
		waiting: (q?.waiting ?? []).map(([id, , info, launcher, max]) => ({
			id,
			info: info!,
			launcher,
			max: max < 0 ? null : max,
			kill: killable(info!, user)
		}))
	};
}

export const load: PageServerLoad = (event) => snapshot(requireUser(event));

export const actions: Actions = {
	/** Asks the backend to kill a listed job. */
	kill: async (event) => {
		const { running, waiting } = snapshot(requireUser(event));
		const jobid = String((await event.request.formData()).get('jobid'));
		if (![...running, ...waiting].some((j) => j.id === jobid && j.kill))
			return fail(403, { message: t("You're not allowed to do that") });
		services().backend.killJob(jobid);
		return { message: t('Kill request sent.') };
	}
};
