/**
 * Job queue status (NAV-17): snapshot of the running and waiting grading
 * jobs (refreshed every 10 s by the backend client). Every job is listed, so
 * that everybody sees how busy the graders are, but the course/task and the
 * launcher (usernames) are only shown to superadmins and to the staff of the
 * job's course: other rows keep their timing and have `info`/`launcher` null.
 * Superadmins and the admins of the job's course may kill a job (POST only,
 * unknown jobs refused).
 */
import { fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { services } from '#lib/server/app.js';
import { isCourseAdmin, isCourseStaff } from '#lib/server/courses/members.js';
import { findCourse } from '#lib/server/courses/course.js';
import { requireUser } from '#lib/server/security/guards.js';
import type { CurrentUser } from '../../app.d.ts';
import type { Actions, PageServerLoad } from './$types';

/** Rights of `user` on a job whose info is "<courseid>/<taskid>": see its details, kill it. */
function rights(info: string, user: CurrentUser): { visible: boolean; kill: boolean } {
	if (user.superadmin) return { visible: true, kill: true };
	const course = findCourse(info.split('/')[0]);
	return {
		visible: !!course && isCourseStaff(course, user.username),
		kill: !!course && isCourseAdmin(course, user.username)
	};
}

/** Job details shown to the user: info and launcher, or nulls when the job is not theirs to see. */
function details(info: string, launcher: string, user: CurrentUser) {
	const { visible, kill } = rights(info, user);
	return visible ? { info, launcher, kill } : { info: null, launcher: null, kill };
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
			...details(info!, launcher, user),
			start: start * 1000,
			end: max < 0 ? null : (start + max) * 1000
		})),
		waiting: (q?.waiting ?? []).map(([id, , info, launcher, max]) => ({
			id,
			...details(info!, launcher, user),
			max: max < 0 ? null : max
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
