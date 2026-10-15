/**
 * Course administration layout (CADM-02): every `/admin/<courseid>/...` page
 * requires course staff (tutor, admin or superadmin; real 403 otherwise) and
 * gets the administration menu (lib/server/course-admin/nav.ts).
 */
import { requireCourseStaff } from '#lib/server/courses/access.js';
import { adminNav } from '#lib/server/course-admin/nav.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const { course, admin } = await requireCourseStaff(event, event.params.courseid);
	const lang = event.locals.lang;
	return {
		nav: await adminNav(course, admin, lang),
		admin,
		adminCourse: { id: course.id, name: course.tr(lang, course.name) }
	};
};
