/**
 * Student group page (NAV-16): the user's group, the groups he may join and
 * the join/quit actions (POST only). Rules: staff get a 403, joining checks the course, the audiences and the free seats
 * atomically and keeps the current group when the join fails (`joinGroup`).
 */
import { error, fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { courseIsOpenToUser, requireCourse } from '#lib/server/courses/access.js';
import {
	allowedGroups,
	courseGroups,
	isCourseStaff,
	isRegistered,
	joinGroup,
	leaveGroup
} from '#lib/server/courses/members.js';
import type { GroupDoc } from '#lib/server/db/types.js';
import { services } from '#lib/server/app.js';
import { courseName, courseNav, lastTried, progress } from '#lib/server/nav/courses.js';
import { forbidLti, requireUser } from '#lib/server/security/guards.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** The course menu headed by the course context card, like the course layout (docs/design-system.md). */
async function contextNav(id: string, nav: ReturnType<typeof courseNav>) {
	const [{ title, items }] = await nav;
	return [{ title, context: t('Course'), contextHref: `/course/${id}`, items: [] }, { items }];
}

/** Registered, non-staff student of an accessible course. */
async function guard(event: RequestEvent) {
	forbidLti(event);
	const { username } = requireUser(event);
	const course = requireCourse(event.params.courseid);
	if (isCourseStaff(course, username)) error(403, t("You can't access this page as a member of the staff."));
	if ((await courseIsOpenToUser(course, username, false)) !== true || !(await isRegistered(course, username)))
		error(403, t('You are not registered to this course.'));
	return { username, course };
}

export const load: PageServerLoad = async (event) => {
	const { username, course } = await guard(event);
	const lang = event.locals.lang;
	const all = await courseGroups(course.id);
	const mine = all.find((g) => g.students?.includes(username));
	const users = await services()
		.db.c.users.find({ username: { $in: all.flatMap((g) => g.students ?? []) } })
		.toArray();
	// Only the public fields of the members are sent to the browser.
	const member = (u: string, d = users.find((x) => x.username === u)) => ({
		username: u,
		realname: d?.realname ?? '',
		email: d?.email ?? ''
	});
	const view = (g: GroupDoc) => ({
		id: String(g._id),
		description: g.description,
		available: g.size - (g.students?.length ?? 0),
		members: (g.students ?? []).map((u) => member(u))
	});
	// Same grade and "last tried" scope (visible tasks) as the course page.
	const [groups, { grade }, tried] = await Promise.all([
		allowedGroups(course.id, username),
		progress(course, username),
		lastTried(username, [course], lang)
	]);
	return {
		course: { id: course.id, name: courseName(course, lang) },
		choice: course.groupsStudentChoice,
		hasGroups: all.length > 0,
		mine: mine ? view(mine) : null,
		groups: groups.map(view),
		grade,
		lastTried: tried,
		canUnregister: course.allowUnregister,
		nav: await contextNav(course.id, courseNav(course, username, lang))
	};
};

/** Guard of the actions: students may change group only when the course allows it. */
async function changeGuard(event: RequestEvent) {
	const access = await guard(event);
	if (!access.course.groupsStudentChoice) error(403, t('You are not allowed to change group.'));
	return access;
}

export const actions: Actions = {
	/** Joins a group (leaving the current one), atomically checked by `joinGroup`. */
	join: async (event) => {
		const { username, course } = await changeGuard(event);
		const groupid = String((await event.request.formData()).get('groupid'));
		if (!(await joinGroup(course.id, username, groupid)))
			return fail(400, { message: t("Couldn't register to the specified group.") });
	},
	/** Leaves the current group. */
	leave: async (event) => {
		const { username, course } = await changeGuard(event);
		if (!(await leaveGroup(course.id, username))) return fail(400, { message: t("You're not registered in a group.") });
	}
};
