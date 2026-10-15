/**
 * Port of the legacy "upcoming_tasks" plugin (NAV-20): a `main_menu` entry
 * and the /coming_tasks page (routes/coming_tasks) listing, across the
 * user's courses, the unfinished open tasks whose soft deadline falls within
 * the chosen number of days.
 *
 * Fixes the legacy crash (naive vs aware datetime comparison): instants are
 * epoch milliseconds, so the comparison is always timezone-safe.
 */
import { t } from '#lib/i18n/index.js';
import type { NavItem } from '#lib/components/layout/nav.js';
import type { PluginRegistry } from '../index.js';
import { isOpen } from '../../courses/accessible.js';
import type { Course } from '../../courses/course.js';
import { courseName, progress, taskName, userTasksByCourse } from '../../nav/courses.js';
import { pageSlice } from '../../pagination.js';

/** Legacy module name of the plugin. */
export const MODULE = 'inginious.frontend.plugins.upcoming_tasks';

/** Registers the "Upcoming Tasks" main menu entry. */
export function init(registry: PluginRegistry): void {
	registry.addHook('main_menu', (): NavItem => ({ label: t('Upcoming Tasks'), href: '/coming_tasks' }));
}

/** A course with its upcoming tasks of the page, ordered by soft deadline, and its number of upcoming tasks. */
export interface UpcomingCourse {
	id: string;
	name: string;
	count: number;
	tasks: { id: string; name: string; deadline: string; grade: number }[];
}

/** Upcoming tasks per page (the courses of a page are those of its tasks). */
export const TASKS_PER_PAGE = 50;

/**
 * Upcoming tasks of a user (legacy `coming_tasks` page logic): open, started,
 * not succeeded tasks whose soft deadline is before now + `days` (no limit:
 * 100000 days, so tasks without deadline are never listed); courses ordered by
 * their most urgent task. Unlike legacy, which skipped every `is_lti` course,
 * the courses are the user's listed courses (`userCourses`: LTI courses are
 * left out only when reserved to LTI sessions).
 *
 * Scale: the grading states come from one query, and the list is paginated by
 * `TASKS_PER_PAGE` tasks (a course may continue on the next page); task names
 * are only loaded for the page (unloadable tasks are dropped from it) and for
 * the most urgent task of each course.
 * @param courses the user's courses (`userCourses`).
 * @param wished requested page (1-based, see `pageSlice`).
 * @returns the courses of the page, the number of upcoming tasks and the page slice.
 */
export async function upcomingTasks(
	username: string,
	courses: Course[],
	lang: string,
	days: number | null,
	wished: unknown = 1
) {
	const now = Date.now();
	const limit = now + (days ?? 100_000) * 86_400_000;
	const states = await userTasksByCourse(
		username,
		courses.map((c) => c.id)
	);
	const found = [];
	for (const course of courses) {
		const { acc, visible, docs } = await progress(course, username, states.get(course.id));
		const ids = visible
			.filter((id) => isOpen(acc[id], now) && acc[id].softEnd <= limit && !docs.get(id)?.succeeded)
			.sort((a, b) => acc[a].softEnd - acc[b].softEnd);
		// The most urgent task, which orders the courses, must be loadable.
		while (ids.length && taskName(course, ids[0], lang) === null) ids.shift();
		if (ids.length) found.push({ course, acc, docs, ids, first: acc[ids[0]].softEnd });
	}
	const entries = found.sort((a, b) => a.first - b.first).flatMap((f) => f.ids.map((id) => ({ f, id })));
	const slice = pageSlice(entries.length, wished, TASKS_PER_PAGE);
	const out: UpcomingCourse[] = [];
	for (const { f, id } of entries.slice(slice.skip, slice.skip + slice.limit)) {
		const name = taskName(f.course, id, lang);
		if (name === null) continue;
		if (out.at(-1)?.id !== f.course.id)
			out.push({ id: f.course.id, name: courseName(f.course, lang), count: f.ids.length, tasks: [] });
		const deadline = new Date(f.acc[id].softEnd).toISOString();
		out.at(-1)!.tasks.push({ id, name, deadline, grade: f.docs.get(id)?.grade ?? 0 });
	}
	return { courses: out, count: entries.length, ...slice };
}
