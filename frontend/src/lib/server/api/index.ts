/**
 * REST API v0 (SITE-06..11), served by the catch-all route `/api/v0/[...path]`.
 * Same URLs, cookie session and JSON shapes as the legacy `pages/api/*`, with
 * these documented behaviours:
 *  - SITE-06: real 405 (+ `Allow`) for unsupported methods; the output format
 *    is negotiated on `Accept` (then the legacy request `Content-Type`): YAML
 *    for yaml types, JSON (`application/json`) otherwise (the legacy
 *    `<pre>`-wrapped HTML output is dropped). POST bodies
 *    may be form data or JSON; form posts must come from the same origin
 *    (SvelteKit CSRF check: scripts send JSON or an `Origin` header).
 *  - SITE-07: the session id is rotated at login, failures are rate limited.
 *  - SITE-08/09: only the tasks visible to the user are listed and the problem fields revealing answers are removed.
 *  - SITE-10: another user's submission gives 404 (legacy 500); `?input` file
 *    answers are base64-encoded (legacy 500).
 *  - SITE-11: a pending submission gives 409 with the legacy message (legacy 500).
 */
import type { RequestEvent } from '@sveltejs/kit';
import { stringify } from 'yaml';
import { services } from '../app.js';
import { authenticate, connectUser } from '../auth/accounts.js';
import {
	courseIsOpenToUser,
	isRegistrationPossible,
	taskCanUserSubmit,
	taskIsVisibleByUser
} from '../courses/access.js';
import { courseTaskIds, findCourse, listCourses, type Course } from '../courses/course.js';
import { courseCaches, isCourseAdmin, isCourseStaff, userSawTask, userTaskStatus } from '../courses/members.js';
import { buildInput } from '../courses/problems.js';
import { findTask, type Task } from '../courses/task.js';
import { pyIsoformat } from '../db/index.js';
import { renderFeedback } from '../submissions/feedback.js';
import { addSubmission, findSubmission, SubmissionError, type Submission } from '../submissions/manager.js';
import { clientAddress } from '../auth/rate-limit.js';

/** An API error: HTTP status and body (legacy `APIError`). */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly body: unknown
	) {
		super(String(status));
	}
}

/** Context of an API call: the request and the groups of the matched path pattern. */
type Call = { event: RequestEvent; params: (string | undefined)[] };

const fail = (status: number, error: string) => new ApiError(status, { error });
const NO_METHOD = 'This endpoint has no such method';

/** Legacy `_api_convert_output`: YAML when asked for (Accept, then Content-Type), JSON otherwise. */
export function apiResponse(
	request: Request,
	value: unknown,
	status = 200,
	headers: Record<string, string> = {}
): Response {
	const yaml = /(text|application)\/(x-)?yaml/.test(
		`${request.headers.get('accept')} ${request.headers.get('content-type')}`
	);
	return new Response(yaml ? stringify(value) : JSON.stringify(value), {
		status,
		headers: { 'Content-Type': `${yaml ? 'text/yaml' : 'application/json'}; charset=utf-8`, ...headers }
	});
}

/** The logged-in username, or 403 "You are not authenticated". */
function username(c: Call): string {
	// LTI sessions never authenticate API calls.
	if (!c.event.locals.user || c.event.locals.session.doc.is_lti) throw fail(403, 'You are not authenticated');
	return c.event.locals.user.username;
}

/** Posted fields: form data, or a JSON object converted to form data (also used by simple_grader). */
export async function body(request: Request): Promise<FormData> {
	if (!request.headers.get('content-type')?.includes('json')) return request.formData().catch(() => new FormData());
	const form = new FormData();
	for (const [k, v] of Object.entries((await request.json().catch(() => null)) ?? {}))
		for (const item of [v].flat()) form.append(k, String(item));
	return form;
}

/** SITE-07: login with an INGInious account (the session id is rotated by `connectUser`). */
async function login({ event }: Call) {
	const f = await body(event.request);
	const [login, password] = [f.get('login'), f.get('password')];
	if (typeof login !== 'string' || typeof password !== 'string') throw fail(400, 'Invalid arguments for this method');
	const user = await authenticate(login, password, clientAddress(event));
	if (!user) throw new ApiError(403, { status: 'error' });
	await connectUser(event.locals.session, user);
	return { status: 'success', username: user.username };
}

