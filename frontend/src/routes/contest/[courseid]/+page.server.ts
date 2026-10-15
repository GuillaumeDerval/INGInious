/** /contest/<courseid> (SITE-14): contest scoreboard, for registered students and staff. */
import { contestScoreboard, MODULE } from '#lib/server/plugins/bundled/inginious.frontend.plugins.contests.js';
import { requireCourseMember } from '#lib/server/plugins/bundled/inginious.frontend.plugins.scoreboard.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { course, username, page } = await requireCourseMember(event, MODULE);
	return { ...page, ...(await contestScoreboard(course, username, event.locals.lang, event.locals.user!.timezone)) };
};
