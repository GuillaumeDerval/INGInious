/**
 * Audiences of a course (CSTU-04/05/06): paginated list with statistics, creation,
 * edition/deletion and the CSV structure download/upload.
 *
 * Rules: every query is scoped by `courseid` with the URL id (CSTU-05), tutors must be course staff, deleted audiences are pulled
 * from the group restrictions, and the CSV upload keeps the ids of audiences
 * whose description is unchanged (no dangling group restrictions, CSTU-06).
 */
import { ObjectId } from 'mongodb';
import { t } from '#lib/i18n/index.js';
import { services } from '../app.js';
import { courseTaskIds, type Course } from '../courses/course.js';
import { courseAudiences, isCourseStaff, registeredUsers } from '../courses/members.js';
import type { AudienceDoc } from '../db/types.js';
import { parseId } from '../db/index.js';
import { pageSlice } from '../pagination.js';
import { dictCsv, parseCsv, toCsv } from './csv.js';
import { matches } from './people.js';

const db = () => services().db.c;

/** Audiences per page of the audience list. */
export const AUDIENCE_PAGE_SIZE = 20;

/**
 * CSTU-04: audiences with their students and the number of tasks tried / succeeded
 * by their students (submissions, legacy). One aggregation for all the audiences:
 * the tasks of each student (and whether one submission succeeded), then the union per audience.
 */
async function withStats(course: Course, audiences: AudienceDoc[], username: string) {
	const students = [...new Set(audiences.flatMap((a) => a.students))];
	const tasks = new Map<string, Map<string, boolean>>();
	for (const { _id, ok } of await db()
		.submissions.aggregate<{ _id: { taskid: string; username: string }; ok: boolean }>([
			{ $match: { courseid: course.id, taskid: { $in: courseTaskIds(course) }, username: { $in: students } } },
			// Group submissions count for each listed member.
			{ $unwind: '$username' },
			{ $group: { _id: { taskid: '$taskid', username: '$username' }, ok: { $max: { $eq: ['$result', 'success'] } } } }
		])
		.toArray())
		(tasks.get(_id.username) ?? tasks.set(_id.username, new Map()).get(_id.username)!).set(_id.taskid, ok);
	return audiences.map((a) => {
		const per = new Map<string, boolean>();
		for (const s of a.students) for (const [task, ok] of tasks.get(s) ?? []) per.set(task, per.get(task) || ok);
		return {
			id: String(a._id),
			description: a.description,
			students: a.students,
			tutors: a.tutors,
			tried: per.size,
			done: [...per.values()].filter(Boolean).length,
			mine: a.tutors.includes(username)
		};
	});
}

/** One audience row with its statistics. */
export type AudienceRow = Awaited<ReturnType<typeof withStats>>[number];

/**
 * CSTU-04: one page of the audiences (natural order) whose description contains `q`,
 * with their statistics, and the ids of all the audiences (link to their submissions).
 */
export async function audiencePage(course: Course, username: string, q: string, page: unknown) {
	const all = await courseAudiences(course.id);
	const shown = all.filter((a) => matches(q, a.description));
	const slice = pageSlice(shown.length, page, AUDIENCE_PAGE_SIZE);
	return {
		rows: await withStats(course, shown.slice(slice.skip, slice.skip + slice.limit), username),
		ids: all.map((a) => String(a._id)),
		matching: shown.length,
		page: slice.page,
		pages: slice.pages
	};
}

/** CSTU-04 CSV of every audience (legacy columns). */
export async function audiencesCsv(course: Course, username: string): Promise<string> {
	const rows = await withStats(course, await courseAudiences(course.id), username);
	return dictCsv(
		Object.fromEntries(
			rows.map(({ id, description, students, tutors, tried, done }) => [
				id,
				{ _id: id, courseid: course.id, description, students, tutors, tried, done }
			])
		)
	);
}

/** CSTU-04: creates an empty audience. */
export const createAudience = (courseid: string, description: string) =>
	db().audiences.insertOne({ description, courseid, students: [], tutors: [] });

/** CSTU-05: an audience of THIS course, null for malformed/unknown/foreign ids. */
export const findAudience = async (courseid: string, id: string) =>
	parseId(id)
		? ((await db().audiences.findOne({ _id: parseId(id)!, courseid })) as (AudienceDoc & { _id: ObjectId }) | null)
		: null;

/**
 * CSTU-05: updates an audience of the course. Unknown students abort with
 * "User not found : x"; unregistered ones are enrolled when `admin` is true,
 * refused otherwise (tutors cannot register users, permission matrix);
 * tutors must be staff.
 * @returns an error message or null.
 */
