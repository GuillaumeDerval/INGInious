/** /scoreboard/<courseid> (SITE-13): list of the scoreboards of a course. */
import {
	requireCourseMember,
	scoreboardNames
} from '#lib/server/plugins/bundled/inginious.frontend.plugins.scoreboard.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { course, page } = await requireCourseMember(event);
	return { ...page, boards: scoreboardNames(course) };
};
