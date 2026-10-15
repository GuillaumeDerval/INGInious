/**
 * Course membership and per-user course data in MongoDB (legacy
 * `user_manager.py`): registrations (`courses`), audiences, groups, pinned
 * courses, `user_tasks` caches and submission tokens. The document format is
 * exactly the legacy one (db-schema.md §4-7).
 *
 * Rules: pinning unknown courses is refused (NAV-03); joining
 * a group checks the course, the audiences and the free seats atomically and
 * keeps the current group when the join fails (NAV-16).
 */
import type { ObjectId } from 'mongodb';
import { services } from '../app.js';
import { dbl, parseId } from '../db/index.js';
import type { AudienceDoc, GroupDoc, UserTaskDoc } from '../db/types.js';
import { courseTaskIds, findCourse, type Course } from './course.js';
import { roundHalfEven, taskConfig, userTaskList, type SubmissionLimit } from './dispenser.js';

/** Maximum number of pinned courses (NAV-03). */
export const MAX_PINS = 6;

const db = () => services().db.c;

/** Natural (numeric-aware) string comparison, like legacy `natsorted`. */
export const naturalCompare = new Intl.Collator(undefined, { numeric: true }).compare;

/** Natural sort by description (legacy `natsorted`). */
function natsort<T extends { description: string }>(docs: T[]): T[] {
	return docs.sort((a, b) => naturalCompare(a.description, b.description));
}

/** Ids of the audiences of a course a user belongs to. */
async function myAudiences(courseid: string, username: string): Promise<ObjectId[]> {
	return (await db().audiences.find({ courseid, students: username }).toArray()).map((a) => a._id as ObjectId);
}

/** True when the user is listed in the `superadmins` configuration. */
export function isSuperadmin(username: string | null | undefined): boolean {
	return !!username && services().config.superadmins.includes(username);
}

/** Admins of the course or superadmin. */
export function isCourseAdmin(course: Course, username: string | null | undefined): boolean {
	return !!username && (course.admins.includes(username) || isSuperadmin(username));
}

/** Admins, tutors of the course or superadmin. */
export function isCourseStaff(course: Course, username: string | null | undefined): boolean {
	return !!username && (course.tutors.includes(username) || isCourseAdmin(course, username));
}

/** Staff count as registered; others need a `courses` document listing them. */
export async function isRegistered(course: Course, username: string | null | undefined): Promise<boolean> {
	if (!username) return false;
	return isCourseStaff(course, username) || !!(await db().courses.findOne({ _id: course.id, students: username }));
}

/** Registered students (+ staff when `withStaff`), legacy `get_course_registered_users`. */
export async function registeredUsers(course: Course, withStaff = true): Promise<string[]> {
	const students = (await db().courses.findOne({ _id: course.id }))?.students ?? [];
	return withStaff ? [...new Set([...students, ...course.admins, ...course.tutors])] : students;
}

/** Adds a student to the course (no checks: see `registerUser` in access.ts). */
export async function addStudent(courseid: string, username: string): Promise<void> {
	await db().courses.updateOne({ _id: courseid }, { $push: { students: username } }, { upsert: true });
}

/** Removes a user from the audiences, groups and students of a course (NAV-08). */
export async function unregisterUser(courseid: string, username: string): Promise<void> {
	await db().audiences.updateMany({ courseid, students: username }, { $pull: { students: username } });
	await db().groups.updateMany({ courseid, students: username }, { $pull: { students: username } });
	await db().courses.updateOne({ _id: courseid }, { $pull: { students: username } });
}

/** Audiences of a course, natsorted by description. */
export async function courseAudiences(courseid: string): Promise<AudienceDoc[]> {
	return natsort(await db().audiences.find({ courseid }).toArray());
}

/** Map student -> audiences he belongs to. */
export async function audiencesPerStudent(courseid: string): Promise<Record<string, AudienceDoc[]>> {
	const out: Record<string, AudienceDoc[]> = {};
	for (const a of await courseAudiences(courseid)) for (const s of a.students) (out[s] ??= []).push(a);
	return out;
}

/** Groups of a course, natsorted by description. */
export async function courseGroups(courseid: string): Promise<GroupDoc[]> {
	return natsort(await db().groups.find({ courseid }).toArray());
}

/** The group of a user in a course, or null. */
export async function userGroup(courseid: string, username: string): Promise<GroupDoc | null> {
	return db().groups.findOne({ courseid, students: username });
}

/** Groups a user may join: no audience restriction, or one of his audiences. */
export async function allowedGroups(courseid: string, username: string): Promise<GroupDoc[]> {
	const mine = (await myAudiences(courseid, username)).map(String);
	return (await courseGroups(courseid)).filter(
		(g) => !g.audiences?.length || g.audiences.some((a) => mine.includes(String(a)))
	);
}

/**
 * Moves a student into a group of the same course (NAV-16), atomically
 * checking the free seats and the audience restriction.
 * @returns false when the group is unknown, of another course, full or not allowed.
 */
export async function joinGroup(courseid: string, username: string, groupId: string): Promise<boolean> {
	const _id = parseId(groupId);
	if (!_id) return false;
	const audiences = await myAudiences(courseid, username);
	const joined = await db().groups.findOneAndUpdate(
		{
			_id,
			courseid,
			students: { $ne: username },
			$or: [{ audiences: { $size: 0 } }, { audiences: { $exists: false } }, { audiences: { $in: audiences } }],
			$expr: { $lt: [{ $size: { $ifNull: ['$students', []] } }, '$size'] }
		},
		{ $push: { students: username } }
	);
	if (!joined) return false;
	await db().groups.updateMany(
		{ courseid, students: username, _id: { $ne: joined._id } },
		{ $pull: { students: username } }
	);
	return true;
}

