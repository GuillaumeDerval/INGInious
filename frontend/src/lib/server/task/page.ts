/**
 * Domain logic of the task page `/course/<courseid>/<taskid>` (TASK-01..22),
 * kept out of the route files so that it can be unit tested:
 *  - `loadTaskPage`: guards + every piece of data displayed by the page;
 *  - `taskAction`: the JSON actions posted to the page URL (`@action` =
 *    submit | check | load | kill), like the legacy AJAX protocol;
 *  - `serveTaskFile`: public task files, submitted input files and grading
 *    archives (`/course/<courseid>/<taskid>/<path>`).
 *
 * Access rules: tasks hidden to the viewer give 403; a submission is only
 * readable through the course AND task it belongs to (staff included); unregistered users cannot submit; anonymous
 * previews do not write `user_tasks`; only problem inputs are downloadable.
 */
import { error, type RequestEvent } from '@sveltejs/kit';
import { Double, type Filter } from 'mongodb';
import { readFileSync, statSync } from 'node:fs';
import { t, format } from '#lib/i18n/index.js';
import type { ProblemData, SubmissionJson, TaskPageData } from '#lib/components/task/types.js';
import { services } from '../app.js';
import { afterStart, isNeverAccessible, isOpen, isOpenWithSoftDeadline } from '../courses/accessible.js';
import {
	isRegistrationPossible,
	requireCourseAccess,
	requireTask,
	taskCanUserSubmit,
	taskIsVisibleByUser
} from '../courses/access.js';
import { courseTaskIds, type Course } from '../courses/course.js';
import { accessibility, groupSubmission, orderedTasks, taskConfig, userTaskList } from '../courses/dispenser.js';
import { coursePath } from '../courses/files.js';
import type { SubmissionDoc } from '../db/types.js';
import { disposition, download } from '../forms.js';
import { userGroup, userSawTask } from '../courses/members.js';
import { buildInput, problemView } from '../courses/problems.js';
import { PyRandom } from '../courses/pyrandom.js';
import type { Task } from '../courses/task.js';
import { plugins } from '../plugins/index.js';
import { safeJoin } from '../security/paths.js';
import { submissionToJson, summarize } from '../submissions/feedback.js';
import {
	addSubmission,
	ensureRecovery,
	findSubmission,
	killSubmission,
	SubmissionError,
	type Submission
} from '../submissions/manager.js';
import { renderText } from '../text/index.js';

/** Content types of the public files served inline; anything else is downloaded. */
const INLINE_TYPES: Record<string, string> = {
	txt: 'text/plain',
	json: 'application/json',
	svg: 'image/svg+xml',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	pdf: 'application/pdf',
	html: 'text/html',
	css: 'text/css',
	csv: 'text/csv',
	md: 'text/plain',
	py: 'text/plain'
};

/**
 * TASK-17: random inputs like legacy (`random.seed(username + taskid + courseid
 * [+ time])` then `random.random()`), with the CPython generator.
 */
export function randomInputs(task: Task, username: string | null): number[] {
	const seed =
		(username ?? '') + task.id + task.courseId + (task.regenerateInputRandom ? String(Date.now() / 1000) : '');
	const rng = new PyRandom(seed);
	// CPython random(): (a * 2^26 + b) / 2^53 with a = 27 bits, b = 26 bits.
	return Array.from(
		{ length: task.inputRandom },
		() => ((rng.getrandbits(32) >>> 5) * 67108864 + (rng.getrandbits(32) >>> 6)) / 9007199254740992
	);
}

/** Course access + visible task (403 "Task unavailable" otherwise, TASK-18). */
async function access(event: RequestEvent, courseid: string, taskid: string) {
	const acc = await requireCourseAccess(event, courseid);
	const task = requireTask(acc.course, taskid);
	const lti = Boolean(event.locals.session.doc.is_lti);
	if (!(await taskIsVisibleByUser(acc.course, task.id, acc.user?.username ?? null, lti)))
		error(403, t('Task unavailable'));
	return { ...acc, task, lti, username: acc.user?.username ?? null };
}

