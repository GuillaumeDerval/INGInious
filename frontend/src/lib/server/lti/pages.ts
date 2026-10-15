/**
 * Server logic of the LTI pages: login and binding (LTI-04) and the pages reached
 * through the signed `?session_id=` (LTI-05 task page, LTI-06 assets, LTI-10
 * deep-link picker). The task page
 * reuses the normal task page domain (`loadTaskPage` / `taskAction`).
 *
 * Rules (LTI-05/06/10):
 *  - the LTI 1.3 deployment secret is checked on EVERY request of a 1.3 session
 *    (page, submissions, assets), whatever the URL;
 *  - the user is only auto-registered to LTI courses;
 *  - not logged-in sessions are sent to the binding step (the iframe offers no
 *    password login);
 *  - relative links/images of the statement point to `/lti/asset/…` for both versions
 *    (1.3 assets were broken in legacy), a leading `public/` being optional;
 *  - the deep-link response requires a bound course administrator.
 */
import { randomBytes } from 'node:crypto';
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { services } from '../app.js';
import { closedMessage, registerUser, requireCourse, safeEqual } from '../courses/access.js';
import { courseTaskIds, listCourses, saveCourse, type Course } from '../courses/course.js';
import { isCourseAdmin } from '../courses/members.js';
import { findTask, getTask } from '../courses/task.js';
import type { LtiData } from '../db/types.js';
import type { TaskPageData } from '#lib/components/task/types.js';
import { onSubmissionDone } from '../submissions/manager.js';
import { loadTaskPage, serveTaskFile, taskAction } from '../task/page.js';
import { requireUser } from '../security/guards.js';
import {
	bindAccount,
	bindTarget,
	bindToken,
	externalUrl,
	ltiLogin,
	ltiUrl,
	requireLti,
	sessionToken
} from './common.js';
import { DL_CLAIM, deepLinkResponse, launchClient } from './lti13.js';
import { drain, enqueue } from './outcomes.js';

let started = false;

/** Starts (once) the grade passback: completion listener and processing of the entries left by a previous run. */
export function initLti(): void {
	if (started) return;
	started = true;
	onSubmissionDone(enqueue);
	void drain();
}

/** LTI-05 submission tags (legacy `_before_submission_insertion`), only when grades are sent back. */
export function ltiTags(lti: LtiData, course: Course): Record<string, unknown> {
	if (!course.ltiSendBackGrade) return {};
	return lti.version === '1.3'
		? { lti_version: '1.3', message_launch_id: lti.message_launch_id }
		: {
				lti_version: '1.1',
				outcome_service_url: lti.outcome_service_url,
				outcome_result_id: lti.outcome_result_id,
				outcome_consumer_key: lti.consumer_key
			};
}

/** Login page of the session's LTI version. */
const loginUrl = (lti: LtiData, event: RequestEvent) => ltiUrl(lti, 'login', sessionToken(event));

/**
 * Guard of the LTI task pages: LTI session (403), valid 1.3 deployment secret (403
 * "Invalid LTI secret"), logged in (else redirect to the login step); registers the
 * user to the course (LTI courses only) on the first visit.
 */
export async function requireLtiTask(event: RequestEvent): Promise<{ lti: LtiData; course: Course; taskid: string }> {
	initLti();
	const lti = requireLti(event);
	const course = requireCourse(lti.task[0]);
	const expected = course.ltiSecrets[String(lti.platform_instance_id)];
	if (lti.version === '1.3' && !(expected && lti.course_secret && safeEqual(expected, lti.course_secret)))
		error(403, t('Invalid LTI secret'));
	if (!event.locals.user) redirect(302, loginUrl(lti, event));
	// LTI-05/13: a non-LTI course cannot be used through LTI (and nobody is registered into it).
	if (!course.isLti) error(403, closedMessage('lti_only'));
	await registerUser(course, event.locals.user.username, null, true);
	return { lti, course, taskid: lti.task[1] };
}

/** Rewrites a relative statement URL to the asset proxy, keeping the session token (LTI-06). */
export function assetUrl(url: string, token: string): string {
	if (url.startsWith('/')) return url;
	const u = new URL(url, 'http://lti/lti/asset/');
	u.searchParams.set('session_id', token);
	return u.pathname + u.search + u.hash;
}

/** LTI-05 page data: the normal task page data, statement with LTI asset links, and the action URL. */
export async function loadLtiTask(event: RequestEvent): Promise<TaskPageData> {
	const { course, taskid } = await requireLtiTask(event);
	const token = sessionToken(event);
	const data = await loadTaskPage(event, course.id, taskid, (url) => assetUrl(url, token));
	// Legacy LTI task page: student view (TaskView hides the navigation when `actionUrl` is set).
	const studentView = { admin: false, webterm: null, courseHidden: false, taskHidden: false };
	return { ...data, ...studentView, actionUrl: `${event.url.pathname}?session_id=${token}` };
}

