/**
 * User search for the staff pickers (CSTU-03): `GET ?q=<text>` answers
 * up to 10 activated users whose username or real name contains the text
 * (case-insensitive; the text is regex-escaped), as `[{value, label}]`.
 */
import { json } from '@sveltejs/kit';
import { services } from '#lib/server/app.js';
import { requireCourseStaff } from '#lib/server/courses/access.js';
import { userOptions } from '#lib/server/course-students/people.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	await requireCourseStaff(event, event.params.courseid);
	const q = (event.url.searchParams.get('q') ?? '').slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const users = await services()
		.db.c.users.find(
			{
				$or: [{ username: { $regex: q, $options: 'i' } }, { realname: { $regex: q, $options: 'i' } }],
				activate: { $exists: false },
				username: { $ne: '' }
			},
			{ projection: { username: 1 }, limit: 10 }
		)
		.toArray();
	return json(await userOptions(users.map((u) => u.username)));
};
