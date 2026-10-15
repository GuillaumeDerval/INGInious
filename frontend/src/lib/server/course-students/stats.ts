/**
 * "Submissions" statistics of a course (CSTU-17), implementing the intended
 * legacy behaviour (the legacy tasks table, chart, global and tag statistics
 * were always empty): the most recent `limit` (default 500, MAX_LIMIT; at most the CSV export cap) submissions of the
 * query (CSTU-11 filters) in the date range (default: the last 14 days from
 * midnight UTC to now) are counted per task, per user (group submissions count
 * for each member), per hour/day bucket, and per tag (normal or weighted ratio).
 * Users come with their real name and tasks with their name (ids kept for the links);
 * `chart.partial` tells that the last bucket is still running (it ends after `now`).
 */
import { services } from '../app.js';
import type { Course } from '../courses/course.js';
import { toIsoString } from '../text/dates.js';
import { taskName, userInfos } from './people.js';
import { CSV_FACTOR, evaluationIds, exportCap, MAX_LIMIT, parseIso, selection, type Query } from './query.js';

const DAY = 86_400_000;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Percentage truncated to one decimal, "> 0" when non-zero but truncated to 0 (legacy display). */
const pct = (x: number) => (!x || isNaN(x) ? '0' : Math.trunc(x * 1000) / 10 || '> 0').toString();

/** Computes every statistic of the "Submissions" tab; `query` is returned with the effective dates. */
export async function submissionStats(course: Course, q: Query, lang: string, now = new Date()) {
	const before = parseIso(q.date_before) || now;
	const after = parseIso(q.date_after) || new Date(Math.floor(before.getTime() / DAY) * DAY - 14 * DAY);
	const query = { ...q, eval: false, date_after: q.date_after || toIsoString(after).slice(0, 16) };
	const sel = await selection(course, query);
	const limit = q.limit && q.limit > 0 ? Math.min(q.limit, exportCap(CSV_FACTOR)) : MAX_LIMIT;
	const docs = await services()
		.db.c.submissions.find(sel.filter, { projection: { username: 1, taskid: 1, result: 1, submitted_on: 1, tests: 1 } })
		.sort({ submitted_on: -1 })
		.limit(limit)
		.toArray();
	const ok = docs.map((d) => d.result === 'success');
	const evals = await evaluationIds(course, docs);
	const isEval = docs.map((d) => evals.has(String(d._id)));
	/** Submissions and valid submissions per key, most submitted first. */
	const count = (keys: (i: number) => string[]) => {
		const m = new Map<string, [number, number]>();
		docs.forEach((_, i) => keys(i).forEach((k) => m.set(k, [(m.get(k)?.[0] ?? 0) + 1, (m.get(k)?.[1] ?? 0) + +ok[i]])));
		return [...m]
			.map(([key, [submissions, valid]]) => ({ key, submissions, valid }))
			.sort((a, b) => b.submissions - a.submissions);
	};
	const step = before.getTime() - after.getTime() < 7 * DAY ? DAY / 24 : DAY;
	const first = Math.floor(after.getTime() / step);
	const labels = Array.from({ length: Math.max(Math.floor(before.getTime() / step) - first + 1, 0) }, (_, i) =>
		new Date((first + i) * step).toISOString()
	);
	const series = (keep: (i: number) => boolean) => {
		const out = labels.map(() => 0);
		docs.forEach((d, i) => keep(i) && out[Math.floor(d.submitted_on.getTime() / step) - first]++);
		return out;
	};
	const users = count((i) => docs[i].username);
	const infos = await userInfos(users.map((u) => u.key));
	const tags = Object.values(course.tags)
		.filter((tag) => tag.type < 2)
		.map((tag) => {
			const pairs = new Map<string, number[]>();
			docs.forEach((d, i) =>
				d.username.forEach((u) => {
					const p = pairs.get(`${u}/${d.taskid}`) ?? [0, 0, 0, 0];
					const v = d.tests?.[tag.id] ? 1 : 0;
					[1, v, +isEval[i], v * +isEval[i]].forEach((x, j) => (p[j] += x));
					pairs.set(`${u}/${d.taskid}`, p);
				})
			);
			const ps = [...pairs.values()];
			const ratio = (i: number, j: number) =>
				q.stat === 'pond_stat'
					? sum(ps.filter((p) => p[i]).map((p) => p[j] / p[i])) / ps.filter((p) => p[i]).length
					: sum(ps.map((p) => p[j])) / sum(ps.map((p) => p[i]));
			return {
				name: tag.name,
				description: tag.description,
				misconception: tag.type === 1,
				all: pct(ratio(0, 1)),
				best: pct(ratio(2, 3))
			};
		});
	return {
		query,
		error: sel.error,
		hourly: step < DAY,
		global: {
			total: docs.length,
			evalTotal: sum(isEval.map(Number)),
			evalSucceeded: isEval.filter((e, i) => e && ok[i]).length
		},
		tasks: count((i) => [docs[i].taskid]).map((r) => ({ ...r, key: taskName(course, r.key, lang), id: r.key })),
		users: users.map((r) => ({ ...r, name: infos[r.key].realname || r.key })),
		chart: {
			labels,
			all: series(() => true),
			valid: series((i) => ok[i]),
			partial: (first + labels.length) * step > now.getTime()
		},
		tags: docs.length ? tags : []
	};
}