/** Removes a student from his group; false when he had none. */
export async function leaveGroup(courseid: string, username: string): Promise<boolean> {
	return (
		(await db().groups.updateMany({ courseid, students: username }, { $pull: { students: username } })).modifiedCount >
		0
	);
}

/** Pinned course ids of a user that still exist (legacy filtered on loadable courses). */
export async function pinnedCourses(username: string): Promise<string[]> {
	const user = await db().users.findOne({ username }, { projection: { pinned_courses: 1 } });
	return (user?.pinned_courses ?? []).filter((id) => findCourse(id));
}

/**
 * Pins a course on "My courses" (NAV-03); the caller checked that the course is
 * one of the user's (loadable) courses.
 * @returns false (nothing stored) when 6 courses are already pinned.
 */
export async function pinCourse(username: string, courseid: string): Promise<boolean> {
	if ((await pinnedCourses(username)).length >= MAX_PINS) return false;
	await db().users.updateOne({ username }, { $addToSet: { pinned_courses: courseid } });
	return true;
}

/** Unpins a course. */
export async function unpinCourse(username: string, courseid: string): Promise<void> {
	await db().users.updateOne({ username, pinned_courses: courseid }, { $pull: { pinned_courses: courseid } });
}

/** Records that a user opened a task (legacy `user_saw_task` upsert, same inserted fields). */
export async function userSawTask(username: string, courseid: string, taskid: string): Promise<void> {
	await db().userTasks.updateOne(
		{ username, courseid, taskid },
		{
			$setOnInsert: {
				username,
				courseid,
				taskid,
				tried: 0,
				succeeded: false,
				grade: dbl(0),
				submissionid: null,
				state: ''
			}
		},
		{ upsert: true }
	);
}

/** Status of a user on a task from his `user_tasks` document (API and student task list labels). */
export function userTaskStatus(doc: Pick<UserTaskDoc, 'tried' | 'succeeded'> | null | undefined) {
	return !doc ? 'notviewed' : !doc.tried ? 'notattempted' : doc.succeeded ? 'succeeded' : 'failed';
}

/** Progress of a user in a course (legacy `get_course_cache`). */
export interface CourseCache {
	/** Number of tasks with at least one completed submission. */
	taskTried: number;
	/** Total number of completed submissions. */
	totalTries: number;
	/** Number of visible tasks succeeded. */
	taskSucceeded: number;
	/** Grade of every visible task seen at least once. */
	taskGrades: Record<string, number>;
	/** Course grade (NAV-11). */
	grade: number;
}

/**
 * Progress of users in a course over its task folders (legacy `get_course_caches`).
 * Linear in users + `user_tasks` documents: the documents are grouped by user, and the
 * started tasks (with their total weight, the denominator of the course grade, NAV-11)
 * are computed once for all users unless the dispenser draws tasks per user (combinatory test).
 */
export async function courseCaches(course: Course, users: string[]): Promise<Record<string, CourseCache>> {
	const d = course.dispenser;
	const taskids = courseTaskIds(course);
	const byUser = new Map(users.map((u) => [u, [] as UserTaskDoc[]]));
	for (const doc of await db()
		.userTasks.find(
			{ courseid: course.id, username: { $in: users }, taskid: { $in: taskids } },
			{ projection: { username: 1, taskid: 1, grade: 1, tried: 1, succeeded: 1 } }
		)
		.toArray())
		byUser.get(doc.username)!.push(doc);
	const weight = (taskid: string) => taskConfig(d, taskid).weight;
	/** Started tasks of a user and their total weight. */
	const startedOf = (username: string | null) => {
		const started = userTaskList(d, taskids, username);
		return { visible: new Set(started), total: started.reduce((sum, t) => sum + weight(t), 0) };
	};
	const shared = d.kind === 'combinatory_test' ? null : startedOf(null);
	const out: Record<string, CourseCache> = {};
	for (const [username, mine] of byUser) {
		const { visible, total } = shared ?? startedOf(username);
		const seen = mine.filter((doc) => visible.has(doc.taskid));
		const points = seen.reduce((sum, doc) => sum + doc.grade * weight(doc.taskid), 0);
		out[username] = {
			taskTried: mine.filter((doc) => doc.tried !== 0).length,
			totalTries: mine.reduce((sum, doc) => sum + doc.tried, 0),
			taskSucceeded: seen.filter((doc) => doc.succeeded).length,
			taskGrades: Object.fromEntries(seen.map((doc) => [doc.taskid, doc.grade])),
			// Same formula as `courseGrade` (weighted average, Python rounding), without recomputing the total per user.
			grade: total > 0 ? roundHalfEven(points / total) : 0
		};
	}
	return out;
}

/**
 * Checks the submission tokens of users for a task (legacy `check_tokens`):
 * each user needs `tokens.amount < limit.amount`; with a period, tokens older
 * than `period` hours are refilled (`amount: 0, date: now`). Users without
 * `user_tasks` document are ignored.
 */
export async function checkTokens(
	courseid: string,
	taskid: string,
	usernames: string[],
	limit: SubmissionLimit
): Promise<boolean> {
	if (limit.amount === -1 && limit.period === -1) return true;
	let ok = true;
	for (const doc of await db()
		.userTasks.find({ courseid, taskid, username: { $in: usernames } })
		.toArray()) {
		const date = doc.tokens?.date?.getTime() ?? 0;
		if (limit.period > 0 && date < Date.now() - limit.period * 3600_000) {
			await db().userTasks.updateOne({ _id: doc._id }, { $set: { 'tokens.amount': 0, 'tokens.date': new Date() } });
		} else if ((doc.tokens?.amount ?? 0) >= limit.amount) ok = false;
	}
	return ok;
}
