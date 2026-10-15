/**
 * Course self-registration (NAV-06, NAV-07): the form is only shown when the
 * user is not registered yet and registration is possible (period open, ACL
 * accepting him); otherwise the user goes to the course page, which explains
 * why. The password is compared in constant time (see `registerUser`).
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { aclUser, isRegistrationPossible, registerUser } from '#lib/server/courses/access.js';
import { isRegistered } from '#lib/server/courses/members.js';
import { findCourse } from '#lib/server/courses/course.js';
import { courseName } from '#lib/server/nav/courses.js';
import { forbidLti, requireUser } from '#lib/server/security/guards.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** Guard shared by the page and its action: logged-in user and existing course. */
function guard(event: RequestEvent) {
	forbidLti(event);
	const user = requireUser(event);
	const course = findCourse(event.params.courseid);
	if (!course) error(404, t("This course doesn't exist."));
	return { user, course };
}

export const load: PageServerLoad = async (event) => {
	const { user, course } = guard(event);
	if ((await isRegistered(course, user.username)) || !isRegistrationPossible(course, await aclUser(user.username)))
		redirect(303, `/course/${course.id}`);
	return { id: course.id, name: courseName(course, event.locals.lang), password: course.registrationPassword !== null };
};

export const actions: Actions = {
	default: async (event) => {
		const { user, course } = guard(event);
		const password = (await event.request.formData()).get('register_password');
		// Legacy uses the same message for every failure (closed, ACL, already registered).
		if (!(await registerUser(course, user.username, typeof password === 'string' ? password : null)))
			return fail(400, { message: t('Invalid password.') });
		redirect(303, `/course/${course.id}`);
	}
};
