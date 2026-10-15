/**
 * Groups of a course (CSTU-07/08): paginated editor data, member picker, saving
 * of edited groups (editor) or of the whole structure (YAML upload), deletion,
 * cleaning and YAML download.
 *
 * Rules: group ids must belong to the course (CSTU-07/08), audience restrictions are limited to the course audiences, an
 * invalid YAML file leaves the existing groups untouched, oversize groups are
 * reported (their students are listed as rejected) instead of silently emptied.
 */
import { ObjectId } from 'mongodb';
import { stringify } from 'yaml';
import { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import { attempt } from '../attempt.js';
import { services } from '../app.js';
import type { Course } from '../courses/course.js';
import type { GroupDoc } from '../db/types.js';
import { parseYaml } from '../courses/files.js';
import { courseAudiences, courseGroups } from '../courses/members.js';
import { parseId } from '../db/index.js';
import { pageSlice } from '../pagination.js';
import { courseMembers, matches, userOptions } from './people.js';

const db = () => services().db.c;

/** Validated structure of the groups posted by the editor (JSON) or uploaded (YAML). */
const groupsSchema = z.array(
	z.object({
		id: z
			.string()
			.regex(/^[0-9a-f]{24}$/)
			.nullish(),
		description: z.coerce.string(),
		size: z.coerce.number().int().min(0),
		students: z.array(z.string()).default([]),
		audiences: z.array(z.coerce.string()).default([])
	})
);
/** One group of the structure. */
type GroupInput = z.infer<typeof groupsSchema>[number];

/** A group as plain data (keys sorted, audience ids as strings). */
const plain = (g: GroupDoc) => ({
	audiences: (g.audiences ?? []).map(String),
	description: g.description,
	size: g.size,
	students: g.students
});

/** Groups per page of the group list. */
export const GROUP_PAGE_SIZE = 24;

/**
 * CSTU-07: one page of the groups (natural order) whose description or member
 * usernames contain `q`, with the labels of their members, the number of
 * registered students in no group and the audiences of the course (restrictions).
 */
export async function groupPage(course: Course, q: string, page: unknown) {
	const [all, { students }, audiences] = await Promise.all([
		courseGroups(course.id),
		courseMembers(course),
		courseAudiences(course.id)
	]);
	const shown = all.filter((g) => matches(q, g.description, ...g.students));
	const slice = pageSlice(shown.length, page, GROUP_PAGE_SIZE);
	const groups = shown.slice(slice.skip, slice.skip + slice.limit);
	const labels = new Map((await userOptions(groups.flatMap((g) => g.students))).map((o) => [o.value, o]));
	const grouped = new Set(all.flatMap((g) => g.students));
	return {
		groups: groups.map((g) => ({
			id: String(g._id),
			description: g.description,
			size: g.size,
			audiences: (g.audiences ?? []).map(String),
			members: g.students.map((u) => labels.get(u)!)
		})),
		ungrouped: students.filter((u) => !grouped.has(u)).length,
		audiences: audiences.map((a) => ({ id: String(a._id), description: a.description })),
		matching: shown.length,
		page: slice.page,
		pages: slice.pages
	};
}

/** CSTU-07: up to 10 registered students (staff excluded) whose username or real name contains `q` (member picker). */
export async function studentOptions(course: Course, q: string) {
	const re = { $regex: q.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
	const users = await db()
		.users.find(
			{ username: { $in: (await courseMembers(course)).students }, $or: [{ username: re }, { realname: re }] },
			{ projection: { username: 1 }, limit: 10 }
		)
		.toArray();
	return userOptions(users.map((u) => u.username));
}

/**
 * CSTU-07/08: saves groups of the course: existing ones (with an id) are updated,
 * new ones (no id) inserted, and with `replace` the groups of the course missing
 * from `groups` are deleted (whole structure). A student is accepted iff
 * registered, the group is not oversize and he belongs to one of its audiences
 * (if any); he is then removed from the other groups.
 * @returns an error message (unknown group id / rejected students) or null.
 */
export async function saveGroups(course: Course, groups: GroupInput[], replace = true): Promise<string | null> {
	const ids = (await courseGroups(course.id)).map((g) => String(g._id));
	const bad = groups.find((g) => g.id && !ids.includes(g.id));
	if (bad) return t('group with id {} not found.', bad.id);
	const allowed = new Set((await courseMembers(course)).students);
	const audiences = await courseAudiences(course.id);
	const kept = groups.filter((g) => g.id).map((g) => new ObjectId(g.id!));
	if (replace) await db().groups.deleteMany({ courseid: course.id, _id: { $nin: kept } });
	const rejected: string[] = [];
	for (const g of groups) {
		const auds = audiences.filter((a) => g.audiences.includes(String(a._id)));
		const ok =
			g.students.length > g.size
				? []
				: g.students.filter((s) => allowed.has(s) && (!auds.length || auds.some((a) => a.students.includes(s))));
		rejected.push(...g.students.filter((s) => !ok.includes(s)));
		const doc = { description: g.description, size: g.size, students: ok, audiences: auds.map((a) => a._id!) };
		const _id = g.id ? new ObjectId(g.id) : (await db().groups.insertOne({ courseid: course.id, ...doc })).insertedId;
		await db().groups.updateOne({ _id, courseid: course.id }, { $set: doc });
		await db().groups.updateMany({ courseid: course.id, _id: { $ne: _id } }, { $pull: { students: { $in: ok } } });
	}
	return rejected.length ? `${t("Changes couldn't be applied for following students :")} ${rejected.join(', ')}` : null;
}

/** CSTU-07: deletes one group of the course (nothing for malformed ids), or all of them when `id` is null. */
export async function deleteGroups(courseid: string, id: string | null): Promise<void> {
	const _id = id === null ? null : parseId(id);
	if (id === null || _id) await db().groups.deleteMany({ courseid, ...(_id && { _id }) });
}

/** CSTU-07: empties every group of the course ("Clean groups"). */
export async function cleanGroups(courseid: string): Promise<void> {
	await db().groups.updateMany({ courseid }, { $set: { students: [] } });
}

/** CSTU-08: YAML of the groups (PyYAML default style, keys sorted, audience ids as strings). */
export const groupsYaml = async (courseid: string) =>
	stringify((await courseGroups(courseid)).map(plain), { indentSeq: false });

/** CSTU-07/08: parses the editor JSON or an uploaded YAML structure (ids dropped unless `keepIds`: uploaded groups are all new); null when invalid. */
export function parseGroups(text: string, keepIds = false): GroupInput[] | null {
	const parsed = groupsSchema.safeParse(
		attempt(
			() => parseYaml(text),
			() => null
		)
	);
	return parsed.success ? parsed.data.map((g) => ({ ...g, id: keepIds ? g.id : null })) : null;
}
