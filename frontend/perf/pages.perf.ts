/**
 * Scale scenarios (docs/performance.md): every page that lists courses, tasks,
 * submissions or students is measured on the generated data set
 * (perf/seed.ts), with:
 *  - server: time to the first byte of the first request (cold caches) and the
 *    median of 3 more (warm), the median time to the complete response and the
 *    size of the HTML. Pages too slow to compute within budget stream their data
 *    (the page comes at once with a spinner): the server budget applies to the
 *    first byte, the complete time is reported;
 *  - browser: DOM size, largest contentful paint, time to hydration
 *    (`inginious:hydrated` mark of the root layout) and total blocking time
 *    (long tasks beyond 50 ms);
 * and compared with the budgets of perf/setup-data.ts (soft assertions: every
 * scenario is measured even when one exceeds a budget). Downloads (CSV exports)
 * are timed to their first byte and to their end. Results are written to
 * perf/results/<PERF_ID>.{jsonl,md}.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MongoClient, ObjectId } from 'mongodb';
import { test, expect, type BrowserContext } from '@playwright/test';
import { ACTORS, BUDGET, PERF, SCALE, signSession, taskName } from './setup-data.js';

/** A measured page. */
interface Scenario {
	id: string;
	title: string;
	/** User (null = anonymous visitor). */
	actor: string | null;
	/** Path, or a function of the ids looked up before the run. */
	path: string | ((ids: Ids) => string);
}

/** Ids looked up in the database before the run. */
interface Ids {
	/** Submission with the largest feedback. */
	bigFeedback: string;
}

/** Result of a scenario (one row of the report). */
interface Result {
	id: string;
	title: string;
	coldMs: number;
	warmMs: number;
	/** Complete response (streamed data included), warm median. */
	completeMs?: number;
	htmlBytes: number;
	domNodes?: number;
	lcpMs?: number;
	hydratedMs?: number;
	blockingMs?: number;
	totalMs?: number;
}

const C = ACTORS.bigCourse;
const PAGES: Scenario[] = [
	{
		id: 'courselist-anon',
		title: `Course list (${SCALE.courses + 1} courses), anonymous`,
		actor: null,
		path: '/courselist'
	},
	{ id: 'courselist', title: 'Course list, student', actor: ACTORS.student, path: '/courselist' },
	{ id: 'mycourses', title: `My courses (${SCALE.registered + 1} courses)`, actor: ACTORS.student, path: '/mycourses' },
	{ id: 'coming-tasks', title: 'Upcoming tasks (200 courses)', actor: ACTORS.student, path: '/coming_tasks' },
	{ id: 'course', title: `Course with ${SCALE.bigTasks} tasks`, actor: ACTORS.student, path: `/course/${C}` },
	{
		id: 'task-100k',
		title: `Task with ${SCALE.submissionsOnTask} submissions`,
		actor: ACTORS.student,
		path: `/course/${C}/${taskName(1)}`
	},
	{
		id: 'task-history',
		title: `Task, ${SCALE.submissionsOfStudent} own submissions`,
		actor: ACTORS.student,
		path: `/course/${C}/${taskName(2)}`
	},
	{ id: 'task-feedback', title: 'Task, 15 MB feedback', actor: ACTORS.student, path: `/course/${C}/${taskName(3)}` },
	{
		id: 'submission-feedback',
		title: 'Submission, 15 MB feedback',
		actor: ACTORS.admin,
		path: (i) => `/submission/${i.bigFeedback}`
	},
	{
		id: 'admin-tasks',
		title: `Task list editor (${SCALE.bigTasks} tasks)`,
		actor: ACTORS.admin,
		path: `/admin/${C}/tasks`
	},
	{ id: 'admin-settings', title: 'Course settings', actor: ACTORS.admin, path: `/admin/${C}/settings` },
	{ id: 'admin-students', title: `Students (${SCALE.students})`, actor: ACTORS.admin, path: `/admin/${C}/students` },
	{
		id: 'admin-audiences',
		title: `Audiences (${SCALE.audiences})`,
		actor: ACTORS.admin,
		path: `/admin/${C}/students?tab=audiences`
	},
	{
		id: 'admin-groups',
		title: `Groups (${SCALE.groups})`,
		actor: ACTORS.admin,
		path: `/admin/${C}/students?tab=groups`
	},
	{ id: 'admin-student', title: 'One student', actor: ACTORS.admin, path: `/admin/${C}/student/${ACTORS.student}` },
	{
		id: 'admin-submissions',
		title: `Submissions (${SCALE.submissionsOnTask + SCALE.submissionsOfStudent})`,
		actor: ACTORS.admin,
		path: `/admin/${C}/submissions`
	},
	{ id: 'admin-stats', title: 'Course statistics', actor: ACTORS.admin, path: `/admin/${C}/stats` },
	{
		id: 'admin-progress',
		title: `Student progress (${SCALE.students} students)`,
		actor: ACTORS.admin,
		path: `/admin/${C}/stats?tab=progress`
	},
	{ id: 'admin-users', title: `Users (${SCALE.students + 2})`, actor: ACTORS.superadmin, path: '/administrator/users' }
];
const DOWNLOADS: Scenario[] = [
	{
		id: 'csv-submissions',
		title: 'Submissions CSV',
		actor: ACTORS.admin,
		path: `/admin/${C}/submissions/submissions.csv`
	},
	{ id: 'csv-students', title: 'Students CSV', actor: ACTORS.admin, path: `/admin/${C}/students/students.csv` },
	{ id: 'csv-progress', title: 'Progress CSV', actor: ACTORS.admin, path: `/admin/${C}/students/progress.csv` }
];

