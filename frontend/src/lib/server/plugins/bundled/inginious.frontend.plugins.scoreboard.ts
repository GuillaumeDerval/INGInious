/**
 * Port of the legacy "scoreboard" plugin (SITE-13): rankings of the custom
 * `score` values set by graders, configured by the `scoreboard` list of
 * course.yaml. Pages: /scoreboard/<courseid>[/<index>] (routes/scoreboard).
 *
 * Differences with legacy: the pages are restricted to registered students
 * and staff of the course, students only see the tasks that started for them
 * (other tasks of a scoreboard are left out, names and scores), unknown
 * courses give 404 (legacy 500), `task_menu` matches whole task ids (legacy
 * did a substring test for string contents) and, since a `task_menu` entry is
 * a single link, a task used by several scoreboards links to the list.
 */
import { error } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import type { NavItem } from '#lib/components/layout/nav.js';
import type { PluginRegistry } from '../index.js';
import { requirePlugin } from '../index.js';
import { services } from '../../app.js';
import { courseIsOpenToUser, requireCourse } from '../../courses/access.js';
import type { Course } from '../../courses/course.js';
import { userTaskList } from '../../courses/dispenser.js';
import { isCourseStaff, isRegistered } from '../../courses/members.js';
import { getTask, type Task } from '../../courses/task.js';
import { attempt } from '../../attempt.js';
import { forbidLti, requireUser, type GuardEvent } from '../../security/guards.js';

/** Legacy module name of the plugin. */
export const MODULE = 'inginious.frontend.plugins.scoreboard';

/** A table cell: value `v` and optional CSS classes `c`. */
export type Cell = { v: string | number; c?: string };
/** A rendered ranking (header, rows of cells, emphasized column indexes). */
export type Ranking = { header: string[]; rows: Cell[][]; emphasis: number[] };

/** Raw `scoreboard` entries of a course. */
function boards(course: Course): { name?: unknown; content?: unknown; reverse?: unknown }[] {
	return Array.isArray(course.content.scoreboard) ? course.content.scoreboard : [];
}

/** Content of a scoreboard as ordered {taskid: coefficient} (string, list or dict forms). */
function coefficients(content: unknown): Record<string, number> {
	if (typeof content === 'string') return { [content]: 1 };
	if (Array.isArray(content)) return Object.fromEntries(content.map((id) => [String(id), 1]));
	return Object.fromEntries(Object.entries(content as object).map(([id, c]) => [id, Number(c)]));
}

/** Registers the course and task menu links. */
export function init(registry: PluginRegistry): void {
	registry.addHook<{ course: Course }, NavItem>('course_menu', ({ course }) =>
		boards(course).length ? { label: t('Scoreboards'), href: `/scoreboard/${course.id}` } : null
	);
	registry.addHook<{ course: Course; task: Task }, NavItem>('task_menu', ({ course, task }) => {
		const links = boards(course).flatMap((b, i) =>
			b.content !== undefined && task.id in coefficients(b.content)
				? [{ label: t('Scoreboard: {}', String(b.name)), href: `/scoreboard/${course.id}/${i}` }]
				: []
		);
		return links.length > 1 ? { label: t('Scoreboards'), href: `/scoreboard/${course.id}` } : (links[0] ?? null);
	});
}

/**
 * Guard of the plugin pages (also used by contests): the plugin is enabled,
 * the course exists and the user is a registered student or staff member to
 * whom the course is open, with the access rule of the course page
 * (`courseIsOpenToUser` outside LTI, LTI sessions refused).
 * @returns the course, the username and the page header data (`id`, translated `course` name).
 */
export async function requireCourseMember(event: GuardEvent & { params: { courseid: string } }, module = MODULE) {
	requirePlugin(module);
	forbidLti(event);
	const course = requireCourse(event.params.courseid);
	const { username } = requireUser(event);
	if (!(await isRegistered(course, username)) || (await courseIsOpenToUser(course, username, false)) !== true)
		error(403, t('You are not registered to this course.'));
	return { course, username, page: { id: course.id, course: course.tr(event.locals.lang, course.name) } };
}

