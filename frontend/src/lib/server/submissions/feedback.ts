/**
 * Display of submissions for a viewer (TASK-09/10/19/20/21): rendering of the
 * grader feedback (stored raw, rendered at read time with the task's text
 * format and sanitized), result titles, waiting texts, tag filtering and the
 * JSON sent to the task page, the API and the admin pages.
 *
 * Differences with legacy `submission_to_json`: titles are plain text (the
 * submission id/date are separate fields), grades are numbers, there is no
 * `feedback_script` field (server strings are never executed) and the debug dump
 * is only built for course admins.
 */
import { t } from '#lib/i18n/index.js';
import { roundGrade } from '#lib/utils/grade.js';
import { services } from '../app.js';
import type { Course } from '../courses/course.js';
import { plugins } from '../plugins/index.js';
import { renderText, type SafeHtml } from '../text/index.js';
import { sanitize } from '../text/sanitize.js';
import type { SubmissionJson, SubmissionSummary } from '#lib/components/task/types.js';
import type { Submission } from './manager.js';

export type { SubmissionJson, SubmissionSummary };

/** Rendered feedback of a submission. */
export interface Feedback {
	/** Global feedback (`submissions.text`). */
	text: SafeHtml;
	/** Problem id -> [result, feedback]. */
	problems: Record<string, [string, SafeHtml]>;
}

/** What the viewer may see. */
export interface Viewer {
	/** Course staff: hidden-until blocks are revealed. */
	staff: boolean;
	/** Course admin: hidden tags, auto-tags and the debug dump. */
	admin: boolean;
}

/**
 * Renders the feedback (legacy `get_feedback_from_submission`): old-style string
 * problem feedback takes the submission result, malformed entries become a
 * crash "Feedback is badly formatted.".
 */
export function renderFeedback(sub: Submission, showEverything: boolean): Feedback {
	// The markup language of each message is read from its own `#MD` marker.
	const render = (text: unknown) => renderText(text, { showEverything });
	const problems: Feedback['problems'] = {};
	for (const [pid, value] of Object.entries(sub.problems ?? {})) {
		if (typeof value === 'string') problems[pid] = [sub.result ?? 'crash', render(value)];
		else if (Array.isArray(value) && value.length === 2) problems[pid] = [String(value[0]), render(value[1])];
		else problems[pid] = ['crash', render(t('Feedback is badly formatted.'))];
	}
	return { text: render(sub.text), problems };
}

/** Translated title of a result (legacy titles, without the HTML suffix). */
export function resultTitle(result: string, grade: number): string {
	const titles: Record<string, string> = {
		failed: 'There are some errors in your answer. Your score is {score}%.',
		success: 'Your answer passed the tests! Your score is {score}%.',
		timeout: 'Your submission timed out. Your score is {score}%.',
		overflow: 'Your submission made an overflow. Your score is {score}%.',
		killed: 'Your submission was killed.'
	};
	return t(
		titles[result] ??
			'An internal error occurred. Please retry later. If the error persists, send an email to the course administrator.',
		{ score: roundGrade(grade) }
	);
}

/** TASK-09: message of a waiting submission from the backend queue position. */
export function waitingText(jobid: string | undefined): SafeHtml {
	const info = jobid ? services().backend.jobQueueInfo(jobid) : undefined;
	let html = t('<b>Your submission has been sent...</b>');
	if (info) {
		const [before, wait] = info;
		if (before === -1)
			html =
				wait <= 0
					? t('<b>INGInious is currently grading your answers.</b> (almost done)')
					: t('<b>INGInious is currently grading your answers.</b> (Approx. wait time: {} seconds)', Math.round(wait));
		else if (before === 0) html = t('<b>You are next in the waiting queue!</b>');
		else if (before === 1) html = t('<b>There is one task in front of you in the waiting queue.</b>');
		else html = t('<b>There are {} tasks in front of you in the waiting queue.</b>', before);
	}
	return sanitize(html);
}

/**
 * TASK-20: tags of the result the viewer may see: course skills/misconceptions
 * that are visible (all for admins) and, for admins, the auto-tags.
 */
export function visibleTests(
	tests: Record<string, unknown> | undefined,
	course: Course,
	admin: boolean
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(tests ?? {}).filter(([id]) => {
			const tag = course.tags[id];
			return tag ? tag.type < 2 && (tag.visible || admin) : admin && id.startsWith('*auto-tag-');
		})
	);
}

/**
 * Result displayed for a submission: "waiting" while it is graded (the stored
 * `result` of a waiting submission is the mongoengine default "crash"), else its result.
 */
export function displayResult(sub: Pick<Submission, 'status' | 'result'>): string {
	return sub.status === 'waiting' ? 'waiting' : (sub.result ?? 'crash');
}

/** History entry of a submission (TASK-10). */
export function summarize(sub: Submission, course: Course, admin: boolean): SubmissionSummary {
	const tests = visibleTests(sub.tests, course, admin);
	return {
		id: String(sub._id),
		status: sub.status,
		result: displayResult(sub),
		grade: sub.grade ?? 0,
		submittedOn: sub.submitted_on.toISOString(),
		tags: Object.keys(tests)
			.filter((id) => tests[id] && course.tags[id])
			.map((id) => course.tags[id].name)
	};
}

/** TASK-21: JSON copy of a document with strings longer than 1000 characters truncated. */
export function debugDump(doc: unknown): unknown {
	return JSON.parse(
		JSON.stringify(doc, (_key, v) => (typeof v === 'string' && v.length > 1000 ? `${v.slice(0, 1000)} <truncated>` : v))
	);
}

/** Input of a submission for the browser: file contents are removed (TASK-04/10). */
export async function publicInput(sub: Submission): Promise<Record<string, unknown>> {
	const input = await services().db.getInput(sub.input);
	for (const [key, value] of Object.entries(input))
		if (value && typeof value === 'object' && 'filename' in value) input[key] = { filename: value.filename, value: '' };
	return input;
}

/**
 * Builds the JSON of a submission for a viewer (legacy `submission_to_json`).
 * @param opts.replace evaluated submission of
 *        the viewer; `reloading`: include the input.
 */
export async function submissionToJson(
	sub: Submission,
	course: Course,
	viewer: Viewer,
	opts: { replace: boolean; reloading?: boolean }
): Promise<SubmissionJson> {
	const waiting = sub.status === 'waiting';
	const feedback = waiting ? { text: waitingText(sub.jobid), problems: {} } : renderFeedback(sub, viewer.staff);
	const grade = sub.grade ?? 0;
	const result = displayResult(sub);
	let title = waiting ? '' : resultTitle(result, grade);
	if (!waiting) title = (await plugins().callHookRecursive('feedback_title', { submission: sub, title })).title;
	const tests = visibleTests(sub.tests, course, viewer.admin);
	const json: SubmissionJson = {
		id: String(sub._id),
		status: sub.status,
		result,
		grade,
		submittedOn: sub.submitted_on.toISOString(),
		title,
		...feedback,
		tests,
		replace: opts.replace
	};
	if (waiting && sub.ssh_host) {
		json.text = sanitize(t('<b>SSH server active</b>'));
		json.ssh = { host: sub.ssh_host, port: sub.ssh_port!, user: sub.ssh_user!, password: sub.ssh_password! };
	}
	if (viewer.admin) json.debug = debugDump(sub);
	if (opts.reloading) json.input = await publicInput(sub);
	return json;
}