/** LTI-05 JSON actions (submit, check, load, kill); new submissions get the LTI tags. */
export async function ltiTaskAction(event: RequestEvent): Promise<Response> {
	const { lti, course, taskid } = await requireLtiTask(event);
	return taskAction(event, course.id, taskid, ltiTags(lti, course));
}

/** LTI-06 `/lti/asset/<path>`: a public file of the session's task. */
export async function ltiAsset(event: RequestEvent, path: string): Promise<Response> {
	const { course, taskid } = await requireLtiTask(event);
	return serveTaskFile(event, course.id, taskid, path.replace(/^public\//, ''));
}

/** LTI-10 context: the stored deep-linking launch of the session and the LTI courses administered by the bound user. */
async function deepLinkContext(event: RequestEvent) {
	const lti = requireLti(event);
	if (!event.locals.user) redirect(302, loginUrl(lti, event));
	const { username } = event.locals.user;
	const claims = (await services().db.c.ltiLaunch.findOne({ key: String(lti.message_launch_id) }))?.value as
		Record<string, unknown> | undefined;
	if (!claims?.[`${DL_CLAIM}deep_linking_settings`]) error(403, t('This is not a deep linking launch.'));
	return { lti, claims, courses: [...listCourses().values()].filter((c) => c.isLti && isCourseAdmin(c, username)) };
}

/**
 * LTI-10 picker data: administered LTI courses and their tasks (names in the user
 * language). Tasks that cannot be loaded (invalid task.yaml) are left out instead
 * of making the whole picker fail.
 */
export async function deepLinkData(event: RequestEvent) {
	const tr = (x: { tr: Course['tr']; name: string }) => x.tr(event.locals.lang, x.name);
	const { courses } = await deepLinkContext(event);
	return {
		courses: courses.map((c) => ({
			id: c.id,
			name: tr(c),
			tasks: courseTaskIds(c).flatMap((id) => {
				const task = findTask(c, id);
				return task ? [{ id, name: tr(task) }] : [];
			})
		}))
	};
}

/**
 * LTI-10 selection: creates the deployment secret of the course when missing
 * (saved in course.yaml) and returns the signed deep-linking response to post.
 */
export async function deepLinkSelect(event: RequestEvent): Promise<{ url: string; jwt: string }> {
	const { lti, claims, courses } = await deepLinkContext(event);
	const form = await event.request.formData();
	const course =
		courses.find((c) => c.id === form.get('courseid')) ?? error(403, t('You are not allowed to access this page.'));
	const taskid = String(form.get('taskid'));
	if (!courseTaskIds(course).includes(taskid)) error(404, t('Task not found.'));
	const pid = String(lti.platform_instance_id);
	const secret = course.ltiSecrets[pid] || randomBytes(16).toString('hex');
	if (!course.ltiSecrets[pid])
		saveCourse(course.id, { ...course.content, lti_secrets: { ...course.ltiSecrets, [pid]: secret } });
	const client = launchClient(course, claims) ?? error(400, t('Unknown LTI platform.'));
	const { tr, name } = getTask(course, taskid);
	return deepLinkResponse(client, claims, {
		title: tr(event.locals.lang, name),
		url: `${externalUrl(event).origin}/lti1.3/launch`,
		custom: { courseid: course.id, taskid, secret }
	});
}

/** LTI-04 `/lti[1.3]/login`: redirects a bound user to the LTI target, else returns the bind link (short-lived token). */
export async function loginPage(event: RequestEvent): Promise<{ bindUrl: string }> {
	const target = await ltiLogin(event);
	if (target) redirect(302, target);
	return {
		bindUrl: `${event.url.pathname.replace(/login$/, 'bind')}?lti_session_id=${bindToken(event.locals.session.doc._id)}`
	};
}

/** LTI-04 `/lti[1.3]/bind` (normal session, logged-in user): what is going to be bound. */
export async function bindPage(event: RequestEvent) {
	const user = requireUser(event);
	const { tool_name, tool_description, tool_url, context_label, context_title, username, realname } = await bindTarget(
		event.url.searchParams.get('lti_session_id')
	);
	return {
		user: { username: user.username, realname: user.realname },
		lti: { tool_name, tool_description, tool_url, context_label, context_title, username, realname }
	};
}

/** LTI-04 bind action (CSRF-protected form action). */
export async function bindAction(event: RequestEvent) {
	const user = requireUser(event);
	if (!(await bindAccount(user.username, await bindTarget(event.url.searchParams.get('lti_session_id')))))
		return fail(400, { message: t('Your account is already bound with this context.') });
	return { bound: true };
}
