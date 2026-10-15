/**
 * Port of the legacy "contests" plugin (SITE-14): ACM-ICPC style contests on
 * top of the `contest` task dispenser (courses/dispenser.ts, which opens the
 * toc tasks at the contest start). Pages: /contest/<courseid> (scoreboard)
 * and /contest/<courseid>/admin (settings, course admins).
 *
 * Differences with legacy: the settings have their own page (legacy: a block
 * of the task list form) and a rejected form never changes the running
 * contest (legacy mutated the cached settings); the scoreboard is restricted
 * to registered students and staff, and lists the tasks to students only once
 * they are open (contest started; hidden tasks never); the course
 * menu shows links instead of the JavaScript countdown (the scoreboard page
 * shows the dates and refreshes itself every 30 seconds).
 */
import { error } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import type { NavItem } from '#lib/components/layout/nav.js';
import type { PluginRegistry } from '../index.js';
import { services } from '../../app.js';
import { parseDate } from '../../courses/accessible.js';
import { courseTaskIds, saveCourse, type Course } from '../../courses/course.js';
import type { ContestSettings } from '../../courses/dispenser.js';
import { isCourseAdmin, registeredUsers } from '../../courses/members.js';
import { attempt } from '../../attempt.js';
import { listedTasks, realnames, type Cell, type Ranking } from './inginious.frontend.plugins.scoreboard.js';

/** Legacy module name of the plugin. */
export const MODULE = 'inginious.frontend.plugins.contests';

/** Registers the course menu entries (scoreboard when enabled, settings for admins). */
export function init(registry: PluginRegistry): void {
	registry.addHook<{ course: Course; username: string | null }, NavItem[]>('course_menu', ({ course, username }) => {
		if (course.dispenser.kind !== 'contest') return null;
		const items = course.dispenser.contest?.enabled ? [{ label: t('Contest'), href: `/contest/${course.id}` }] : [];
		if (isCourseAdmin(course, username))
			items.push({ label: t('Contest settings'), href: `/contest/${course.id}/admin` });
		return items;
	});
}

/** Contest settings of a course (404 when its dispenser is not a contest). */
export function contestOf(course: Course): ContestSettings {
	if (course.dispenser.kind !== 'contest' || !course.dispenser.contest) error(404, t('Not found'));
	return course.dispenser.contest;
}

/** Legacy-compatible date string ("2026-10-14 04:42:01+00:00") of a posted date. */
const isoDate = (instant: number) =>
	new Date(instant)
		.toISOString()
		.replace('T', ' ')
		.replace(/\.\d+Z$/, '+00:00');

/** Parses a non-negative integer setting; @returns the value or the legacy error message. */
function count(value: unknown, invalid: string): number | string {
	if (typeof value !== 'string' || !/^\s*-?\d+\s*$/.test(value)) return invalid;
	return Number(value) < 0 ? `${invalid}: ${t('should be greater than 0')}` : Number(value);
}

/**
 * SITE-14: validates posted settings (legacy messages) and saves them in course.yaml.
 * @returns null on success, else the error message.
 */
export function saveContest(course: Course, form: Record<string, unknown>): string | null {
	const parse = (v: unknown) =>
		attempt(
			() => parseDate(String(v)),
			() => NaN
		);
	const [start, end] = [parse(form.start), parse(form.end)];
	const blackout = count(form.blackout, t('Invalid number of hours for the blackout'));
	const penalty = count(form.penalty, t('Invalid number of minutes for the penalty'));
	const message = Number.isNaN(start)
		? t('Invalid start date')
		: Number.isNaN(end)
			? t('Invalid end date')
			: start >= end
				? t('Start date should be before end date')
				: [blackout, penalty].find((v) => typeof v === 'string');
	if (message) return message as string;
	const settings = { enabled: form.enabled === 'on', start: isoDate(start), end: isoDate(end), blackout, penalty };
	saveCourse(course.id, {
		...course.content,
		dispenser_data: { ...(course.content.dispenser_data as object), contest_settings: settings }
	});
	return null;
}