export async function updateAudience(
	course: Course,
	id: ObjectId,
	a: { description: string; students: string[]; tutors: string[] },
	admin: boolean
): Promise<string | null> {
	const known = new Set(
		(
			await db()
				.users.find({ username: { $in: a.students } })
				.toArray()
		).map((u) => u.username)
	);
	const unknown = a.students.find((s) => !known.has(s));
	if (unknown !== undefined) return t('User not found : {}', unknown);
	const registered = new Set(await registeredUsers(course));
	const outsider = admin ? undefined : a.students.find((s) => !registered.has(s));
	if (outsider !== undefined) return t('{} is not registered to this course.', outsider);
	await enrol(course, a.students);
	const tutors = a.tutors.filter((u) => isCourseStaff(course, u));
	await db().audiences.updateOne(
		{ _id: id, courseid: course.id },
		{ $set: { description: a.description, students: [...new Set(a.students)], tutors } }
	);
	return null;
}

/** Registers the given users that are not registered yet (implicit enrolment of CSTU-05/06). */
async function enrol(course: Course, usernames: string[]): Promise<void> {
	const registered = new Set(await registeredUsers(course));
	const missing = [...new Set(usernames)].filter((u) => !registered.has(u));
	if (missing.length)
		await db().courses.updateOne({ _id: course.id }, { $push: { students: { $each: missing } } }, { upsert: true });
}

/** CSTU-05: deletes audiences of the course and removes them from the group restrictions. */
export async function deleteAudiences(courseid: string, ids: ObjectId[]): Promise<void> {
	await db().audiences.deleteMany({ _id: { $in: ids }, courseid });
	await db().groups.updateMany({ courseid }, { $pull: { audiences: { $in: ids } } } as never);
}

/** CSTU-06: structure CSV `value,field,role,description` (students then tutors, no header); vanished users are skipped. */
export async function structureCsv(courseid: string, field: 'username' | 'email'): Promise<string> {
	const audiences = await courseAudiences(courseid);
	const users = new Map(
		(
			await db()
				.users.find(
					{ username: { $in: audiences.flatMap((a) => [...a.students, ...a.tutors]) } },
					{ projection: { username: 1, [field]: 1 } }
				)
				.toArray()
		).map((u) => [u.username, u[field]])
	);
	const value = (u: string) => users.get(u);
	return toCsv(
		audiences.flatMap((a) =>
			(['student', 'tutor'] as const).flatMap((role) =>
				a[`${role}s`].filter(value).map((u) => [value(u), field, role, a.description])
			)
		)
	);
}

/**
 * CSTU-06 upload (replaces the repartition): lines `user,field,role,description`.
 * Any line without 4 columns aborts. Invalid lines are skipped (the last error
 * is returned). Audiences without students are dropped when others have
 * students; audiences keep their id when the description is unchanged.
 * @returns an error message or null.
 */
export async function importStructure(course: Course, text: string): Promise<string | null> {
	const rows = parseCsv(text);
	if (rows.some((r) => r.length !== 4)) return t('File wrongly formatted.');
	const lines = rows.map((r) => r.map((s) => s.trim()));
	// Users of the file looked up at once (the first user with that username or email, like `findOne`).
	const found = new Map<string, string>();
	for (const u of await db()
		.users.find(
			{ $or: ['username', 'email'].map((f) => ({ [f]: { $in: lines.filter((l) => l[1] === f).map((l) => l[0]) } })) },
			{ projection: { username: 1, email: 1 } }
		)
		.toArray())
		for (const f of ['username', 'email'] as const)
			if (!found.has(`${f}:${u[f]}`)) found.set(`${f}:${u[f]}`, u.username);
	const wanted = new Map<string, { students: string[]; tutors: string[] }>();
	let error: string | null = null;
	for (const [id, field, role, desc] of lines) {
		const user = found.get(`${field}:${id}`);
		if (field !== 'username' && field !== 'email') error = t('Field was not recognized: {}', field);
		else if (role !== 'student' && role !== 'tutor') error = t('Unknown role: {}', role);
		else if (!user) error = t('User was not found: {}', id);
		else (wanted.get(desc) ?? wanted.set(desc, { students: [], tutors: [] }).get(desc)!)[`${role}s`].push(user);
	}
	let entries = [...wanted];
	if (entries.some(([, e]) => e.students.length)) entries = entries.filter(([, e]) => e.students.length);
	const existing = await courseAudiences(course.id);
	await deleteAudiences(
		course.id,
		existing.filter((a) => !entries.some(([d]) => d === a.description)).map((a) => a._id!)
	);
	for (const [description, e] of entries) {
		const old = existing.find((a) => a.description === description);
		if (old) await db().audiences.updateOne({ _id: old._id }, { $set: e });
		else await db().audiences.insertOne({ description, courseid: course.id, ...e });
	}
	await enrol(
		course,
		entries.flatMap(([, e]) => e.students)
	);
	return error;
}
