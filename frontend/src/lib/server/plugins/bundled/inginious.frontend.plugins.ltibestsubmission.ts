/**
 * Port of the legacy "ltibestsubmission" plugin (SITE-20, LTI-14): `GET /lti/bestsubmission`
 * and `GET /lti1.3/bestsubmission` (routes/[lti=lti]/bestsubmission, `?session_id=` of an LTI
 * session) return as JSON the evaluated ("best") submission of the LTI user for the task of
 * the launch, a question/answer summary and the source of the task context:
 * `{status: "success", submission, question_answer: [{question, answer, success, type}], task_context}`,
 * `{status: "success", submission: null}` without evaluated submission, or
 * `{status: "error", message: "user not bound with lti"}` when the LMS user is not bound
 * (the session is not logged in). Non-LTI sessions get 404, other methods 405.
 *
 * Differences with legacy (broken since db_version 19): the user is the account bound to the
 * session (current flat `ltibindings` format, each LTI version with its own key — legacy
 * used the 1.1 key on `/lti1.3/`); the input is read from GridFS; multiple-answer MCQs and
 * missing user tasks no longer crash; the answer is served as `application/json` (legacy:
 * text/html). The LTI 1.3 deployment secret is checked like on every LTI page and only
 * whitelisted submission fields are returned (no stdout/stderr/custom/IP, no file contents).
 */
import { error, type RequestEvent } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { services } from '../../app.js';
import { getTask } from '../../courses/task.js';
import { requireLtiTask } from '../../lti/pages.js';
import { publicInput } from '../../submissions/feedback.js';
import { findSubmission } from '../../submissions/manager.js';
import { requirePlugin } from '../index.js';

/** Legacy module name of the plugin. */
export const MODULE = 'inginious.frontend.plugins.ltibestsubmission';

/** Nothing to register: the route checks that the plugin is enabled. */
export function init(): void {}

/** Legacy summary type of each summarized problem type (other problems are skipped). */
const TYPES: Record<string, string> = {
	multiple_choice: 'mcq',
	match: 'match',
	code: 'code',
	code_single_line: 'code'
};

/** GET handler of `/lti[1.3]/bestsubmission` (see the file header). */
export async function bestSubmission(event: RequestEvent): Promise<Response> {
	requirePlugin(MODULE);
	if (!event.locals.session.doc.lti) error(404, t('Not found'));
	const username = event.locals.user?.username;
	if (!username) return Response.json({ status: 'error', message: 'user not bound with lti' });
	const { course, taskid } = await requireLtiTask(event);
	const key = { courseid: course.id, taskid };
	const userTask = await services().db.c.userTasks.findOne({ ...key, username });
	const sub = await findSubmission(userTask?.submissionid?.toString(), key);
	if (!sub) return Response.json({ status: 'success', submission: null });
	const task = getTask(course, taskid);
	const tr = (text: unknown) => task.tr(event.locals.lang, String(text ?? ''));
	const input = await publicInput(sub);
	const questionAnswer = task.problems
		.filter((p) => p.type in TYPES)
		.map(({ id, type, content }) => {
			let answer = input[id];
			let success = sub.result === 'success';
			if (type === 'multiple_choice') {
				// Chosen choice(s): translated texts; succeeded when exactly the valid ones are chosen.
				const all = content.choices as { text: unknown; valid?: boolean }[];
				const chosen = [answer].flat().map((i) => all[Number(i)] ?? { text: '' });
				answer = content.multiple ? chosen.map((c) => tr(c.text)) : tr(chosen[0].text);
				const expected = content.multiple ? all.filter((c) => c.valid).length : 1;
				success = chosen.length === expected && chosen.every((c) => c.valid);
			}
			return { question: tr(content.header), answer, success, type: TYPES[type] };
		});
	const { _id, courseid, status, result, grade, submitted_on } = sub;
	return Response.json({
		status: 'success',
		submission: { _id: String(_id), courseid, taskid, status, result, grade, submitted_on, input },
		question_answer: questionAnswer,
		task_context: tr(task.context)
	});
}