/** Why the user cannot submit (legacy order of the disabled-button messages), null if he can. */
async function blockedReason(
	course: Course,
	task: Task,
	username: string | null,
	registered: boolean,
	lti: boolean
): Promise<string | null> {
	if (!username || !registered) return t('Please enroll in the course to submit.');
	if (await taskCanUserSubmit(course, task.id, username, { lti })) return null;
	if (!isOpen(accessibility(course.dispenser, task.id, username)))
		return t('The deadline is over, you cannot submit anymore');
	const groupTask = groupSubmission(course.dispenser, task.id);
	if (groupTask && !(await userGroup(course.id, username))) return t('Please register in a group');
	// Registered, open, in a group: only the tokens remain (TASK-14).
	const { period } = taskConfig(course.dispenser, task.id).submissionLimit;
	const msg = groupTask
		? t('Your group have reached the submission limit.')
		: t('You have reached the submission limit.');
	return period > 0 ? `${msg} ${t('It will be refilled within the next {} hour(s)', period)}` : msg;
}

/** Formats the contact URL template; only http(s) and mailto links are kept. */
function contactUrl(task: Task, username: string | null): string | null {
	const url = format(task.contactUrl, { course_id: task.courseId, task_id: task.id, username: username ?? '' });
	return /^(https?:|mailto:)/i.test(url) ? url : null;
}

/** Display data of the problems (TASK-02..06), headers and choices rendered. */
function problemsData(task: Task, lang: string, username: string | null, random: number[]): ProblemData[] {
	const { config } = services();
	const render = (text: string) => renderText(text, { language: lang, random });
	const many = task.problems.length > 1;
	return task.problems.map((p, i) => {
		const view = problemView(p, { language: lang, username, tr: task.tr, defaults: config });
		const { name, header, choices, ...rest } = view;
		return {
			...rest,
			title: many ? t('Question {}: {}', i + 1, name) : name,
			header: render(header),
			...(choices && { choices: choices.map((c) => ({ index: c.index, html: render(c.text) })) })
		};
	});
}

/**
 * Loads everything displayed by the task page (TASK-01).
 * @param ltiAssetRewrite LTI-06: rewriting of the relative URLs of the statement.
 */
export async function loadTaskPage(
	event: RequestEvent,
	courseid: string,
	taskid: string,
	ltiAssetRewrite?: (url: string) => string
): Promise<TaskPageData> {
	const { course, task, username, registered, staff, admin, lti } = await access(event, courseid, taskid);
	void ensureRecovery();
	const { db, config } = services();
	const lang = event.locals.lang;
	const key = { courseid: course.id, taskid: task.id };
	const random = randomInputs(task, username);
	let userTask = null;
	if (username) {
		await userSawTask(username, course.id, task.id);
		const $set = { random: random.map((r) => new Double(r)) as unknown as number[] };
		userTask = await db.c.userTasks.findOneAndUpdate({ ...key, username }, { $set }, { returnDocument: 'after' });
	}
	const evaluated = userTask?.submissionid ? String(userTask.submissionid) : null;
	// TASK-10: the history is paginated, the state comes from targeted queries (scale: thousands of submissions).
	const mine = { ...key, username: username! };
	const [history, count, evalSub, waiting] = registered
		? await Promise.all([
				historyPage(course, mine, admin, null),
				db.c.submissions.countDocuments(mine),
				evaluated ? db.c.submissions.findOne({ ...mine, _id: userTask!.submissionid! }, { projection: STATE }) : null,
				db.c.submissions.findOne({ ...mine, status: 'waiting' }, { projection: STATE, sort: NEWEST })
			])
		: [{ submissions: [], more: false }, 0, null, null];
	const acc = accessibility(course.dispenser, task.id, username);
	const cfg = taskConfig(course.dispenser, task.id);
	const visible = userTaskList(course.dispenser, courseTaskIds(course), username);
	const order = orderedTasks(course.dispenser, visible);
	const pos = order.indexOf(task.id);
	const doc = username ? await db.c.users.findOne({ username }) : null;
	const isGroup = groupSubmission(course.dispenser, task.id) && registered && !staff;
	const status =
		evalSub?.status === 'done' && evalSub.result === 'success'
			? 'succeeded'
			: waiting
				? 'waiting'
				: count
					? 'failed'
					: 'notattempted';
	return {
		courseId: course.id,
		courseName: course.tr(lang, course.name),
		taskId: task.id,
		name: task.tr(lang, task.name),
		context: renderText(task.tr(lang, task.context), { language: lang, random, ltiAssetRewrite }),
		problems: problemsData(task, lang, username, random),
		random,
		username,
		registered,
		staff,
		admin,
		blocked: await blockedReason(course, task, username, registered, lti),
		registerUrl: !registered && username && isRegistrationPossible(course, doc) ? `/register/${course.id}` : null,
		info: {
			author: task.tr(lang, task.author),
			contactUrl: contactUrl(task, username),
			deadline: Number.isFinite(acc.softEnd) ? new Date(acc.softEnd).toISOString() : null,
			neverAccessible: isNeverAccessible(acc),
			pastSoftDeadline: isOpen(acc) && !isOpenWithSoftDeadline(acc),
			status: registered ? status : null,
			grade: userTask?.grade ?? 0,
			tried: userTask?.tried ?? 0,
			limit: cfg.submissionLimit,
			categories: cfg.categories,
			left:
				username && cfg.submissionLimit.amount >= 0
					? Math.max(0, cfg.submissionLimit.amount - (userTask?.tokens?.amount ?? 0))
					: null
		},
		evaluationMode: cfg.evaluationMode,
		tags: Object.values(course.tags)
			.filter((tag) => tag.type < 2 && (tag.visible || staff))
			.map((tag) => ({ id: tag.id, name: course.tr(lang, tag.name), type: tag.type })),
		...history,
		submissionCount: count,
		evaluated,
		waiting: waiting ? String(waiting._id) : null,
		group: isGroup ? { description: (await userGroup(course.id, username!))?.description ?? null } : null,
		prev: pos > 0 ? order[pos - 1] : null,
		next: pos >= 0 && pos < order.length - 1 ? order[pos + 1] : null,
		courseHidden: staff && !isOpen(course.accessible),
		taskHidden: staff && !afterStart(acc),
		menu: (await plugins().callHook<object, { label: string; href: string }>('task_menu', { course, task })).map(
			({ label, href }) => ({ label, href })
		),
		webterm: admin ? (config.webterm ?? null) : null
	};
}

