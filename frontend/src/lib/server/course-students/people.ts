/**
 * People of a course (CSTU-01/02/09/10/16): student & staff lists with
 * their progress, manual (un)registration, per-student task
 * status, task state reset and per-task progress statistics.
 * Staff and students are listed explicitly (fixes the legacy slicing bug of CSTU-01).
 *
 * Scale: lists are paginated and searched on the server (20,000 students, 5,000
 * tasks), the progress of a page is only computed for its rows, and the
 * per-task counts are MongoDB aggregations.
 */
import { services } from '../app.js';
import { courseTaskIds, type Course } from '../courses/course.js';
import { orderedTasks, userTaskList } from '../courses/dispenser.js';
import { courseCaches, isCourseStaff, naturalCompare, registeredUsers, userTaskStatus } from '../courses/members.js';
import { findTask } from '../courses/task.js';
import type { UserTaskDoc } from '../db/types.js';
import { pageSlice } from '../pagination.js';
import { dictCsv } from './csv.js';

const db = () => services().db.c;

/** Rows per page of the people and progress tables. */
export const PAGE_SIZE = 50;

/** True when `q` (trimmed, case-insensitive) is empty or contained in one of the texts (missing ones are skipped). */
export function matches(q: string, ...texts: (string | undefined)[]): boolean {
	const needle = q.trim().toLowerCase();
	return !needle || texts.some((s) => s?.toLowerCase().includes(needle));
}

/** Localised name of a task, its id when it cannot be loaded. */
export function taskName(course: Course, taskid: string, lang: string): string {
	const task = findTask(course, taskid);
	return task ? task.tr(lang, task.name) : taskid;
}

/** Task ids of the course in dispenser order with their localised names. */
export function courseTasks(course: Course, lang: string): { id: string; name: string }[] {
	return orderedTasks(course.dispenser, courseTaskIds(course)).map((id) => ({ id, name: taskName(course, id, lang) }));
}

/** Real names and emails of users (unknown users get empty strings). */
export async function userInfos(usernames: string[]): Promise<Record<string, { realname: string; email: string }>> {
	const out = Object.fromEntries(usernames.map((u) => [u, { realname: '', email: '' }]));
	for (const u of await db()
		.users.find({ username: { $in: usernames } }, { projection: { username: 1, realname: 1, email: 1 } })
		.toArray())
		out[u.username] = { realname: u.realname, email: u.email };
	return out;
}

/** Picker choices of users (`realname (username)`, `username (username)` without real name), in natural order. */
export async function userOptions(usernames: string[]): Promise<{ value: string; label: string }[]> {
	const infos = await userInfos(usernames);
	return usernames
		.map((u) => ({ value: u, label: `${infos[u].realname || u} (${u})` }))
		.sort((a, b) => naturalCompare(a.label, b.label));
}

/** Staff (admins + tutors) and registered students (staff excluded) of a course. */
export async function courseMembers(course: Course): Promise<{ staff: string[]; students: string[] }> {
	const staff = [...new Set([...course.admins, ...course.tutors])];
	return { staff, students: (await registeredUsers(course, false)).filter((u) => !isCourseStaff(course, u)) };
}

/** CSTU-01..08: sizes of the tabs of the user management page (groups: null for LTI courses). */
export async function memberCounts(course: Course) {
	const { staff, students } = await courseMembers(course);
	const [audiences, groups] = await Promise.all(
		[db().audiences, db().groups].map((c) => c.countDocuments({ courseid: course.id }))
	);
	return { students: students.length, staff: staff.length, audiences, groups: course.isLti ? null : groups };
}

/**
 * Users sorted by real name (natural order, stable), keeping those whose username,
 * real name or email contains `q`; with their names and emails.
 */
async function sortedUsers(usernames: string[], q = '') {
	const infos = await userInfos(usernames);
	const users = usernames
		.filter((u) => matches(q, u, infos[u].realname, infos[u].email))
		.sort((a, b) => naturalCompare(infos[a].realname, infos[b].realname));
	return { users, infos };
}

/** Rows (legacy field names) of users with their progress. */
async function memberRows(course: Course, users: string[], infos: Awaited<ReturnType<typeof userInfos>>) {
	const caches = await courseCaches(course, users);
	return users.map((u) => ({
		username: u,
		...infos[u],
		task_tried: caches[u].taskTried,
		task_succeeded: caches[u].taskSucceeded,
		total_tries: caches[u].totalTries,
		grade: caches[u].grade,
		task_grades: caches[u].taskGrades
	}));
}

/** One member row. */
export type MemberRow = Awaited<ReturnType<typeof memberRows>>[number];

/** CSTU-01: the staff with their progress, sorted by real name (small list, not paginated). */
export async function staffList(course: Course): Promise<MemberRow[]> {
	const { users, infos } = await sortedUsers((await courseMembers(course)).staff);
	return memberRows(course, users, infos);
}

/**
 * CSTU-01: one page of the registered students matching `q` (username, real name
 * or email), sorted by real name, with their progress.
 * @returns the rows, the number of matching students and the effective page / number of pages.
 */
export async function studentPage(course: Course, q: string, page: unknown) {
	const { users, infos } = await sortedUsers((await courseMembers(course)).students, q);
	const slice = pageSlice(users.length, page, PAGE_SIZE);
	const rows = await memberRows(course, users.slice(slice.skip, slice.skip + slice.limit), infos);
	return { rows, matching: users.length, page: slice.page, pages: slice.pages };
}

/** CSTU-02: the registered students matching `q` (bulk unregistration of a search). */
export const matchingStudents = async (course: Course, q: string) =>
	(await sortedUsers((await courseMembers(course)).students, q)).users;

