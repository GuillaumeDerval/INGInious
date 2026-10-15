/**
 * Upcoming tasks board of the upcoming_tasks plugin (NAV-20): 404 when the
 * plugin is disabled. The time planner is a read-only GET filter
 * (`?time_planner=7|14|30`, anything else = unlimited); the list is paginated (`?page=`).
 */
import { requirePlugin } from '#lib/server/plugins/index.js';
import { MODULE, upcomingTasks } from '#lib/server/plugins/bundled/inginious.frontend.plugins.upcoming_tasks.js';
import { lastTried, mainMenu, userCourses } from '#lib/server/nav/courses.js';
import { forbidLti, requireUser } from '#lib/server/security/guards.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	requirePlugin(MODULE);
	forbidLti(event);
	const { username } = requireUser(event);
	const lang = event.locals.lang;
	const planner = event.url.searchParams.get('time_planner') ?? '';
	const days = ['7', '14', '30'].includes(planner) ? Number(planner) : null;
	const courses = await userCourses(username, lang);
	return {
		planner: days ? planner : 'unlimited',
		...(await upcomingTasks(username, courses, lang, days, event.url.searchParams.get('page'))),
		lastTried: await lastTried(username, courses, lang),
		nav: await mainMenu()
	};
};
