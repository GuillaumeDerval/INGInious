/**
 * View models of the student-side navigation pages (NAV-01..21), built on top
 * of the course domain (`#lib/server/courses/*`): course cards, the user's
 * course list, the "last tried exercises" widget, the course task tree and
 * the sidebar sections. Everything returned is plain serialisable data with
 * translated strings.
 */
import { t } from '#lib/i18n/index.js';
import type { NavItem, NavSection } from '#lib/components/layout/nav.js';
import type { LastTriedItem, SectionView, TaskItem } from '#lib/components/nav/types.js';
import { services } from '../app.js';
import type { UserTaskDoc } from '../db/types.js';
import { pageSlice } from '../pagination.js';
import { afterStart, isOpen } from '../courses/accessible.js';
import { isRegistrationPossible, type AclUser } from '../courses/access.js';
import { courseTaskIds, listCourses, type Course } from '../courses/course.js';
import {
	accessibilities,
	accessibility,
	courseGrade,
	taskConfig,
	sectionTasks,
	type TocSection
} from '../courses/dispenser.js';
import { isCourseAdmin, isCourseStaff, isRegistered, pinnedCourses, userGroup } from '../courses/members.js';
import { findTask } from '../courses/task.js';
import { plugins } from '../plugins/index.js';
import { renderText } from '../text/index.js';

/** Translated name of a course. */
export const courseName = (c: Course, lang: string) => c.tr(lang, c.name);

/** Translated name of a task, null when the task cannot be loaded. */
export function taskName(c: Course, taskid: string, lang: string): string | null {
	const task = findTask(c, taskid);
	return task && task.tr(lang, task.name);
}

/** Sorts courses by translated name in Python (code point) order, like legacy (each name translated once). */
function byName(courses: Course[], lang: string): Course[] {
	const names = new Map(courses.map((c) => [c, courseName(c, lang)]));
	return courses.sort((a, b) => (names.get(a)! < names.get(b)! ? -1 : 1));
}

/** Courses per page of the course grids (/courselist, /mycourses): 2 or 3 columns. */
export const COURSES_PER_PAGE = 24;

/**
 * Courses whose translated name or id contains `q` (case-insensitive; every
 * course for an empty search): server-side search of the course grids (NAV-01/02).
 */
export function searchCourses(courses: Course[], q: string, lang: string): Course[] {
	const needle = q.trim().toLowerCase();
	return courses.filter((c) => `${courseName(c, lang)}\n${c.id}`.toLowerCase().includes(needle));
}

/**
 * Course card (NAV-01): sanitized `description` (rst, or Markdown with `#MD`),
 * `ltiUrl` (http/https only, else null), and what the viewer can do with the
 * course: `autoRegistration` (self-registration possible for him), `password`
 * (a registration password is configured), `registered` (registered or staff)
 * and `preview` (`allow_preview`).
 * @param registered true when the viewer is registered to (or staff of) the course.
 */
export function courseCard(c: Course, lang: string, user: AclUser | null, registered = false) {
	return {
		id: c.id,
		name: courseName(c, lang),
		description: renderText(c.tr(lang, c.description), { language: lang }),
		isLti: c.isLti,
		ltiUrl: /^https?:\/\//i.test(c.ltiUrl) ? c.ltiUrl : null,
		autoRegistration: isRegistrationPossible(c, user),
		password: c.registrationPassword !== null,
		registered,
		preview: c.allowPreview
	};
}

/** Courses open to everybody now (NAV-01: not closed, future or archived), sorted by name. */
export const publicCourses = (lang: string) =>
	byName(
		[...listCourses().values()].filter((c) => isOpen(c.accessible)),
		lang
	);

/**
 * Courses of a user (NAV-02, NAV-20, NAV-21): every course for staff,
 * otherwise the registered courses open outside LTI, sorted by name. This is
 * legacy `course_is_open_to_user(lti=False)` for registered users, i.e. the
 * single notion of "LTI course" of the listings: a course is left out only
 * when it is reserved to LTI sessions (`lti_send_back_grade`); other LTI
 * courses (`is_lti`) are listed, with an "LTI course" badge.
 */