/** Submissions per page of the history (TASK-10). */
export const HISTORY_PAGE = 20;
/** Order of the history: newest first, ties broken by id (stable pages). */
const NEWEST = { submitted_on: -1, _id: -1 } as const;
/** Fields of the submissions read for the task state. */
const STATE = { status: 1, result: 1 } as const;

/**
 * One page of a user's history of a task (TASK-10): the `HISTORY_PAGE`
 * submissions of `filter` (course, task, user) after `after` in the history
 * order (from the newest when null), and whether more remain.
 */
async function historyPage(course: Course, filter: Filter<SubmissionDoc>, admin: boolean, after: Submission | null) {
	const older = after && {
		$or: [{ submitted_on: { $lt: after.submitted_on } }, { submitted_on: after.submitted_on, _id: { $lt: after._id } }]
	};
	const docs = (await services()
		.db.c.submissions.find(
			{ ...filter, ...older },
			{ projection: { status: 1, result: 1, grade: 1, submitted_on: 1, tests: 1 } }
		)
		.sort(NEWEST)
		.limit(HISTORY_PAGE + 1)
		.toArray()) as Submission[];
	return {
		submissions: docs.slice(0, HISTORY_PAGE).map((s) => summarize(s, course, admin)),
		more: docs.length > HISTORY_PAGE
	};
}

/** JSON error answer of the actions (legacy `{status: "error", text}`). */
const fail = (text: string, status = 200) => Response.json({ status: 'error', text }, { status });

/**
 * Handles the JSON actions posted to the task page (TASK-08..12):
 * `submit` (multipart form of the answers), `check` / `load` (`submissionid`:
 * result or result + input), `kill` (`submissionid`), `history` (the page of the
 * user's history after his submission `before`, TASK-10).
 * @param extra top-level fields of the new submissions (LTI-05 grade passback tags).
 */
