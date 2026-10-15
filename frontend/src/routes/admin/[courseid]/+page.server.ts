/**
 * `/admin/<courseid>` (CADM-02): tutors go to the task list, admins and
 * superadmins to the settings (a user both tutor and admin goes to the tasks).
 */
import { redirect } from '@sveltejs/kit';
import { requireCourseStaff } from '#lib/server/courses/access.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { course, user } = await requireCourseStaff(event, event.params.courseid);
	redirect(302, `/admin/${course.id}/${course.tutors.includes(user.username) ? 'tasks' : 'settings'}`);
};