export async function userCourses(username: string, lang: string): Promise<Course[]> {
	const docs = await services()
		.db.c.courses.find({ students: username }, { projection: { _id: 1 } })
		.toArray();
	const registered = new Set(docs.map((d) => d._id));
	const mine = (c: Course) =>
		isCourseStaff(c, username) || (registered.has(c.id) && isOpen(c.accessible) && !c.ltiSendBackGrade);
	return byName([...listCourses().values()].filter(mine), lang);
}

/** Tasks of a course visible to a user (started, per-user draw for combinatory tests) and the accessibilities. */
function visibleTasks(c: Course, username: string | null) {
	const taskids = courseTaskIds(c);
	const acc = accessibilities(c.dispenser, taskids, username);
	return { taskids, acc, visible: taskids.filter((id) => afterStart(acc[id])) };
}

/** Grading state of a task for a user (`user_tasks` fields used by the progress). */
type UserTask = Pick<UserTaskDoc, 'courseid' | 'taskid' | 'grade' | 'succeeded'>;

/**
 * `user_tasks` of a user in several courses, in one query (scale: the
 * dashboards compute the progress of many courses at once), by course id.
 */
export async function userTasksByCourse(username: string, courseids: string[]): Promise<Map<string, UserTask[]>> {
	const out = new Map<string, UserTask[]>(courseids.map((id) => [id, []]));
	const docs = await services()
		.db.c.userTasks.find(
			{ username, courseid: { $in: courseids } },
			{ projection: { _id: 0, courseid: 1, taskid: 1, grade: 1, succeeded: 1 } }
		)
		.toArray();
	for (const d of docs) out.get(d.courseid)!.push(d);
	return out;
}

/** Role of a user in a course. */
type Role = 'admin' | 'tutor' | 'student';

/** ISO string of an instant, null for the "no deadline" sentinel. */
const iso = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/**
 * Progress of a user in a course (NAV-11/13): accessibility of every task
 * folder for him, visible (started) tasks, his `user_tasks` of the visible
 * tasks (by task id), course grade, succeeded/visible counts and the next soft
 * deadline of an unfinished open task.
 * @param all his `user_tasks` of the course when already fetched (`userTasksByCourse`).
 */
export async function progress(c: Course, username: string | null, all?: UserTask[]) {
	const { taskids, acc, visible } = visibleTasks(c, username);
	const shown = new Set(visible);
	all ??= username ? (await userTasksByCourse(username, [c.id])).get(c.id)! : [];
	const docs = new Map(all.filter((d) => shown.has(d.taskid)).map((d) => [d.taskid, d]));
	const done = (id: string) => !!docs.get(id)?.succeeded;
	const next = Math.min(...visible.filter((id) => isOpen(acc[id]) && !done(id)).map((id) => acc[id].softEnd));
	const grade = courseGrade(c.dispenser, visible, [...docs.values()]);
	const succeeded = visible.filter(done).length;
	return { taskids, acc, visible, docs, grade, succeeded, total: visible.length, deadline: iso(next) };
}

/** Course filters of "My courses" (NAV-02), besides "All". */
export const MY_FILTERS = ['pinned', 'archived', 'lti', 'hidden'] as const;
/** A course filter of "My courses" ('' = all). */
export type MyFilter = (typeof MY_FILTERS)[number] | '';

/**
 * One page of the course cards of "My courses" (NAV-02): the user's courses
 * matching the search `q` and the `filter` chip, pinned ones first in pin order
 * (NAV-03), each with the user's role and progress (grade, succeeded/visible
 * tasks, next soft `deadline`; computed for the page only, with one query) and
 * `hidden` = not open to students (closed, future or archived).
 * @param courses the user's courses (`userCourses`).
 * @returns the cards of the page, the number of matching courses and the page slice.
 */
