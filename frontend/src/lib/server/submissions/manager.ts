/**
 * Submission manager: the whole lifecycle of a submission, shared by the task
 * page, the LTI pages, the REST API and the course administration
 * (port of legacy `submission_manager.py` + `user_manager.update_user_stats`).
 *
 * Public API (see each function):
 *  - `addSubmission(s)`            create a submission (input in GridFS) and send the grading job (TASK-08);
 *  - `completeJob(id, result, …)`  store a job result and update `user_tasks` (TASK-09/13);
 *  - `killSubmission(id, user)`    kill the job of one's own waiting submission (TASK-11);
 *  - `replaySubmission(sub, …)`    re-grade in place or as a copy (TASK-24, admin area);
 *  - `findSubmission(id, filter)`  load a submission scoped to a course/task/user (never outside the filter);
 *  - `deleteSubmissions(filter)`   delete submissions AND their GridFS input/archive;
 *  - `onSubmissionDone(listener)`  internal completion listeners (LTI grade passback, TASK-25);
 *  - `recoverSubmissions()` / `ensureRecovery()`  start-up recovery of lost jobs (TASK-25).
 *
 * Deliberate differences with the legacy frontend (documented in docs/features/task):
 *  - TASK-14: submission tokens are consumed when the submission is CREATED
 *    (atomic `$inc` + check, rolled back when the limit is exceeded) instead of at
 *    completion, so parallel requests cannot exceed the limit; completion only
 *    increments `tried`.
 *  - TASK-08: two parallel submissions of the same user cannot both stay waiting
 *    (the newest one is deleted again).
 *  - TASK-15: pruned submissions also lose their GridFS files.
 *  - TASK-25: at start-up only the waiting submissions whose job is unknown to the
 *    (shared) backend are marked as errors, so that a legacy frontend running on the
 *    same database keeps its jobs.
 */
import type { ObjectId, Filter } from 'mongodb';
import { t } from '#lib/i18n/index.js';
import { services } from '../app.js';
import type { JobResult, SshInfo } from '../backend/client.js';
import type { Course } from '../courses/course.js';
import { groupSubmission, taskConfig } from '../courses/dispenser.js';
import { isCourseStaff, userGroup, userSawTask } from '../courses/members.js';
import type { Task } from '../courses/task.js';
import { dbl, parseId, pyIsoformat } from '../db/index.js';
import type { SubmissionDoc } from '../db/types.js';
import { plugins } from '../plugins/index.js';

/** A stored submission (always has an id). */
export type Submission = SubmissionDoc & { _id: ObjectId };

/** Debug flag of a job: false (students), true (course admins: stdout/stderr kept) or "ssh". */
export type DebugMode = boolean | 'ssh';

/** A refused submission; `message` is translated and can be shown to the user. */
export class SubmissionError extends Error {}

/** Arguments of `addSubmission`. */
export interface NewSubmission {
	course: Course;
	task: Task;
	/** Username of the submitter (his profile email and language are copied into the input). */
	user: string;
	/** Validated input from `buildInput` (posted fields + problem values). */
	input: Record<string, unknown>;
	debug: DebugMode;
	userIp: string;
	/** Extra top-level fields of the document (e.g. LTI `lti_version`, outcome fields). */
	extra?: Record<string, unknown>;
}

/** Job results / SSH credentials being stored (see `settled`). */
const pending = new Set<Promise<void>>();

/** Runs a storage operation triggered by the backend in the background, tracked by `settled`. */
function track(operation: Promise<void>): void {
	const done: Promise<void> = operation.catch(console.error).finally(() => pending.delete(done));
	pending.add(done);
}

/**
 * Resolves once every job result (and SSH credential) received so far is stored (they are stored
 * asynchronously by the backend callback): used at shutdown so that no result is
 * lost, and by tests instead of arbitrary delays.
 */
export async function settled(): Promise<void> {
	while (pending.size) await Promise.allSettled([...pending]);
}

