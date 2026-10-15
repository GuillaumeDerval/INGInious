/** /scoreboard/<courseid>/<index> (SITE-13): one ranking. */
import { requireCourseMember, scoreboard } from '#lib/server/plugins/bundled/inginious.frontend.plugins.scoreboard.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { course, page } = await requireCourseMember(event);
	return { ...page, ...(await scoreboard(course, event.params.scoreboardid, event.locals.lang)) };
};