export async function myCourses(
	username: string,
	courses: Course[],
	lang: string,
	{ q, filter, page }: { q: string; filter: MyFilter; page: unknown }
) {
	const pins = (await pinnedCourses(username)).filter((id) => courses.some((c) => c.id === id));
	const rank = (c: Course) => (pins.includes(c.id) ? pins.indexOf(c.id) : pins.length);
	const flags = (c: Course) => ({
		pinned: pins.includes(c.id),
		archived: c.archived,
		lti: c.isLti,
		hidden: !isOpen(c.accessible)
	});
	const list = searchCourses(courses, q, lang)
		.filter((c) => !filter || flags(c)[filter])
		.sort((a, b) => rank(a) - rank(b));
	const slice = pageSlice(list.length, page, COURSES_PER_PAGE);
	const shown = list.slice(slice.skip, slice.skip + slice.limit);
	const docs = await userTasksByCourse(
		username,
		shown.map((c) => c.id)
	);
	const items = await Promise.all(
		shown.map(async (c) => {
			const { grade, succeeded, total, deadline } = await progress(c, username, docs.get(c.id));
			return {
				id: c.id,
				name: courseName(c, lang),
				...flags(c),
				archiveDate: c.archiveDate?.toISOString() ?? null,
				role: (isCourseAdmin(c, username) ? 'admin' : isCourseStaff(c, username) ? 'tutor' : 'student') as Role,
				grade,
				succeeded,
				total,
				deadline
			};
		})
	);
	return { courses: items, count: list.length, ...slice };
}

/**
 * "Last tried exercises" (NAV-21): the most recent submission of each of the
 * 5 most recently attempted tasks among the tasks of `courses` visible to the
 * user (same scope on the course, group, dashboard and upcoming tasks pages).
 * The latest submission of every task tried in these courses comes from one
 * aggregation; the visibility is then checked task by task, in recency order,
 * until 5 are kept. Entries whose task cannot be loaded are dropped.
 */
export async function lastTried(username: string, courses: Course[], lang: string): Promise<LastTriedItem[]> {
	if (!courses.length) return [];
	const byId = new Map(courses.map((c) => [c.id, c]));
	const first = (field: string) => ({ $first: `$${field}` });
	const rows = services().db.c.submissions.aggregate<{
		_id: { c: string; t: string };
		status: string;
		result?: string | null;
	}>([
		{ $match: { username, courseid: { $in: [...byId.keys()] } } },
		// Sorting the needed fields only (not whole submissions with their feedback) is several times faster.
		{ $project: { courseid: 1, taskid: 1, submitted_on: 1, status: 1, result: 1 } },
		{ $sort: { submitted_on: -1 } },
		{
			$group: {
				_id: { c: '$courseid', t: '$taskid' },
				on: first('submitted_on'),
				status: first('status'),
				result: first('result')
			}
		},
		{ $sort: { on: -1 } }
	]);
	const items: LastTriedItem[] = [];
	for await (const { _id, status, result } of rows) {
		const course = byId.get(_id.c)!;
		const name = afterStart(accessibility(course.dispenser, _id.t, username)) ? taskName(course, _id.t, lang) : null;
		if (name !== null)
			items.push({
				courseid: _id.c,
				taskid: _id.t,
				courseName: courseName(course, lang),
				taskName: name,
				status,
				result: result ?? ''
			});
		if (items.length === 5) break;
	}
	return items;
}

/** Visible tasks of a course rendered with the course page (NAV-10); the other sections load on demand. */
export const EAGER_TASKS = 150;

/**
 * Task row of the course page (NAV-10/11/13) for the user's progress `p`.
 */
function taskItem(c: Course, p: Awaited<ReturnType<typeof progress>>, id: string, lang: string): TaskItem {
	const doc = p.docs.get(id);
	const { weight, categories } = taskConfig(c.dispenser, id);
	return {
		id,
		name: taskName(c, id, lang) ?? id,
		succeeded: !!doc?.succeeded,
		grade: doc?.grade ?? 0,
		weight,
		open: isOpen(p.acc[id]),
		categories,
		deadline: iso(p.acc[id].softEnd)
	};
}

/**
 * Task tree and grade of the course page (NAV-10/11/13): visible tasks are the
 * started ones (per-user draw for combinatory tests); sections configured
 * `hidden_if_empty` without any open task are skipped. Section titles go
 * through the global catalog, like legacy.
 *
 * Scale: every terminal section carries the counts of its tasks per category
 * (`stats`), but only the first `EAGER_TASKS` tasks of open sections are sent
 * with the page; the other sections are sent closed with `tasks: null` and
 * loaded when opened (`sectionItems`, by their `path` of toc indices). Courses
 * with at most `EAGER_TASKS` visible tasks are sent whole.
 * @param eagerTasks the `EAGER_TASKS` budget (tests).
 */