/** Result of a contestant on a task: status, number of counted tries, score (minutes) once accepted. */
type Status = { s: 'NA' | 'WA' | 'TLE' | 'AC' | 'ACF'; tries: number; score?: number };

const CLASSES: Record<Status['s'], string> = {
	NA: '',
	WA: 'preset-tonal-error',
	TLE: 'preset-tonal-error',
	AC: 'preset-tonal-success',
	ACF: 'preset-filled-success-500'
};

/**
 * SITE-14: contest scoreboard (legacy algorithm: solved count, then minutes
 * since the start + penalty per wrong try; submissions of the blackout ignored),
 * over the tasks listed to the viewer (`listedTasks`).
 * @param timeZone time zone of the viewer for the activity times.
 */
export async function contestScoreboard(course: Course, username: string, lang: string, timeZone: string) {
	const c = contestOf(course);
	if (!c.enabled) error(404, t('Not found'));
	const [start, end] = [parseDate(c.start), parseDate(c.end)];
	const blackout = end - c.blackout * 3_600_000;
	const users = await registeredUsers(course, true);
	const tasks = listedTasks(course, courseTaskIds(course), username);
	const names = await realnames(users);
	const state = Object.fromEntries(
		users.map((u) => [u, Object.fromEntries(tasks.map((id) => [id, { s: 'NA', tries: 0 } as Status]))])
	);
	const subs = await services()
		.db.c.submissions.find({
			username: { $in: users },
			courseid: course.id,
			submitted_on: { $gte: new Date(start), $lt: new Date(blackout) },
			status: 'done'
		})
		.sort({ submitted_on: 1 })
		.toArray();
	const solved = new Set<string>();
	const activity: Cell[][] = [];
	for (const sub of subs)
		for (const u of sub.username) {
			const st = state[u]?.[sub.taskid];
			if (!st || st.s === 'AC' || st.s === 'ACF') continue;
			if (sub.result === 'success') {
				st.s = solved.has(sub.taskid) ? 'AC' : 'ACF';
				solved.add(sub.taskid);
				st.score = (sub.submitted_on.getTime() - start) / 60_000 + c.penalty * st.tries;
			} else if (sub.result === 'failed' || sub.result === 'killed' || sub.result === 'timeout')
				st.s = sub.result === 'timeout' ? 'TLE' : 'WA';
			else continue; // internal errors are not counted
			st.tries += 1;
			const ok = st.s === 'AC' || st.s === 'ACF';
			activity.unshift([
				{ v: sub.submitted_on.toLocaleString(lang.replace('_', '-'), { timeZone }) },
				{ v: names.get(u)! },
				{ v: sub.taskid },
				{ v: ok ? t('Succeeded') : t('Failed'), c: CLASSES[ok ? 'AC' : 'WA'] }
			]);
		}
	const totals = users.map((u) => {
		const done = Object.values(state[u]).filter((st) => st.score !== undefined);
		return { u, solved: done.length, total: done.reduce((sum, st) => sum + st.score!, 0) };
	});
	totals.sort((a, b) => b.solved - a.solved || a.total - b.total);
	const rows = totals.map((r, i) => {
		const tie = i > 0 && totals[i - 1].solved === r.solved && totals[i - 1].total === r.total;
		const cells = tasks.map((id) => {
			const st = state[r.u][id];
			return { v: st.score !== undefined ? `${st.tries}/${Math.floor(st.score)}` : String(st.tries), c: CLASSES[st.s] };
		});
		return [{ v: tie ? '' : i + 1 }, { v: names.get(r.u)! }, { v: r.solved }, { v: Math.floor(r.total) }, ...cells];
	});
	const ranking: Ranking = {
		header: [t('Rank'), t('Contestant'), t('Solved'), t('Score'), ...tasks],
		rows,
		emphasis: [2, 3]
	};
	const now = Date.now();
	return {
		...ranking,
		activity,
		start: new Date(start).toISOString(),
		end: new Date(end).toISOString(),
		started: now >= start,
		finished: now > end
	};
}
