/**
 * Staff view of one submission (CSTU-15) and its replays (CSTU-14).
 * Requires staff rights on the submission's OWN course; malformed or unknown
 * ids and removed tasks are 404 (legacy: 500). In-place replay and debug
 * replay are admin-only; "replay as me" (copy) is open to the staff and
 * redirects to the task page where the new submission is shown.
 */
import { error, redirect } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { services } from '#lib/server/app.js';
import { requireCourseAdmin, requireCourseStaff, requireTask } from '#lib/server/courses/access.js';
import { userSawTask } from '#lib/server/courses/members.js';
import { adminNav } from '#lib/server/course-admin/nav.js';
import { userInfos } from '#lib/server/course-students/people.js';
import { tagBadges } from '#lib/server/course-students/query.js';
import { debugDump, displayResult, renderFeedback } from '#lib/server/submissions/feedback.js';
import { findSubmission, replaySubmission, type DebugMode } from '#lib/server/submissions/manager.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** Loads the submission, checks the rights on its course (admin when `admin`) and loads its task. */
async function context(event: RequestEvent, admin = false) {
	const sub = await findSubmission(event.params.submissionid, {});
	if (!sub) error(404, t("This submission doesn't exist."));
	const access = await (admin ? requireCourseAdmin : requireCourseStaff)(event, sub.courseid);
	return { ...access, sub, task: requireTask(access.course, sub.taskid) };
}

/** Display text of an input value (uploaded files by name). */
const show = (v: unknown) =>
	v && typeof v === 'object' && 'filename' in v
		? t('File: {}', v.filename)
		: typeof v === 'string'
			? v
			: JSON.stringify(v);

export const load: PageServerLoad = async (event) => {
	const { course, task, sub, admin } = await context(event);
	const lang = event.locals.lang;
	const input = await services().db.getInput(sub.input);
	const defined = task.problems.map((p) => ({
		id: p.id,
		name: task.tr(lang, String(p.content.name ?? '')) || p.id,
		defined: true
	}));
	const extra = Object.keys(input)
		.filter((k) => !k.startsWith('@') && !defined.some((p) => p.id === k))
		.map((id) => ({ id, name: id, defined: false }));
	const infos = await userInfos(sub.username);
	return {
		// The page is part of the course administration: same sidebar, "Submissions" active.
		nav: await adminNav(course, admin, lang, 'submissions'),
		admin,
		course: { id: course.id, name: course.tr(lang, course.name) },
		task: { id: task.id, name: task.tr(lang, task.name) },
		submission: {
			id: String(sub._id),
			status: sub.status,
			result: displayResult(sub),
			grade: sub.grade ?? 0,
			submittedOn: sub.submitted_on.toISOString(),
			users: sub.username.map((u) => ({ username: u, realname: infos[u].realname || u }))
		},
		inputs: [...defined, ...extra].map((p) => ({ ...p, value: p.id in input ? show(input[p.id]) : '' })),
		feedback: sub.status === 'waiting' ? null : renderFeedback(sub, true),
		tags: tagBadges(course, sub.tests),
		debug: admin ? JSON.stringify(debugDump(sub), null, 2) : null
	};
};

/** Replays the submission as a copy owned by the current staff member, then shows the task page. */
async function copy(event: RequestEvent, debug: DebugMode) {
	const { course, task, sub, user } = await context(event, !!debug);
	await userSawTask(user.username, course.id, task.id);
	await replaySubmission(sub, course, task, {
		copy: { username: user.username, userIp: event.getClientAddress() },
		debug
	});
	redirect(303, `/course/${course.id}/${task.id}`);
}

export const actions: Actions = {
	replay: async (event) => {
		const { course, task, sub } = await context(event, true);
		await replaySubmission(sub, course, task);
		return { message: t('Submission set for replay.') };
	},
	copy: (event) => copy(event, false),
	debug: (event) => copy(event, 'ssh')
};