let ids: Ids;

/** Creates a logged-in session for `username` in the perf database; returns the cookie value. */
async function login(username: string): Promise<string> {
	const client = await MongoClient.connect(PERF.mongoUrl);
	try {
		const db = client.db(PERF.database);
		const user = await db.collection('users').findOne({ username });
		const id = new ObjectId();
		await db.collection('sessions').insertOne({
			_id: id,
			permanent: true,
			is_lti: false,
			loggedin: true,
			auth_storage: {},
			expiration: new Date(Date.now() + 3600_000),
			code_indentation: '4',
			email: user!.email,
			language: 'en',
			realname: user!.realname,
			token: null,
			tos_signed: true,
			username,
			timezone: 'UTC'
		});
		return signSession(id);
	} finally {
		await client.close();
	}
}

/** Authenticates the browser context as `actor` (anonymous when null). */
async function as(context: BrowserContext, actor: string | null, baseURL: string): Promise<void> {
	await context.clearCookies();
	if (actor) await context.addCookies([{ name: 'inginious_session_id', value: await login(actor), url: baseURL }]);
}

/** Median of a list of numbers. */
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test.beforeAll(async () => {
	const client = await MongoClient.connect(PERF.mongoUrl);
	try {
		const big = await client
			.db(PERF.database)
			.collection('submissions')
			.find({ courseid: C, taskid: taskName(3) })
			.sort({ submitted_on: -1 })
			.limit(1)
			.next();
		ids = { bigFeedback: String(big!._id) };
	} finally {
		await client.close();
	}
});

/**
 * Records a result: appended to the run's JSON lines file (Playwright restarts the
 * worker after a failed test, so nothing is kept in memory), then the Markdown
 * report of the run (perf/results/<PERF_ID>.md) is rewritten from that file.
 */
function record(result: Result): void {
	console.log(JSON.stringify(result));
	mkdirSync(PERF.resultsDir, { recursive: true });
	appendFileSync(PERF.resultsFile, JSON.stringify(result) + '\n');
	const all = readFileSync(PERF.resultsFile, 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Result);
	const fmt = (v: number | undefined, unit = '') =>
		v === undefined ? '' : `${Math.round(v).toLocaleString('en-US')}${unit}`;
	const rows = all.map(
		(r) =>
			`| ${r.title} | ${fmt(r.coldMs, ' ms')} | ${fmt(r.warmMs, ' ms')} | ${fmt(r.completeMs, ' ms')} | ${fmt(r.htmlBytes / 1024, ' KB')} | ` +
			`${fmt(r.domNodes)} | ${fmt(r.lcpMs, ' ms')} | ${fmt(r.hydratedMs, ' ms')} | ${fmt(r.blockingMs, ' ms')} | ${fmt(r.totalMs, ' ms')} |`
	);
	writeFileSync(
		PERF.resultsFile.replace(/\.jsonl$/, '.md'),
		[
			`Measured ${new Date().toISOString().slice(0, 16)} on ${SCALE.courses + 1} courses, ${SCALE.students} students, ` +
				`${SCALE.submissionsOnTask + SCALE.submissionsOfStudent + SCALE.feedbackSizes.length} submissions.`,
			'',
			'| Scenario | First byte (cold) | First byte (warm) | Complete (warm) | Size | DOM nodes | LCP | Hydrated | Blocking | Download |',
			'|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
			...rows,
			''
		].join('\n')
	);
}