/** Loads the course of the URL (404 "Course not found"). */
function loadCourse(id: string): Course {
	const course = findCourse(id);
	if (!course) throw fail(404, 'Course not found');
	return course;
}

/** Loads a course the user may access (403 when it is not open to him). */
async function openCourse(c: Call): Promise<{ course: Course; user: string }> {
	const [user, course] = [username(c), loadCourse(c.params[0]!)];
	if ((await courseIsOpenToUser(course, user, false)) !== true)
		throw fail(403, 'You are not registered to this course');
	return { course, user };
}

/** Tasks visible by a user, or only the requested one (404 when unknown, unreadable or hidden). */
async function visibleTasks(course: Course, user: string, taskid?: string): Promise<Task[]> {
	const out: Task[] = [];
	for (const id of taskid ? [taskid] : courseTaskIds(course)) {
		const task = findTask(course, id);
		if (task && (await taskIsVisibleByUser(course, id, user, false))) out.push(task);
	}
	if (taskid && !out.length) throw fail(404, 'Task not found');
	return out;
}

/** SITE-08: courses the user is registered to (with visible tasks and grade) or may register to. */
async function courses(c: Call) {
	const [user, lang] = [username(c), c.event.locals.lang];
	const doc = await services().db.c.users.findOne({ username: user });
	const out = [];
	for (const course of c.params[0] ? [loadCourse(c.params[0])] : listCourses().values()) {
		const registered = (await courseIsOpenToUser(course, user, false)) === true;
		if (!registered && !isRegistrationPossible(course, doc)) continue;
		const item: Record<string, unknown> = {
			id: course.id,
			name: course.tr(lang, course.name),
			require_password: course.registrationPassword !== null,
			is_registered: registered
		};
		if (registered) {
			item.tasks = Object.fromEntries(
				(await visibleTasks(course, user)).map((task) => [task.id, task.tr(lang, task.name)])
			);
			item.grade = (await courseCaches(course, [user]))[user].grade;
		}
		out.push(item);
	}
	return out;
}

/** Problem definition without the fields revealing the answers (SITE-09). */
function publicProblem(task: Task, lang: string, id: string, content: Record<string, unknown>) {
	const secret = ['answer', 'success_message', 'error_message'];
	const rest = Object.fromEntries(Object.entries(content).filter(([k]) => !secret.includes(k)));
	// Valid multiple choice problems always have a list of choices with a text (see courses/problems).
	if (rest.type === 'multiple_choice')
		rest.choices = Object.fromEntries(
			(rest.choices as { text: string }[]).map((ch, i) => [i, task.tr(lang, String(ch.text))])
		);
	return { ...rest, id };
}

/** SITE-09: statement and status of the visible tasks. */
async function tasks(c: Call) {
	const { course, user } = await openCourse(c);
	const lang = c.event.locals.lang;
	const caches = await services().db.c.userTasks.find({ courseid: course.id, username: user }).toArray();
	return (await visibleTasks(course, user, c.params[1])).map((task) => {
		const cache = caches.find((d) => d.taskid === task.id);
		const problems = task.problems.map((p) => publicProblem(task, lang, p.id, p.content));
		return {
			id: task.id,
			name: task.tr(lang, task.name),
			authors: task.tr(lang, task.author),
			contact_url: task.contactUrl,
			status: userTaskStatus(cache),
			grade: cache?.grade ?? 0,
			context: task.tr(lang, task.context),
			problems
		};
	});
}

