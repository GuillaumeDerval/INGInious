/**
 * Course access rules and course-level guards (NAV-05/06/07/15, TASK-14/16/18,
 * course-model.md §4 and §7; architecture §4.1).
 *
 * The guards answer with real status codes: 404 for unknown/invalid courses, 403
 * when the user may not access the course, and a redirect to the sign-in page
 * for anonymous users (through `requireUser`).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { error, redirect } from '@sveltejs/kit';
import type { CurrentUser } from '../../../app.d.ts';
import { t } from '#lib/i18n/index.js';
import { services } from '../app.js';
import type { UserDoc } from '../db/types.js';
import { requireUser, type GuardEvent } from '../security/guards.js';
import { afterStart, isOpen } from './accessible.js';
import { findCourse, type Course } from './course.js';
import { accessibility, groupSubmission, taskConfig } from './dispenser.js';
import { addStudent, checkTokens, isCourseAdmin, isCourseStaff, isRegistered, userGroup } from './members.js';
import { findTask, type Task } from './task.js';

/** Why a course is not open to a user (legacy `course_is_open_to_user` reasons). */
export type ClosedReason = 'closed' | 'unregistered_not_previewable' | 'lti_only' | 'lti_not_registered';

/** User fields needed by the registration access control. */
export type AclUser = Pick<UserDoc, 'username' | 'email' | 'bindings'>;

/** The ACL-relevant user document (null for anonymous visitors or unknown users). */
export async function aclUser(username: string | null | undefined): Promise<AclUser | null> {
	return username ? services().db.c.users.findOne({ username }) : null;
}

/**
 * Legacy `course_is_open_to_user`.
 * @param lti true in an LTI session, false outside, null to ignore LTI rules.
 * @returns true or the reason why the course is closed to the user.
 */
export async function courseIsOpenToUser(
	course: Course,
	username: string | null,
	lti: boolean | null
): Promise<true | ClosedReason> {
	if (isCourseStaff(course, username)) return true;
	if (!isOpen(course.accessible)) return 'closed';
	if (!course.allowPreview && !(await isRegistered(course, username))) return 'unregistered_not_previewable';
	if (lti && !course.isLti) return 'lti_only';
	if (lti === false && course.ltiSendBackGrade) return 'lti_not_registered';
	return true;
}

/** Registration access control list (NAV-07): allow/deny list of usernames, e-mails or binding ids. */
export function isAcceptedByAcl(course: Course, user: AclUser | null): boolean {
	if (!course.registrationAc) return true;
	if (!user) return false;
	const keys =
		course.registrationAc === 'binding'
			? Object.keys(user.bindings ?? {})
			: [String(user[course.registrationAc] ?? '')];
	const match = keys.some((k) => course.registrationAcRegex.test(k));
	return course.registrationAcAccept ? match : !match;
}

/** Course open, registration period open and ACL accepting the user (legacy `is_registration_possible`). */
export function isRegistrationPossible(course: Course, user: AclUser | null): boolean {
	return isOpen(course.accessible) && isOpen(course.registration) && isAcceptedByAcl(course, user);
}

/** Constant-time string comparison (registration passwords). */
export function safeEqual(a: string, b: string): boolean {
	const h = (s: string) => createHash('sha256').update(s).digest();
	return timingSafeEqual(h(a), h(b));
}

/**
 * Registers a user to a course (legacy `course_register_user`, NAV-06).
 * Unless `force`, registration must be possible and the password right.
 * @returns false for unknown users, refused registrations, wrong passwords and already registered users.
 */
export async function registerUser(
	course: Course,
	username: string,
	password: string | null,
	force = false
): Promise<boolean> {
	const user = await aclUser(username);
	if (!user) return false;
	if (!force) {
		if (!isRegistrationPossible(course, user)) return false;
		if (
			course.registrationPassword !== null &&
			(password === null || !safeEqual(course.registrationPassword, password))
		)
			return false;
	}
	if (await isRegistered(course, username)) return false;
	await addStudent(course.id, username);
	return true;
}