/**
 * Tasks (among `ids`) whose id and name may be listed to a user: every task for the
 * staff, the tasks that started for him otherwise (a contest lists none before its start).
 */
export function listedTasks(course: Course, ids: string[], username: string): string[] {
	return isCourseStaff(course, username) ? ids : userTaskList(course.dispenser, ids, username);
}

/** Names of the scoreboards of a course (404 when there is none). */
export function scoreboardNames(course: Course): string[] {
	if (!boards(course).length) error(404, t('Not found'));
	return boards(course).map((b) => String(b.name ?? ''));
}

/** Display names of users (real name, else username), sorted and comma-joined per competitor. */
export async function realnames(usernames: string[]): Promise<Map<string, string>> {
	const docs = await services()
		.db.c.users.find({ username: { $in: usernames } })
		.toArray();
	return new Map(usernames.map((u) => [u, docs.find((d) => d.username === u)?.realname || u]));
}

/**
 * SITE-13: ranking of scoreboard `index` (legacy algorithm, see the spec), restricted to
 * the tasks listed to the viewer (`listedTasks`).
 */
export async function scoreboard(
	course: Course,
	index: string,
	lang: string,
	username: string
): Promise<Ranking & { name: string }> {
	const board = boards(course)[Number(index)];
	if (!/^\d+$/.test(index) || !board || board.content === undefined || !board.name)
		error(404, t('Invalid configuration'));
	const coefs = coefficients(board.content);
	// Every configured task must exist; the layout follows the configured board, whatever
	// the number of tasks listed to the viewer.
	const tasks = new Map(
		Object.keys(coefs).map((id) => [
			id,
			attempt(
				() => getTask(course, id),
				() => error(404, t('Unknown task id {}', id))
			)
		])
	);
	const single = tasks.size === 1;
	const ids = listedTasks(course, [...tasks.keys()], username);
	const reverse = Boolean(board.reverse);
	const subs = await services()
		.db.c.submissions.find(
			{ courseid: course.id, taskid: { $in: ids }, 'custom.score': { $exists: true }, result: 'success' },
			{ projection: { taskid: 1, username: 1, 'custom.score': 1 } }
		)
		.toArray();
	// Best score per competitor (tuple of usernames) and task.
	const best = new Map<string, Record<string, number>>();
	for (const sub of subs) {
		const raw = sub.custom?.score;
		const score = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
		if (Number.isNaN(score)) continue;
		const key = JSON.stringify(sub.username);
		const scores = best.get(key) ?? {};
		const lower = reverse !== coefs[sub.taskid] < 0;
		if (!(sub.taskid in scores) || (lower ? score < scores[sub.taskid] : score > scores[sub.taskid]))
			scores[sub.taskid] = score;
		best.set(key, scores);
	}
	const users = await realnames([...best.keys()].flatMap((k) => JSON.parse(k) as string[]));
	const totals = [...best].map(([key, scores]) => {
		const names = (JSON.parse(key) as string[])
			.map((u) => users.get(u)!)
			.sort()
			.join(',');
		return {
			names,
			scores,
			solved: ids.filter((id) => id in scores).length,
			total: ids.reduce((sum, id) => sum + (id in scores ? scores[id] * coefs[id] : 0), 0)
		};
	});
	totals.sort((a, b) => b.solved - a.solved || (reverse ? a.total - b.total : b.total - a.total));
	let [rank, previous] = [0, ''];
	const rows = totals.map((r) => {
		// The rank only increases (and is shown) when (solved, total) changes.
		const changed = previous !== (previous = `${r.solved}/${r.total}`);
		const head = [{ v: changed ? ++rank : '' }, { v: r.names }];
		if (single) return [...head, { v: r.total }];
		return [...head, { v: r.solved }, { v: r.total }, ...ids.map((id) => ({ v: r.scores[id] ?? '' }))];
	});
	const header = single
		? ['', t('Student(s)'), t('Score')]
		: [
				'',
				t('Student(s)'),
				t('Solved'),
				t('Total score'),
				...ids.map((id) => tasks.get(id)!.tr(lang, tasks.get(id)!.name))
			];
	return { name: String(board.name), header, rows, emphasis: single ? [2] : [2, 3] };
}