export async function taskAction(
	event: RequestEvent,
	courseid: string,
	taskid: string,
	extra?: Record<string, unknown>
): Promise<Response> {
	const { course, task, username, staff, admin, lti } = await access(event, courseid, taskid);
	if (!username) error(403, t('You are not allowed to submit for this task.'));
	const form = await event.request.formData();
	const action = form.get('@action');
	const { db, config } = services();
	if (action === 'submit') {
		if (!(await taskCanUserSubmit(course, task.id, username, { lti })))
			return fail(t('You are not allowed to submit for this task.'));
		await userSawTask(username, course.id, task.id);
		// TASK-17: the posted random values must be the current ones.
		const ut = await db.c.userTasks.findOne({ courseid: course.id, taskid: task.id, username });
		if ((ut?.random ?? []).some((r, i) => Number(form.get(`@random_${i}`) ?? NaN) !== r))
			return fail(t('Your task has been regenerated. This current task is outdated.'));
		const input = await buildInput(task.problems, form, config);
		if (!input)
			return fail(
				t(
					'Please answer to all the questions and verify the extensions of the files you want to upload. Your responses were not tested.'
				)
			);
		try {
			const { id, removed } = await addSubmission({
				course,
				task,
				input,
				userIp: event.getClientAddress(),
				user: username,
				// TASK-12/21: admin jobs are debug jobs, "ssh" on request.
				debug: admin ? (form.get('@debug-mode') === 'ssh' ? 'ssh' : true) : false,
				extra
			});
			return Response.json({ status: 'ok', submissionid: String(id), remove: removed });
		} catch (e) {
			if (e instanceof SubmissionError) return fail(e.message);
			throw e;
		}
	}
	if (action === 'history') {
		const mine = { courseid: course.id, taskid: task.id, username };
		const after = await findSubmission(form.get('before'), mine);
		if (!after) return fail(t('Internal error'), 404);
		return Response.json({ status: 'ok', ...(await historyPage(course, mine, admin, after)) });
	}
	const id = form.get('submissionid');
	if (action === 'kill') return Response.json({ status: 'done', killed: await killSubmission(id, username) });
	if (action !== 'check' && action !== 'load') error(400, t('Invalid action'));
	const sub = await findSubmission(id, { courseid: course.id, taskid: task.id, ...(!staff && { username }) });
	if (!sub) return fail(t('Internal error'), 404);
	const ut = await db.c.userTasks.findOne({ courseid: course.id, taskid: task.id, username });
	const replace = String(ut?.submissionid) === String(sub._id);
	const json: SubmissionJson = await submissionToJson(
		sub,
		course,
		{ staff, admin },
		{ replace, reloading: action === 'load' }
	);
	return Response.json({ status: 'ok', submission: json });
}

/**
 * Response serving bytes: inline types (unless `attach`) are displayed and sandboxed by CSP
 * (author-controlled HTML/SVG cannot run scripts), anything else is an attachment.
 */
function fileResponse(data: Uint8Array, path: string, attach: boolean): Response {
	const type = INLINE_TYPES[path.split('.').pop()!.toLowerCase()];
	const name = path.split('/').pop()!;
	const body = data as Uint8Array<ArrayBuffer>;
	if (!type || attach) return download(body, name, type);
	return new Response(body, {
		headers: {
			'Content-Type': type,
			'Content-Disposition': disposition('inline', name),
			'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"
		}
	});
}

/**
 * GET `/course/<courseid>/<taskid>/<path>` (TASK-04/22/23):
 *  - `$input/<submissionid>/<problemid>`: a submitted answer (file or text), owner or staff;
 *  - `$archive/<submissionid>`: the grading archive (tgz), course staff only;
 *  - anything else: a file of `<task>/public/` (or `<course>/$common/public/` for taskid `$common`).
 * Malformed paths and missing files give 404.
 */
export async function serveTaskFile(
	event: RequestEvent,
	courseid: string,
	taskid: string,
	path: string
): Promise<Response> {
	const parts = path.split('/');
	if (taskid === '$common') {
		const acc = await requireCourseAccess(event, courseid);
		return publicFile(acc.course, '$common', path);
	}
	const { course, task, username, staff } = await access(event, courseid, taskid);
	if (parts[0] !== '$input' && parts[0] !== '$archive') return publicFile(course, task.id, path);
	if (!username || (parts[0] === '$archive' && !staff)) error(403, t('You are not allowed to access this page.'));
	const sub = await findSubmission(parts[1], { courseid: course.id, taskid: task.id, ...(!staff && { username }) });
	if (!sub) error(404, t('Submission not found.'));
	const { db } = services();
	if (parts[0] === '$archive') {
		if (!sub.archive) error(404, t('Submission not found.'));
		return fileResponse(await db.getFile(sub.archive), `${sub._id}.tgz`, true);
	}
	const value = (await db.getInput(sub.input))[parts[2]];
	if (!task.problems.some((p) => p.id === parts[2]) || value === undefined) error(404, t('Submission not found.'));
	if (value && typeof value === 'object' && 'filename' in value) {
		const file = value as { filename: string; value: Uint8Array };
		return fileResponse(file.value, file.filename, !file.filename.endsWith('.pdf'));
	}
	return new Response(Array.isArray(value) ? value.join('\n') : String(value), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' }
	});
}

/** Serves a file of the public folder of a task (or of `$common`). */
function publicFile(course: Course, taskid: string, path: string): Response {
	let file: string;
	try {
		file = safeJoin(coursePath(course.id, taskid, 'public'), path);
		if (!statSync(file).isFile()) throw new Error('not a file');
	} catch {
		error(404, t('File not found.'));
	}
	return fileResponse(readFileSync(file), path, false);
}