/** Event given to `onSubmissionDone` listeners and to the `submission_done` hook. */
export interface DoneEvent {
	submission: Submission;
	course: Course;
	/** tgz returned by the grader, if any. */
	archive: Uint8Array | null;
	/** false for in-place replays. */
	newsub: boolean;
}

/** A completion listener (errors are logged and ignored). */
export type DoneListener = (event: DoneEvent) => void | Promise<void>;

const listeners = new Set<DoneListener>();
const db = () => services().db;
const SSH_FIELDS = { ssh_host: '', ssh_port: '', ssh_user: '', ssh_password: '' } as const;

/**
 * Registers a listener called after every completed job (after the `user_tasks`
 * update), e.g. the LTI grade passback. @returns a function removing it.
 */
export function onSubmissionDone(listener: DoneListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * Loads a submission restricted by `filter` (always pass the course, and the
 * owner for non-staff viewers, so that a submission is only found in its own course).
 * @returns null for malformed ids or submissions outside the filter.
 */
export async function findSubmission(id: unknown, filter: Filter<SubmissionDoc>): Promise<Submission | null> {
	const _id = parseId(id);
	return _id ? ((await db().c.submissions.findOne({ ...filter, _id })) as Submission | null) : null;
}

/** Deletes submissions with their GridFS input and archive. @returns the deleted ids. */
export async function deleteSubmissions(filter: Filter<SubmissionDoc>): Promise<string[]> {
	const docs = await db()
		.c.submissions.find(filter, { projection: { input: 1, archive: 1 } })
		.toArray();
	await db().c.submissions.deleteMany({ _id: { $in: docs.map((d) => d._id!) } });
	for (const d of docs) {
		await db().deleteFile(d.input);
		if (d.archive) await db().deleteFile(d.archive);
	}
	return docs.map((d) => String(d._id));
}

/**
 * TASK-14: consumes one token of every user (atomic `$inc`), then rolls back
 * when a non-staff user goes beyond the task limit.
 * @returns false when the limit is reached.
 */
async function consumeTokens(course: Course, taskid: string, usernames: string[], enforce: boolean): Promise<boolean> {
	const filter = { courseid: course.id, taskid, username: { $in: usernames } };
	for (const u of usernames) await userSawTask(u, course.id, taskid);
	await db().c.userTasks.updateMany(filter, { $inc: { 'tokens.amount': 1 } });
	const { amount } = taskConfig(course.dispenser, taskid).submissionLimit;
	if (!enforce || amount < 0 || !(await db().c.userTasks.findOne({ ...filter, 'tokens.amount': { $gt: amount } })))
		return true;
	await db().c.userTasks.updateMany(filter, { $inc: { 'tokens.amount': -1 } });
	return false;
}

/** Inserts a waiting submission with the mongoengine defaults and stores its input in GridFS. */
async function insertSubmission(
	doc: Omit<SubmissionDoc, 'input' | 'grade'>,
	input: Record<string, unknown>
): Promise<Submission> {
	const random = ((input['@random'] ?? []) as number[]).map(dbl);
	const defaults = {
		response_type: 'rst',
		grade: dbl(0),
		custom: {},
		problems: {},
		result: 'crash',
		tests: {},
		text: ''
	};
	const sub = { ...defaults, ...doc, input: await db().putInput({ ...input, '@random': random }) };
	const { insertedId } = await db().c.submissions.insertOne(sub);
	return { ...sub, _id: insertedId };
}

/** Sends the grading job of a submission and stores its job id (unless already completed). */
async function launch(
	sub: Submission,
	input: Record<string, unknown>,
	course: Course,
	task: Task,
	debug: DebugMode,
	priority: number,
	newsub: boolean
): Promise<void> {
	// Legacy launcher names: the user for new jobs, the Python list repr for replays.
	const launcher = `Frontend - ${priority ? `[${sub.username.map((u) => `'${u}'`).join(', ')}]` : sub.username[0]}`;
	const { environmentType, environmentId: environment, environmentParameters } = task;
	const job = {
		priority,
		courseId: course.id,
		taskId: task.id,
		problems: task.content.problems as Record<string, unknown>,
		input,
		environmentType,
		environment,
		environmentParameters,
		debug,
		launcher
	};
	const jobid = services().backend.newJob(job, {
		onDone: (r) => track(completeJob(sub._id, r, newsub, course)),
		onSsh: (i) => track(storeSsh(sub._id, i))
	});
	// The job may already be done (environment unavailable): only set the id of a waiting submission.
	if (jobid) await db().c.submissions.updateOne({ _id: sub._id, status: 'waiting' }, { $set: { jobid } });
}

/** TASK-12: stores the SSH debug credentials while the job runs (calls without host are ignored). */
async function storeSsh(id: ObjectId, info: SshInfo): Promise<void> {
	if (!info.host) return;
	await db().c.submissions.updateOne(
		{ _id: id },
		{ $set: { ssh_host: info.host, ssh_port: info.port!, ssh_user: info.user!, ssh_password: info.password! } }
	);
}

/**
 * Sets the submitter metadata of a job input (`@username`, `@email` and `@lang` from
 * his profile, `@attempts`), shared by new submissions and replayed copies.
 * @returns his user task of the task, if any.
 */
async function stampInput(input: Record<string, unknown>, key: { courseid: string; taskid: string }, username: string) {
	const profile = await db().c.users.findOne({ username });
	const userTask = await db().c.userTasks.findOne({ ...key, username });
	Object.assign(input, {
		'@username': username,
		'@email': profile?.email ?? '',
		'@lang': profile?.language ?? 'en',
		'@attempts': String((userTask?.tried ?? 0) + 1)
	});
	return userTask;
}

/**
 * Creates a submission and sends its job (TASK-08, 14, 15, 16).
 * @returns the new submission id and the ids deleted by the stored-submissions limit.
 * @throws SubmissionError when a submission is pending or no token is left.
 */
export async function addSubmission(s: NewSubmission): Promise<{ id: ObjectId; removed: string[] }> {
	const { course, task, user: username } = s;
	const key = { courseid: course.id, taskid: task.id };
	const pending = (before?: ObjectId) =>
		db().c.submissions.findOne({
			...key,
			username,
			status: 'waiting',
			...(before && { _id: { $lt: before } })
		});
	if (await pending()) throw new SubmissionError(t('A submission is already pending for this task!'));
	const staff = isCourseStaff(course, username);
	// TASK-16: non-staff members of a group submit for the whole group.
	const group = !staff && groupSubmission(course.dispenser, task.id) ? await userGroup(course.id, username) : null;
	const usernames = group?.students ?? [username];
	const now = new Date();
	const input: Record<string, unknown> = { ...s.input };
	const userTask = await stampInput(input, key, username);
	Object.assign(input, {
		'@time': pyIsoformat(now, ' '),
		'@random': userTask?.random ?? [],
		'@state': userTask?.state ?? ''
	});
	if (group && !task.problems.some((p) => p.id === 'group')) {
		const users = await db()
			.c.users.find({ username: { $in: usernames } })
			.toArray();
		input['@username'] = usernames.join(',');
		input['@email'] = usernames.map((u) => users.find((x) => x.username === u)?.email ?? '').join(',');
	}
	const doc = {
		...key,
		username: usernames,
		status: 'waiting' as const,
		submitted_on: now,
		user_ip: s.userIp,
		...s.extra
	};
	await plugins().callHook('new_submission', { submission: doc, inputdata: input });
	const sub = await insertSubmission(doc, input);
	// Parallel requests: only the oldest waiting submission survives.
	if (await pending(sub._id)) {
		await deleteSubmissions({ _id: sub._id });
		throw new SubmissionError(t('A submission is already pending for this task!'));
	}
	if (!(await consumeTokens(course, task.id, usernames, !staff))) {
		await deleteSubmissions({ _id: sub._id });
		throw new SubmissionError(t('You are not allowed to submit for this task.'));
	}
	const removed = await pruneSubmissions(course, task.id, username);
	await launch(sub, input, course, task, s.debug, 0, true);
	return { id: sub._id, removed };
}

/**
 * TASK-15: keeps the evaluated submission, the waiting ones and the most recent
 * ones up to `no_stored_submissions`, deletes the others (with their files).
 */
async function pruneSubmissions(course: Course, taskid: string, username: string): Promise<string[]> {
	const max = taskConfig(course.dispenser, taskid).noStoredSubmissions;
	if (max <= 0) return [];
	const key = { courseid: course.id, taskid, username };
	const evaluated = String((await db().c.userTasks.findOne(key))?.submissionid);
	const subs = await db()
		.c.submissions.find(key, { projection: { status: 1 } })
		.sort({ submitted_on: -1 })
		.toArray();
	const keep = new Set(
		subs.filter((s) => s.status === 'waiting' || String(s._id) === evaluated).map((s) => String(s._id))
	);
	for (const s of subs) if (keep.size < max) keep.add(String(s._id));
	return deleteSubmissions({ _id: { $in: subs.filter((s) => !keep.has(String(s._id))).map((s) => s._id!) } });
}

/**
 * TASK-09/13: updates the `user_tasks` of a member after a job. New submissions
 * count a try and become the evaluated one (`last` mode, or `best` with a grade
 * >= the current one); replays recompute the evaluated submission.
 */
async function updateUserStats(username: string, sub: Submission, newsub: boolean, course: Course): Promise<void> {
	const key = { courseid: sub.courseid, taskid: sub.taskid, username };
	await userSawTask(username, sub.courseid, sub.taskid);
	const mode = taskConfig(course.dispenser, sub.taskid).evaluationMode;
	let evaluated: SubmissionDoc = sub;
	if (newsub) {
		const userTask = await db().c.userTasks.findOneAndUpdate(key, { $inc: { tried: 1 } }, { returnDocument: 'after' });
		if (mode === 'best' && userTask!.grade > sub.grade) return;
	} else {
		// The replayed submission itself always matches.
		evaluated = (await db()
			.c.submissions.find(key)
			.sort(mode === 'best' ? { grade: -1, submitted_on: -1 } : { submitted_on: -1 })
			.limit(1)
			.next())!;
	}
	await db().c.userTasks.updateOne(key, {
		$set: {
			succeeded: evaluated.result === 'success',
			grade: dbl(evaluated.grade),
			state: evaluated.state ?? '',
			submissionid: evaluated._id!
		}
	});
}

/**
 * Stores the result of a job (TASK-09): archive in GridFS, result fields
 * (status done for success/failed, error otherwise), `user_tasks` of every
 * member, then the `submission_done` hook and the listeners. A result too
 * large for MongoDB (16 MB) turns the submission into an error.
 * @param newsub false for in-place replays.
 */
export async function completeJob(id: ObjectId, r: JobResult, newsub: boolean, course: Course): Promise<void> {
	const archive = r.archive ? await db().putFile(r.archive) : null;
	const [result, text] = r.result;
	const status = result === 'success' || result === 'failed' ? ('done' as const) : ('error' as const);
	const { tests, problems, custom, state } = r;
	// stdout/stderr are null for mcq jobs, like legacy (stored as BSON null).
	const fields = {
		status,
		result,
		grade: dbl(r.grade),
		text,
		tests,
		problems,
		custom,
		state,
		stdout: r.stdout as string,
		stderr: r.stderr as string,
		...(archive && { archive })
	};
	const $unset = { jobid: '' as const, ...SSH_FIELDS };
	let sub: Submission | null;
	try {
		sub = (await db().c.submissions.findOneAndUpdate(
			{ _id: id },
			{ $set: fields, $unset },
			{ returnDocument: 'after' }
		)) as Submission | null;
	} catch {
		const text = t('Maximum submission size exceeded. Check feedback, stdout, stderr and state.');
		await db().c.submissions.updateOne({ _id: id }, { $set: { status: 'error', text, grade: dbl(0) }, $unset });
		return;
	}
	if (!sub) return; // deleted while grading
	for (const username of sub.username) await updateUserStats(username, sub, newsub, course);
	const event: DoneEvent = { submission: sub, course, archive: r.archive, newsub };
	await plugins().callHook('submission_done', event);
	for (const listener of listeners) await Promise.resolve(listener(event)).catch(console.error);
}

/**
 * TASK-11: kills the job of a waiting submission of `username` (ownership is
 * always checked, even for staff). @returns false when there is nothing to kill.
 */
export async function killSubmission(id: unknown, username: string): Promise<boolean> {
	const sub = await findSubmission(id, { username, status: 'waiting' });
	if (!sub?.jobid) return false;
	services().backend.killJob(sub.jobid);
	return true;
}

/**
 * TASK-24: re-grades a submission with priority 1. In place (default): the
 * archive and result fields are removed and the stored input reused; as a copy
 * (`copy` = the staff member): a new submission of that user with refreshed
 * `@attempts/@username/@email/@lang` (`stampInput`). The guard (admin/staff) is the caller's job.
 * @returns the id of the graded submission.
 */
export async function replaySubmission(
	sub: Submission,
	course: Course,
	task: Task,
	opts: { copy?: { username: string; userIp: string }; debug?: DebugMode } = {}
): Promise<ObjectId> {
	const input = await db().getInput(sub.input);
	const { copy, debug = false } = opts;
	if (copy) {
		await stampInput(input, { courseid: course.id, taskid: task.id }, copy.username);
		const doc = {
			courseid: course.id,
			taskid: task.id,
			username: [copy.username],
			status: 'waiting' as const,
			submitted_on: new Date(),
			user_ip: copy.userIp
		};
		const created = await insertSubmission(doc, input);
		await consumeTokens(course, task.id, [copy.username], false);
		await launch(created, input, course, task, debug, 1, true);
		return created._id;
	}
	if (sub.archive) await db().deleteFile(sub.archive);
	const cleared = Object.fromEntries(
		['result', 'grade', 'text', 'tests', 'problems', 'archive', 'state', 'custom'].map((k) => [k, ''] as const)
	);
	await db().c.submissions.updateOne(
		{ _id: sub._id },
		{ $set: { status: 'waiting', last_replay: new Date() }, $unset: cleared }
	);
	await launch(sub, input, course, task, debug, 1, false);
	return sub._id;
}

/**
 * TASK-25 start-up recovery. Waits for a FRESH job queue snapshot of the backend
 * (shared by every frontend), then marks as errors the waiting submissions created
 * before the call whose job is in neither the running nor the waiting queue.
 * Nothing is done when the backend does not answer within `timeoutMs`.
 * @returns the number of submissions marked as errors.
 */
export async function recoverSubmissions(timeoutMs = 30_000, pollMs = 250): Promise<number> {
	const { backend } = services();
	const since = new Date();
	const before = backend.queue;
	for (let waited = 0; backend.queue === before; waited += pollMs) {
		if (waited >= timeoutMs) return 0;
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
	const alive = [...backend.queue!.running, ...backend.queue!.waiting].map((job) => job[0]);
	const { modifiedCount } = await db().c.submissions.updateMany(
		{ status: 'waiting', submitted_on: { $lt: since }, jobid: { $nin: alive } },
		{
			$set: { status: 'error', grade: dbl(0), text: 'Internal error. Server restarted' },
			$unset: { jobid: '', ...SSH_FIELDS }
		}
	);
	return modifiedCount;
}

let recovery: Promise<number> | null = null;

/** Runs `recoverSubmissions` once per process, in the background (called by the task pages). */
export function ensureRecovery(): Promise<number> {
	recovery ??= recoverSubmissions().catch(() => 0);
	return recovery;
}