/** JSON of a submission (legacy `_get_submissions`, `submitted_on` in Python isoformat). */
async function submissionJson(sub: Submission, task: Task, staff: boolean, withInput: boolean) {
	const out: Record<string, unknown> = {
		id: String(sub._id),
		submitted_on: pyIsoformat(sub.submitted_on),
		status: sub.status
	};
	if (sub.status === 'done') {
		const feedback = renderFeedback(sub, staff);
		Object.assign(out, {
			grade: sub.grade,
			result: sub.result,
			feedback: feedback.text,
			problems_feedback: feedback.problems
		});
	}
	if (withInput) {
		out.input = await services().db.getInput(sub.input);
		for (const [k, v] of Object.entries(out.input as object))
			if (v?.value instanceof Uint8Array)
				(out.input as Record<string, unknown>)[k] = { ...v, value: Buffer.from(v.value).toString('base64') };
	}
	return out;
}

/** SITE-10: own submissions of a task (newest first), or one of them. */
async function submissions(c: Call) {
	const { course, user } = await openCourse(c);
	const [task] = await visibleTasks(course, user, c.params[1]);
	const filter = { courseid: course.id, taskid: task.id, username: user };
	const subs = c.params[2]
		? [await findSubmission(c.params[2], filter)]
		: await services().db.c.submissions.find(filter).sort({ submitted_on: -1 }).toArray();
	if (!subs[0] && c.params[2]) throw fail(404, 'Submission not found');
	return Promise.all(
		subs.map((s) =>
			submissionJson(s as Submission, task, isCourseStaff(course, user), c.event.url.searchParams.has('input'))
		)
	);
}

/** SITE-11: creates a submission (the task must be visible and open to the user). */
async function submit(c: Call) {
	if (c.params[2]) throw new ApiError(405, { error: NO_METHOD });
	const { course, user } = await openCourse(c);
	const [task] = await visibleTasks(course, user, c.params[1]);
	await userSawTask(user, course.id, task.id);
	if (!(await taskCanUserSubmit(course, task.id, user, { lti: false })))
		throw fail(403, 'You are not allowed to submit for this task');
	const input = await buildInput(task.problems, await body(c.event.request), services().config);
	if (!input) throw fail(400, 'Invalid arguments for this method');
	const created = await addSubmission({
		course,
		task,
		input,
		user,
		userIp: c.event.getClientAddress(),
		debug: isCourseAdmin(course, user)
	}).catch((e) => {
		throw e instanceof SubmissionError ? new ApiError(409, e.message) : e;
	});
	return { submissionid: String(created.id) };
}

const AUTH_METHODS = [
	{
		id: 0,
		name: 'INGInious account',
		input: [
			{ id: 'login', name: 'Login', type: 'text' },
			{ id: 'password', name: 'Password', type: 'password' }
		]
	}
];

/** Path patterns (relative to /api/v0/) and their handlers. */
const ROUTES: [RegExp, Record<string, (c: Call) => unknown>][] = [
	[/^auth_methods$/, { GET: () => AUTH_METHODS }],
	[
		/^authentication$/,
		{
			GET: ({ event: { locals: l } }) =>
				l.user ? { authenticated: true, username: l.user.username } : { authenticated: false },
			POST: login
		}
	],
	[/^courses(?:\/([^/]+))?$/, { GET: courses }],
	[/^courses\/([^/]+)\/tasks(?:\/([^/]+))?$/, { GET: tasks }],
	[/^courses\/([^/]+)\/tasks\/([^/]+)\/submissions(?:\/([^/]+))?$/, { GET: submissions, POST: submit }]
];

/** Dispatches an API request; every answer (errors included) uses the negotiated format. */
export async function handleApi(event: RequestEvent, path: string): Promise<Response> {
	const route = ROUTES.find(([re]) => re.test(path));
	if (!route) return apiResponse(event.request, { error: 'Not found' }, 404);
	const handler = route[1][event.request.method === 'HEAD' ? 'GET' : event.request.method];
	try {
		if (!handler) throw new ApiError(405, { error: NO_METHOD });
		return apiResponse(event.request, await handler({ event, params: route[0].exec(path)!.slice(1) }));
	} catch (e) {
		if (!(e instanceof ApiError)) throw e;
		return apiResponse(
			event.request,
			e.body,
			e.status,
			e.status === 405 ? { Allow: Object.keys(route[1]).join(', ') } : {}
		);
	}
}
