/**
 * Submission queries of the course administration (CSTU-11/12, shared by the
 * archive download, the bulk replay and the statistics CSTU-13/14/17).
 *
 * Every parameter is validated with zod with the legacy sanitisation rules
 * (`get_input_params`); repeated keys and comma-separated values are both
 * accepted. Differences: invalid dates give the "Invalid dates" message
 * instead of a 500, and a user filter containing only unknown users falls
 * back to the default (registered users) instead of selecting everything.
 * Bounds: a page of the submissions table has at most MAX_LIMIT rows, the statistics count at
 * most `exportCap(CSV_FACTOR)` submissions, and the exports and the bulk replay refuse
 * selections larger than the export limit (`exportLimitError`).
 */
import { ObjectId, type Filter, type FindCursor } from 'mongodb';
import { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import { services } from '../app.js';
import { courseTaskIds, type Course } from '../courses/course.js';
import { allCategories, orderedTasks, taskConfig } from '../courses/dispenser.js';
import { courseAudiences, registeredUsers } from '../courses/members.js';
import type { SubmissionDoc } from '../db/types.js';
import { displayResult } from '../submissions/feedback.js';
import { findSubmission, type Submission } from '../submissions/manager.js';
import { parseDate } from '../text/dates.js';
import { dictCsvStream } from './csv.js';
import { pageSlice } from '../pagination.js';
import { loadTasks } from '../courses/task.js';
import { taskName, userInfos, userOptions } from './people.js';

const db = () => services().db.c;
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const list = z.preprocess(
	(v) =>
		[v ?? []]
			.flat()
			.flatMap((s) => String(s).split(','))
			.map((s) => s.trim())
			.filter(Boolean),
	z.array(z.string())
);
const int = (fallback: number | null) =>
	z.preprocess(
		(v) => (/^[+-]?\d+$/.test(String(one(v) ?? '').trim()) ? Number(one(v)) : fallback),
		z.number().nullable()
	);
const flag = z.preprocess((v) => v !== undefined, z.boolean());

/** Largest page of the submissions table, and number of submissions counted by default by the statistics. */
export const MAX_LIMIT = 500;
const str = z.preprocess((v) => String(one(v) ?? ''), z.string());

/** Query parameters of the submissions and statistics pages (CSTU-11/17). */
const querySchema = z.object({
	users: list,
	audiences: list,
	tasks: list,
	org_categories: list,
	grade_min: int(null),
	grade_max: int(null),
	date_after: str,
	date_before: str,
	order: int(0),
	limit: int(null),
	page: int(1),
	eval: flag,
	crashes_only: flag,
	show_tags: flag,
	show_id: flag,
	show_task_name: flag,
	show_stud_name: flag,
	sort_by: z.preprocess(one, z.enum(['submitted_on', 'username', 'grade', 'taskid']).catch('submitted_on')),
	stat: z.preprocess(one, z.enum(['normal', 'pond_stat']).catch('normal'))
});
/** A sanitised query. */
export type Query = z.output<typeof querySchema>;

/** Parses URL parameters (repeated keys become lists). */
export function parseQuery(params: URLSearchParams): Query {
	return querySchema.parse(Object.fromEntries([...new Set(params.keys())].map((k) => [k, params.getAll(k)])));
}

/** A list of choices of the query form. */
export type ListName = 'users' | 'audiences' | 'tasks' | 'org_categories';

/** Longest choice list sent with the page; longer ones become server-searched pickers (`searchOptions`). */
export const OPTIONS_LIMIT = 100;

/**
 * Choices of the query form; `mine` marks the audiences tutored by `username` and their students
 * ("Tutored only"). Lists longer than `OPTIONS_LIMIT` (thousands of students or tasks) are named in
 * `search` and only hold their choices selected by `q` and the tutored ones: the form searches the others.
 * @param limit the `OPTIONS_LIMIT` (tests).
 */
export async function queryOptions(course: Course, username: string, lang: string, q?: Query, limit = OPTIONS_LIMIT) {
	const [registered, auds] = await Promise.all([registeredUsers(course, true), courseAudiences(course.id)]);
	const mine = new Set(auds.filter((a) => a.tutors.includes(username)).map((a) => String(a._id)));
	const tutored = new Set(auds.filter((a) => mine.has(String(a._id))).flatMap((a) => a.students));
	const search: ListName[] = [];
	/** Values of a list sent with the page: all of them, or the selected and tutored ones of a long list. */
	const keep = (name: ListName, all: string[], isMine: (v: string) => boolean = () => false) => {
		if (all.length <= limit) return all;
		search.push(name);
		return all.filter((v) => q?.[name].includes(v) || isMine(v));
	};
	const users = await userOptions(keep('users', registered, (u) => tutored.has(u)));
	const audiences = keep(
		'audiences',
		auds.map((a) => String(a._id)),
		(id) => mine.has(id)
	);
	const tasks = keep('tasks', orderedTasks(course.dispenser, courseTaskIds(course)));
	return {
		users: users.map((u) => ({ ...u, mine: tutored.has(u.value) })),
		audiences: auds
			.filter((a) => audiences.includes(String(a._id)))
			.map((a) => ({ value: String(a._id), label: a.description, mine: mine.has(String(a._id)) })),
		tasks: tasks.map((id) => ({ value: id, label: taskName(course, id, lang) })),
		org_categories: keep('org_categories', allCategories(course.dispenser)).map((c) => ({ value: c, label: c })),
		search
	};
}

/** Suggestions answered by `searchOptions`. */
const SUGGESTIONS = 20;

/**
 * Suggestions of a long choice list of the query form (`GET .../submissions/options/<list>?q=`):
 * the first `SUGGESTIONS` choices whose label or value contains `text` (case-insensitive).
 */
export async function searchOptions(course: Course, list: ListName, text: string, lang: string) {
	const needle = text.trim().toLowerCase().slice(0, 100);
	const match = (o: { value: string; label: string }) => `${o.label}\n${o.value}`.toLowerCase().includes(needle);
	if (list === 'users') {
		const re = { $regex: needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
		const found = await db()
			.users.find(
				{ username: { $in: await registeredUsers(course, true) }, $or: [{ username: re }, { realname: re }] },
				{ projection: { username: 1 }, limit: SUGGESTIONS }
			)
			.toArray();
		return userOptions(found.map((u) => u.username));
	}
	const all =
		list === 'audiences'
			? (await courseAudiences(course.id)).map((a) => ({ value: String(a._id), label: a.description }))
			: list === 'tasks'
				? [...loadTasks(course)].map(([id, x]) => ({ value: id, label: x instanceof Error ? id : x.tr(lang, x.name) }))
				: allCategories(course.dispenser).map((c) => ({ value: c, label: c }));
	return all.filter(match).slice(0, SUGGESTIONS);
}

/**
 * Parses a date filter with the legacy date parser (ISO 8601 or `dd/mm/YYYY[ HH[:MM[:SS]]]`,
 * naive = server local time); false when invalid, null when empty.
 */
export function parseIso(s: string): Date | null | false {
	return s.trim() ? (parseDate(s) ?? false) : null;
}

/**
 * Mongo filter of a query (always scoped to the course), the evaluation submission ids and the date error.
 * @param evals true to read the evaluation ids of the whole selection (always done for the
 *        "evaluation submissions only" filter): that reads every `user_tasks` document of the
 *        selection, so pages of submissions use `evaluationIds` on their rows instead.
 */
export async function selection(course: Course, q: Query, evals = false) {
	const registered = await registeredUsers(course, true);
	const auds = (await courseAudiences(course.id)).filter((a) => q.audiences.includes(String(a._id)));
	let users = q.users.filter((u) => registered.includes(u));
	if (!users.length && !auds.length) users = registered;
	const all = courseTaskIds(course);
	let tasks = q.tasks.length ? q.tasks.filter((id) => all.includes(id)) : all;
	if (q.org_categories.length)
		tasks = tasks.filter((id) => taskConfig(course.dispenser, id).categories.some((c) => q.org_categories.includes(c)));
	const names = auds.length ? auds.flatMap((a) => a.students).filter((u) => !users.length || users.includes(u)) : users;
	const filter: Filter<SubmissionDoc> = { courseid: course.id, taskid: { $in: tasks }, username: { $in: names } };
	const grade = {
		...(q.grade_min !== null && { $gte: q.grade_min }),
		...(q.grade_max !== null && { $lte: q.grade_max })
	};
	if (Object.keys(grade).length) filter.grade = grade;
	const [after, before] = [parseIso(q.date_after), parseIso(q.date_before)];
	if (after || before) filter.submitted_on = { ...(after && { $gte: after }), ...(before && { $lte: before }) };
	if (q.crashes_only) filter.result = { $in: ['crash', 'timeout'] };
	const states =
		evals || q.eval
			? await db()
					.userTasks.find(
						{ courseid: course.id, taskid: { $in: tasks }, username: { $in: names }, submissionid: { $ne: null } },
						{ projection: { submissionid: 1 } }
					)
					.toArray()
			: [];
	const evalIds = new Set(states.map((u) => String(u.submissionid)));
	if (q.eval) filter._id = { $in: [...evalIds].map((id) => new ObjectId(id)) };
	return { filter, evalIds, error: after === false || before === false ? t('Invalid dates') : null };
}

/** Fields read (1) or skipped (0) in submission documents. */
type Projection = Record<string, 0 | 1>;

/** Submissions of a filter in the order chosen by the query. */
const sorted = (filter: Filter<SubmissionDoc>, q: Query, projection?: Projection) =>
	db()
		.submissions.find(filter, { projection })
		.sort({ [q.sort_by]: q.order === 1 ? 1 : -1 });

/** Default maximum number of submissions of one archive download or bulk replay (CSTU-13/14). */
export const EXPORT_LIMIT = 10_000;

/** The CSV export (CSTU-12) reads a few small fields and is streamed: it allows this many times more. */
export const CSV_FACTOR = 20;

/** Largest number of submissions read at once: `factor` times the export limit (config or EXPORT_LIMIT). */
export function exportCap(factor = 1): number {
	return (Number(services().config.raw.submissions_export_limit) || EXPORT_LIMIT) * factor;
}

/**
 * CSTU-12/13/14: the error message when `count` submissions exceed `factor` times the export
 * limit (`submissions_export_limit` in configuration.yaml, else EXPORT_LIMIT), else null.
 * Larger selections are refused rather than truncated, so that an export never silently
 * misses submissions: the staff narrows the selection with the filters.
 */
export function exportLimitError(count: number, factor = 1): string | null {
	const limit = exportCap(factor);
	return count > limit
		? t('The selection contains {} submissions, more than the {} allowed: narrow it with the filters.', count, limit)
		: null;
}

/**
 * Every submission of the selection (no pagination) as a cursor sorted like the listing (read one
 * document at a time), and `tooMany`, the `exportLimitError` of the selection: read the cursor only when null.
 * @param projection fields to read (default: whole documents).
 * @param factor of the export limit (CSV_FACTOR for the CSV export).
 */
export async function selectedSubmissions(course: Course, q: Query, projection?: Projection, factor = 1) {
	const sel = await selection(course, q, true);
	const tooMany = exportLimitError(await db().submissions.countDocuments(sel.filter), factor);
	return { ...sel, tooMany, docs: sorted(sel.filter, q, projection) as unknown as FindCursor<Submission> };
}

/** Statuses of graded submissions (the ones that can be replayed or downloaded). */
export const GRADED: SubmissionDoc['status'][] = ['done', 'error'];

/**
 * CSTU-13/14: the graded submissions of the course among `ids` (unknown, foreign or waiting ones are dropped);
 * callers check the number of ids with `exportLimitError` first.
 */
export async function pickSubmissions(course: Course, ids: unknown[], status = GRADED): Promise<Submission[]> {
	const docs = await Promise.all(
		ids.map((id) => findSubmission(String(id), { courseid: course.id, status: { $in: status } }))
	);
	return docs.filter((s) => s !== null);
}

/** A tag badge (`title`: description or full auto-tag value). */
interface TagBadge {
	label: string;
	tone: 'success' | 'error' | 'warning';
	title: string;
}

/**
 * Badges of the tags of a submission for the course staff: skills (green),
 * misconceptions (red) and auto-tags (truncated values).
 */
export function tagBadges(course: Course, tests: Record<string, unknown> = {}): TagBadge[] {
	return Object.entries(tests).flatMap(([k, v]): TagBadge[] => {
		const tag = course.tags[k];
		if (tag && tag.type < 2 && v)
			return [{ label: tag.name, tone: tag.type ? 'error' : 'success', title: tag.description }];
		const s = String(v);
		return k.startsWith('*auto-tag-') && v
			? [{ label: s.length > 30 ? `${s.slice(0, 30)}…` : s, tone: 'warning', title: s }]
			: [];
	});
}

/**
 * Ids of the evaluation submissions among some submissions of the course (CSTU-11/17), read
 * from the grading states of their authors only (unique index username/courseid/taskid).
 */
export async function evaluationIds(course: Course, docs: Pick<SubmissionDoc, 'taskid' | 'username'>[]) {
	const authors = docs.map((d) => ({ courseid: course.id, taskid: d.taskid, username: { $in: d.username } }));
	const states = docs.length
		? await db()
				.userTasks.find({ $or: authors }, { projection: { submissionid: 1 } })
				.toArray()
		: [];
	return new Set(states.map((u) => String(u.submissionid)));
}

/**
 * CSTU-11: one page of the selection (`limit` rows, 50 by default), formatted for the table
 * (show_* options applied, the ids are kept); the evaluation flags are read for the rows of the page only.
 */
export async function listSubmissions(course: Course, q: Query, lang: string) {
	const sel = await selection(course, q);
	const count = await db().submissions.countDocuments(sel.filter);
	const size = Math.min(q.limit && q.limit > 0 ? q.limit : 50, MAX_LIMIT);
	const { page, pages, skip, limit } = pageSlice(count, q.page, size);
	// Rows only show these fields: the large ones (input, outputs, feedback) are never read.
	const docs = await sorted(sel.filter, q, { input: 0, stdout: 0, stderr: 0, text: 0, problems: 0, custom: 0 })
		.skip(skip)
		.limit(limit)
		.toArray();
	const evalIds = await evaluationIds(course, docs);
	const infos = await userInfos(docs.flatMap((d) => d.username));
	const rows = docs.map((d) => ({
		id: String(d._id),
		users: d.username.map((u) => (q.show_stud_name ? infos[u].realname || '?' : u)),
		task: q.show_task_name ? taskName(course, d.taskid, lang) : d.taskid,
		// Ids, shown under the names when the names are shown.
		userIds: d.username,
		taskid: d.taskid,
		submittedOn: d.submitted_on.toISOString(),
		lastReplay: d.last_replay?.toISOString() ?? null,
		status: d.status,
		result: displayResult(d),
		grade: d.grade ?? 0,
		eval: evalIds.has(String(d._id)),
		tags: q.show_tags ? tagBadges(course, d.tests) : []
	}));
	return { rows, count, page, pages, error: sel.error };
}

/** Fields of the submissions read by the CSV export. */
export const CSV_FIELDS: Projection = Object.fromEntries(
	'taskid status result grade submitted_on last_replay tests username'.split(' ').map((k) => [k, 1])
);

/**
 * CSTU-12: CSV of a selection with an explicit column list (never the input or the archive),
 * streamed: the `tests[<tag>]` columns are first collected by the database.
 * @param selection `selectedSubmissions` read with the CSV_FIELDS projection.
 */
export async function submissionsCsv(
	course: Course,
	{ filter, docs, evalIds }: Pick<Awaited<ReturnType<typeof selectedSubmissions>>, 'filter' | 'docs' | 'evalIds'>
): Promise<ReadableStream> {
	const tags = await db()
		.submissions.aggregate<{ _id: string }>([
			{ $match: filter },
			{ $project: { tests: { $objectToArray: { $ifNull: ['$tests', {}] } } } },
			{ $unwind: '$tests' },
			{ $group: { _id: '$tests.k' } }
		])
		.toArray();
	const keys = 'courseid taskid username submitted_on last_replay status result grade eval'.split(' ');
	const row = ({ taskid, status, result, grade, submitted_on, last_replay, tests, username, _id }: Submission) =>
		[
			String(_id),
			{
				courseid: course.id,
				taskid,
				username: username.join(','),
				submitted_on,
				last_replay,
				status,
				result,
				grade,
				eval: evalIds.has(String(_id)),
				tests: tests ?? {}
			}
		] as [string, Record<string, unknown>];
	return dictCsvStream(
		[...keys, ...tags.map((tag) => `tests[${tag._id}]`)],
		(async function* () {
			for await (const doc of docs) yield row(doc);
		})()
	);
}