export async function courseTasks(c: Course, username: string | null, lang: string, eagerTasks = EAGER_TASKS) {
	const p = await progress(c, username);
	const visible = new Set(p.visible);
	const known = new Set(p.taskids);
	let budget = p.total <= eagerTasks ? Infinity : eagerTasks;
	const shown = (s: TocSection) =>
		!s.config.hidden_if_empty || sectionTasks([s]).some((id) => known.has(id) && isOpen(p.acc[id]));
	const build = (sections: TocSection[], prefix: string): SectionView[] =>
		sections.flatMap((s, i): SectionView[] => {
			if (!shown(s)) return [];
			const path = `${prefix}${i}`;
			const closed = Boolean(s.config.closed);
			if (s.sections) {
				const sub = build(s.sections, `${path}.`);
				const stats: Stats = {};
				for (const child of sub) for (const [k, [d, n]] of Object.entries(child.stats)) count(stats, k, d, n);
				return [{ title: t(s.title), path, closed, sections: sub, tasks: [], stats }];
			}
			const ids = s.tasks.filter((id) => visible.has(id));
			const stats: Stats = { '': [0, 0] };
			for (const id of ids) {
				const done = +!!p.docs.get(id)?.succeeded;
				for (const k of ['', ...taskConfig(c.dispenser, id).categories]) count(stats, k, done, 1);
			}
			const eager = (budget === Infinity || !closed) && ids.length <= budget;
			if (eager) budget -= ids.length;
			const tasks = eager ? ids.map((id) => taskItem(c, p, id, lang)) : null;
			return [{ title: t(s.title), path, closed: closed || !eager, sections: null, tasks, stats }];
		});
	return { sections: build(c.dispenser.toc, ''), grade: p.grade, succeeded: p.succeeded, total: p.total };
}

/** Task counts of a section per category ('' = all): [succeeded, total]. */
type Stats = SectionView['stats'];
/** Adds `done` succeeded tasks out of `n` to the counts of `key`. */
function count(stats: Stats, key: string, done: number, n: number) {
	const [d, total] = stats[key] ?? [0, 0];
	stats[key] = [d + done, total + n];
}

/**
 * Task rows of the terminal section at `path` (toc indices, e.g. "0.2") of
 * the course page, loaded when the section is opened (NAV-10); null for
 * unknown paths or non-terminal sections.
 */
export async function sectionItems(c: Course, username: string | null, lang: string, path: string) {
	let section: TocSection | undefined;
	let list: TocSection[] | null = c.dispenser.toc;
	for (const i of path.split('.')) {
		section = /^\d+$/.test(i) ? list?.[Number(i)] : undefined;
		list = section?.sections ?? null;
	}
	if (!section || section.sections) return null;
	const p = await progress(c, username);
	const visible = new Set(p.visible);
	return section.tasks.filter((id) => visible.has(id)).map((id) => taskItem(c, p, id, lang));
}

/**
 * Plugin menu entries (`main_menu`, `course_menu`, `task_menu`) with an http(s) or
 * relative link; entries with another scheme (`javascript:`, `data:`...) are dropped.
 */
export function safeLinks<T extends { href: string }>(items: T[]): T[] {
	return items.filter(({ href }) => {
		try {
			return ['http:', 'https:'].includes(new URL(String(href), 'http://relative.invalid').protocol);
		} catch {
			return false;
		}
	});
}

/** Sidebar section holding the `main_menu` plugin entries (NAV-01/02/20); none without entries. */
export async function mainMenu(): Promise<NavSection[]> {
	const items = safeLinks(await plugins().callHook<object, NavItem>('main_menu', {}));
	return items.length ? [{ items }] : [];
}

/**
 * Sidebar section of a course (course layout and group page): course link,
 * `course_menu` plugin entries, then the administration link for staff or
 * the group link (labelled with the user's group) for registered students.
 */
export async function courseNav(c: Course, username: string | null, lang: string): Promise<NavSection[]> {
	const items: NavItem[] = [
		{ label: t('Tasks'), href: `/course/${c.id}` },
		...safeLinks((await plugins().callHook<object, NavItem | NavItem[]>('course_menu', { course: c, username })).flat())
	];
	if (isCourseStaff(c, username)) items.push({ label: t('Course administration'), href: `/admin/${c.id}` });
	else if (await isRegistered(c, username)) {
		const group = await userGroup(c.id, username!);
		items.push({ label: group ? t('Group : {}', group.description) : t('Group management'), href: `/group/${c.id}` });
	}
	return [{ title: courseName(c, lang), items }];
}