/** CSTU-01 CSV of the member list (staff first, then the students, each sorted by real name). */
export async function membersCsv(course: Course): Promise<string> {
	const { staff, students } = await courseMembers(course);
	const sorted = [await sortedUsers(staff), await sortedUsers(students)];
	const rows = await memberRows(
		course,
		sorted.flatMap((s) => s.users),
		Object.assign({}, ...sorted.map((s) => s.infos))
	);
	return dictCsv(Object.fromEntries(rows.map((r) => [r.username, r])));
}

/**
 * CSTU-02: unregisters students from the course, its audiences and groups, or
 * every student when `usernames` is null (audience tutors kept).
 */
export async function unregister(course: Course, usernames: string[] | null): Promise<void> {
	const change = usernames ? { $pull: { students: { $in: usernames } } } : { $set: { students: [] } };
	for (const c of [db().audiences, db().groups]) await c.updateMany({ courseid: course.id }, change as never);
	await db().courses.updateOne({ _id: course.id }, change as never);
}

/** Statuses of the student page filter (CSTU-09). */
export const STATUSES = ['notviewed', 'notattempted', 'succeeded', 'failed'] as const;

/** CSTU-09: status of every task (dispenser order) for one user; names are added by `withNames`. */
export async function studentTasks(course: Course, username: string) {
	const docs = new Map<string, UserTaskDoc>();
	for (const d of await db().userTasks.find({ courseid: course.id, username }).toArray()) docs.set(d.taskid, d);
	const all = courseTaskIds(course);
	const visible = new Set(userTaskList(course.dispenser, all, username));
	return orderedTasks(course.dispenser, all).map((id) => {
		const d = docs.get(id);
		return {
			taskid: id,
			status: userTaskStatus(d),
			tried: d?.tried ?? 0,
			grade: d?.grade ?? 0,
			submissionid: d?.submissionid ? String(d.submissionid) : null,
			visible: visible.has(id)
		};
	});
}

/** Adds the localised task names to rows with a `taskid` (only the shown rows: names load the task descriptors). */
export const withNames = <T extends { taskid: string }>(course: Course, rows: T[], lang: string) =>
	rows.map((r) => ({ ...r, name: taskName(course, r.taskid, lang) }));

/**
 * CSTU-09: one page of the tasks of a student, filtered by status and by `q`
 * (task id or name), with the totals of every task (KPIs; succeeded / total among the visible tasks).
 */
export async function studentTaskPage(
	course: Course,
	username: string,
	o: { lang: string; q: string; status: string; page: unknown }
) {
	const all = await studentTasks(course, username);
	const shown = all.filter(
		(r) =>
			(o.status === r.status || !(STATUSES as readonly string[]).includes(o.status)) &&
			matches(o.q, r.taskid, ...(o.q ? [taskName(course, r.taskid, o.lang)] : []))
	);
	const slice = pageSlice(shown.length, o.page, PAGE_SIZE);
	return {
		rows: withNames(course, shown.slice(slice.skip, slice.skip + slice.limit), o.lang),
		matching: shown.length,
		page: slice.page,
		pages: slice.pages,
		// Succeeded / total count the tasks the student sees (served and started), like the
		// "x / y tasks succeeded" of the course page; the table lists every task.
		totals: {
			tasks: all.filter((x) => x.visible).length,
			succeeded: all.filter((x) => x.visible && x.status === 'succeeded').length,
			attempted: all.filter((x) => x.tried > 0).length,
			submissions: all.reduce((a, x) => a + x.tried, 0)
		}
	};
}

/** CSTU-09 CSV (legacy columns, `url` = filter query string). */
export async function studentTasksCsv(course: Course, username: string, lang: string): Promise<string> {
	const rows = withNames(course, await studentTasks(course, username), lang);
	return dictCsv(
		Object.fromEntries(rows.map((r) => [r.taskid, { ...r, url: `?tasks=${r.taskid}&users=${username}` }]))
	);
}

/** CSTU-10: clears the task state of a user (`$set: {state: ""}`); false when the task was never viewed. */
export async function resetState(course: Course, username: string, taskid: string): Promise<boolean> {
	return (
		(await db().userTasks.updateOne({ courseid: course.id, username, taskid }, { $set: { state: '' } })).matchedCount >
		0
	);
}

/**
 * CSTU-16: per task (dispenser order; all of them, or the page `page` when given), number
 * of registered students (staff excluded) who viewed/attempted/succeeded it and total
 * attempts, counted by one aggregation on the `user_tasks` of the listed tasks.
 */
export async function progress(course: Course, lang: string, page?: unknown) {
	const { students } = await courseMembers(course);
	let tasks = orderedTasks(course.dispenser, courseTaskIds(course));
	const slice = pageSlice(tasks.length, page, page === undefined ? Math.max(tasks.length, 1) : PAGE_SIZE);
	tasks = tasks.slice(slice.skip, slice.skip + slice.limit);
	const counts = new Map(
		(
			await db()
				.userTasks.aggregate<{ _id: string; viewed: number; attempted: number; succeeded: number; attempts: number }>([
					{ $match: { courseid: course.id, taskid: { $in: tasks }, username: { $in: students } } },
					{
						$group: {
							_id: '$taskid',
							viewed: { $sum: 1 },
							attempted: { $sum: { $cond: [{ $ne: ['$tried', 0] }, 1, 0] } },
							succeeded: { $sum: { $cond: ['$succeeded', 1, 0] } },
							attempts: { $sum: '$tried' }
						}
					}
				])
				.toArray()
		).map(({ _id, ...c }) => [_id, c])
	);
	const rows = tasks.map((id) => ({
		id,
		name: taskName(course, id, lang),
		...(counts.get(id) ?? { viewed: 0, attempted: 0, succeeded: 0, attempts: 0 })
	}));
	return { rows, page: slice.page, pages: slice.pages };
}