/** Legacy `task_is_visible_by_user`: (course open and task started) or staff. */
export async function taskIsVisibleByUser(
	course: Course,
	taskid: string,
	username: string | null,
	lti: boolean | null
): Promise<boolean> {
	if (isCourseStaff(course, username)) return true;
	return (
		afterStart(accessibility(course.dispenser, taskid, username)) &&
		(await courseIsOpenToUser(course, username, lti)) === true
	);
}

/**
 * Legacy `task_can_user_submit` (without its unused `only_check`): staff always;
 * otherwise registered, course open, task open (hard deadline), a group for
 * group tasks, and submission tokens left for the user (or every member of his group).
 */
export async function taskCanUserSubmit(
	course: Course,
	taskid: string,
	username: string,
	{ lti = null }: { lti?: boolean | null } = {}
): Promise<boolean> {
	if (isCourseStaff(course, username)) return true;
	if (!(await isRegistered(course, username)) || (await courseIsOpenToUser(course, username, lti)) !== true)
		return false;
	if (!isOpen(accessibility(course.dispenser, taskid, username))) return false;
	const isGroupTask = groupSubmission(course.dispenser, taskid);
	const group = isGroupTask ? await userGroup(course.id, username) : null;
	if (isGroupTask && !group) return false;
	return checkTokens(
		course.id,
		taskid,
		group ? group.students : [username],
		taskConfig(course.dispenser, taskid).submissionLimit
	);
}

/** Result of the course guards. */
export interface CourseAccess {
	course: Course;
	user: CurrentUser | null;
	/** Registered student or staff. */
	registered: boolean;
	staff: boolean;
	admin: boolean;
}

/**
 * Loads a course or answers 404 "Course not found." (invalid id, unknown or
 * unloadable course).
 */
export function requireCourse(courseid: string): Course {
	return findCourse(courseid) ?? error(404, t('Course not found.'));
}

/** Loads a task of a course or answers 404 "Task not found." (missing, invalid or broken: see `findTask`). */
export function requireTask(course: Course, taskid: string): Task {
	return findTask(course, taskid) ?? error(404, t('Task not found.'));
}

/** Message of the "course unavailable" error for a closed reason (NAV-05). */
export function closedMessage(reason: ClosedReason): string {
	return reason === 'closed' || reason === 'unregistered_not_previewable'
		? t('This course is closed.')
		: t(
				'This course must be accessed on an external platform. Read the course description or contact the teaching team for more information.'
			);
}

/**
 * Requires access to a course page: registered user, staff, or any visitor
 * when the course is open with `allow_preview` (NAV-15). Unregistered users
 * who may register are redirected to `/register/<id>` (NAV-05); others get a
 * 403 with the legacy explanation. The LTI rules use the session's LTI flag.
 */
export async function requireCourseAccess(event: GuardEvent, courseid: string): Promise<CourseAccess> {
	const course = requireCourse(courseid);
	const preview = course.allowPreview && isOpen(course.accessible);
	const user = !preview || event.locals.user ? requireUser(event) : null;
	const username = user?.username ?? null;
	const reason = await courseIsOpenToUser(course, username, Boolean(event.locals.session.doc.is_lti));
	if (reason !== true) {
		if (reason === 'unregistered_not_previewable') {
			if (isRegistrationPossible(course, await aclUser(username))) redirect(302, `/register/${course.id}`);
		}
		error(403, closedMessage(reason));
	}
	return {
		course,
		user,
		registered: await isRegistered(course, username),
		staff: isCourseStaff(course, username),
		admin: isCourseAdmin(course, username)
	};
}

/** Requires a tutor, an admin of the course or a superadmin. */
export async function requireCourseStaff(
	event: GuardEvent,
	courseid: string
): Promise<CourseAccess & { user: CurrentUser }> {
	const course = requireCourse(courseid);
	const user = requireUser(event);
	if (!isCourseStaff(course, user.username)) error(403, t('You are not allowed to access this page.'));
	return {
		course,
		user,
		registered: true,
		staff: true,
		admin: isCourseAdmin(course, user.username)
	};
}

/** Requires an admin of the course or a superadmin. */
export async function requireCourseAdmin(
	event: GuardEvent,
	courseid: string
): Promise<CourseAccess & { user: CurrentUser }> {
	const access = await requireCourseStaff(event, courseid);
	if (!access.admin) error(403, t('You are not allowed to access this page.'));
	return access;
}
