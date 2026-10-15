/**
 * Constants of the scale and performance suite (`npm run test:perf`, see
 * docs/performance.md): sizes of the generated data set, isolated database,
 * tasks directory, port and build, and the budgets every measured page must meet.
 */
import { createHmac } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectId } from 'mongodb';

/** Directory of the suite. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Size of the generated data set (bump `version` when the generator changes). */
export const SCALE = {
	version: 1,
	/** Small courses (5 tasks each), besides the big course. */
	courses: 2_000,
	/** Small courses the main student is registered to. */
	registered: 200,
	/** Tasks of the big course, in `sections` × `subsections` sections. */
	bigTasks: 5_000,
	sections: 10,
	subsections: 5,
	/** Students (all registered to the big course). */
	students: 20_000,
	audiences: 500,
	groups: 2_000,
	/** Submissions on the big course's first task (spread over the students). */
	submissionsOnTask: 100_000,
	/** Submissions of the main student on the big course's second task. */
	submissionsOfStudent: 10_000,
	/** Tasks per student with a grading status (`user_tasks`) in the big course. */
	triedTasks: 10,
	/** Sizes (bytes) of the feedback of the large-feedback submissions (MongoDB caps documents at 16 MB). */
	feedbackSizes: [1_000_000, 5_000_000, 15_000_000]
};

/**
 * Identifier of this run: runs with different ids (e.g. one per agent) can execute in
 * parallel on the same (read-only) data set, with their own port, build and results.
 */
export const PERF_ID = process.env.PERF_ID ?? 'main';
/** Index used to derive a distinct port per run. */
const RUN_INDEX = PERF_ID === 'main' ? 0 : 1 + ([...PERF_ID].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 500);

/** Connection settings of the suite. */
export const PERF = {
	mongoUrl: process.env.MONGO_TEST_URL ?? 'mongodb://localhost:27017',
	database: 'INGInious_perf',
	port: 5990 + RUN_INDEX,
	buildDir: process.env.BUILD_OUT ?? `build-perf-${PERF_ID}`,
	/** Generated data (tasks directory, configuration, seed marker). */
	dataDir: join(HERE, '.data'),
	tasksDir: join(HERE, '.data', 'tasks'),
	configFile: join(HERE, '.data', 'config.yaml'),
	resultsDir: join(HERE, 'results'),
	/** Measurements of this run, one JSON object per line (appended by each scenario). */
	resultsFile: join(HERE, 'results', `${PERF_ID}.jsonl`),
	secretKey: 'perf-secret-key-0123456789abcdef0123456789abcdef'
};

/** Main actors of the scenarios. */
export const ACTORS = {
	superadmin: 'superadmin',
	/** Administrator of every course. */
	admin: 'perf_admin',
	/** Student registered to `SCALE.registered` small courses and to the big course, with many submissions. */
	student: 'perf_s00001',
	bigCourse: 'perf_big'
};

/** Username of the student number `i` (1-based). */
export const studentName = (i: number) => `perf_s${String(i).padStart(5, '0')}`;
/** Id of the small course number `i` (1-based). */
export const courseName = (i: number) => `perf_c${String(i).padStart(4, '0')}`;
/** Id of the task number `i` (1-based) of the big course. */
export const taskName = (i: number) => `task${String(i).padStart(4, '0')}`;

/**
 * Budgets of a page (initial targets; docs/performance.md): server time is the
 * median of several requests, sizes are the decoded HTML, browser figures come
 * from the Performance API after the page is hydrated.
 */
export const BUDGET = {
	serverMs: 500,
	htmlBytes: 500_000,
	domNodes: 5_000,
	/** Total blocking time (sum of the long tasks beyond 50 ms). */
	blockingMs: 300,
	lcpMs: 2_500
};

/** Builds the signed session cookie value of a new session document `_id` (lib/server/session). */
export function signSession(id: ObjectId): string {
	const mac = createHmac('sha256', PERF.secretKey).update(id.toHexString()).digest('base64url');
	return `${id.toHexString()}.${mac}`;
}