for (const s of PAGES)
	test(`PERF ${s.id}: ${s.title}`, async ({ page, context, baseURL }) => {
		const path = typeof s.path === 'string' ? s.path : s.path(ids);
		await as(context, s.actor, baseURL!);
		// Server: one cold request, then three warm ones; first byte (headers) and complete response.
		const cookie = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
		const times: number[] = [];
		const complete: number[] = [];
		let htmlBytes = 0;
		for (let i = 0; i < 4; i++) {
			const start = performance.now();
			const response = await fetch(new URL(path, baseURL), {
				headers: { cookie, 'x-forwarded-proto': 'http' },
				redirect: 'manual'
			});
			times.push(performance.now() - start);
			htmlBytes = (await response.arrayBuffer()).byteLength;
			complete.push(performance.now() - start);
			expect(response.status, `${path} answers 200`).toBe(200);
		}
		// Browser: long tasks are recorded from the start of the page.
		await page.addInitScript(() => {
			const w = window as unknown as { longTasks: number[] };
			w.longTasks = [];
			new PerformanceObserver((list) => list.getEntries().forEach((e) => w.longTasks.push(e.duration))).observe({
				type: 'longtask',
				buffered: true
			});
		});
		await page.goto(path, { waitUntil: 'load', timeout: 120_000 });
		await page.locator('html[data-hydrated]').waitFor({ state: 'attached', timeout: 120_000 });
		const browser = await page.evaluate(async () => {
			const lcp = await new Promise<number>((resolve) => {
				new PerformanceObserver((list) => {
					const entries = list.getEntries();
					resolve(entries[entries.length - 1]?.startTime ?? 0);
				}).observe({ type: 'largest-contentful-paint', buffered: true });
				setTimeout(() => resolve(0), 1000);
			});
			const longTasks = (window as unknown as { longTasks: number[] }).longTasks;
			return {
				domNodes: document.getElementsByTagName('*').length,
				lcpMs: lcp,
				hydratedMs: performance.getEntriesByName('inginious:hydrated')[0]?.startTime ?? 0,
				blockingMs: longTasks.reduce((sum, d) => sum + Math.max(0, d - 50), 0)
			};
		});
		const result: Result = {
			id: s.id,
			title: s.title,
			coldMs: times[0],
			warmMs: median(times.slice(1)),
			completeMs: median(complete.slice(1)),
			htmlBytes,
			...browser
		};
		record(result);
		expect.soft(result.warmMs, 'server time to first byte (warm, ms)').toBeLessThanOrEqual(BUDGET.serverMs);
		expect.soft(result.htmlBytes, 'HTML size (bytes)').toBeLessThanOrEqual(BUDGET.htmlBytes);
		expect.soft(result.domNodes!, 'DOM nodes').toBeLessThanOrEqual(BUDGET.domNodes);
		expect.soft(result.lcpMs!, 'largest contentful paint (ms)').toBeLessThanOrEqual(BUDGET.lcpMs);
		expect.soft(result.blockingMs!, 'total blocking time (ms)').toBeLessThanOrEqual(BUDGET.blockingMs);
	});

for (const s of DOWNLOADS)
	test(`PERF ${s.id}: ${s.title}`, async ({ context, baseURL }) => {
		await as(context, s.actor, baseURL!);
		const start = performance.now();
		const response = await context.request.get(s.path as string, { timeout: 120_000 });
		const first = performance.now() - start;
		const bytes = (await response.body()).length;
		const result: Result = {
			id: s.id,
			title: s.title,
			coldMs: first,
			warmMs: first,
			htmlBytes: bytes,
			totalMs: performance.now() - start
		};
		record(result);
		expect(response.status()).toBe(200);
		expect.soft(result.totalMs!, 'download time (ms)').toBeLessThanOrEqual(30_000);
	});
