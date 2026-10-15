/**
 * LTI grade passback (LTI-07 LIS Basic Outcomes for 1.1, LTI-12 AGS scores for 1.3).
 *
 * Same persistent queues and document shapes as legacy (`lis_outcome_queue`,
 * `lti_grade_queue`, one document per user and LMS identity, `nb_attempt` reset
 * on re-queue) and the same policy: the evaluated user-task grade is sent, at most
 * 6 attempts ~0.5 s apart, then the entry is dropped. Differences: MongoDB is the
 * queue (pending entries are processed after a restart as soon as the module is
 * loaded), a failure while reading a grade is just a failed attempt (legacy killed
 * its publisher thread), entries that can never succeed (launch without the AGS
 * `score` scope or line item) are dropped at once, grades are clipped and every
 * HTTP call has a timeout.
 *
 * Group submissions (TASK-16) keep the legacy behaviour: the submission only carries
 * the submitter's LMS identifiers (LIS sourcedid / 1.3 launch), so every member is
 * queued with them and each entry sends THAT member's user-task grade to the
 * submitter's LMS result. The other members' LMS grades are only updated by their
 * own LTI submissions; members sharing the evaluated submission send the same grade.
 */
import { randomUUID } from 'node:crypto';
import type { Collection } from 'mongodb';
import { escapeHtml } from '#lib/utils/escape.js';
import { services } from '../app.js';
import { getCourse } from '../courses/course.js';
import type { LisOutcomeDoc, LtiGradeDoc } from '../db/types.js';
import type { DoneEvent } from '../submissions/manager.js';
import { launchClient, signTool } from './lti13.js';
import { authorizationHeader } from './oauth1.js';

/** Attempts per entry and delay between two passes over the queues (ms). */
export const MAX_ATTEMPTS = 6;
const RETRY_DELAY = 500;
/** Timeout of every outbound request (ms). */
const TIMEOUT = 10_000;
const SCORE_SCOPE = 'https://purl.imsglobal.org/spec/lti-ags/scope/score';
const AGS_CLAIM = 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint';

/** A queue entry. */
type Entry = LisOutcomeDoc | LtiGradeDoc;
/** Sends a grade (0-100): true = sent, false = retry later, null = can never succeed. */
type Sender<D> = (doc: D, grade: number) => Promise<boolean | null>;

const clip = (x: number, max: number) => Math.min(max, Math.max(0, x));
/** Python `str(float)` of a number ("1.0", "0.75"). */
const pyFloat = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** LTI-07: LIS `replaceResult` request signed with the consumer secret; success iff `imsx_codeMajor` is "success". */
const sendLis: Sender<LisOutcomeDoc> = async (d, grade) => {
	const secret = getCourse(d.courseid).ltiKeys[d.outcome_consumer_key];
	if (secret === undefined) return false;
	const body = `<?xml version='1.0' encoding='utf-8'?>\n<imsx_POXEnvelopeRequest xmlns="http://www.imsglobal.org/services/ltiv1p1/xsd/imsoms_v1p0"><imsx_POXHeader><imsx_POXRequestHeaderInfo><imsx_version>V1.0</imsx_version><imsx_messageIdentifier/></imsx_POXRequestHeaderInfo></imsx_POXHeader><imsx_POXBody><replaceResultRequest><resultRecord><sourcedGUID><sourcedId>${escapeHtml(d.outcome_result_id)}</sourcedId></sourcedGUID><result><resultScore><language>en</language><textString>${pyFloat(clip(grade / 100, 1))}</textString></resultScore></result></resultRecord></replaceResultRequest></imsx_POXBody></imsx_POXEnvelopeRequest>`;
	const headers = {
		'Content-Type': 'application/xml',
		Authorization: authorizationHeader(d.outcome_service_url, d.outcome_consumer_key, secret, body)
	};
	const res = await fetch(d.outcome_service_url, {
		method: 'POST',
		headers,
		body,
		signal: AbortSignal.timeout(TIMEOUT)
	});
	return /<(\w+:)?imsx_codeMajor>\s*success\s*</.test(await res.text());
};

/** LTI-12: OAuth2 client-credentials token (signed client assertion) then score POST to `<lineitem>/scores`. */
export const sendAgs: Sender<LtiGradeDoc> = async (d, grade) => {
	const claims = (await services().db.c.ltiLaunch.findOne({ key: d.message_launch_id }))?.value as
		Record<string, unknown> | undefined;
	const ags = claims?.[AGS_CLAIM] as { scope?: string[]; lineitem?: string } | undefined;
	if (!ags?.lineitem || !ags.scope?.includes(SCORE_SCOPE)) return null;
	const client = launchClient(getCourse(d.courseid), claims!);
	if (!client) return false;
	const now = Math.floor(Date.now() / 1000);
	const assertion = await signTool(client, {
		iss: client.client_id,
		sub: client.client_id,
		aud: client.auth_audience || client.auth_token_url,
		iat: now - 5,
		exp: now + 60,
		jti: `lti-service-token-${randomUUID()}`
	});
	const form = {
		grant_type: 'client_credentials',
		client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
		client_assertion: assertion,
		scope: ags.scope.join(' ')
	};
	const tokenRes = await fetch(client.auth_token_url, {
		method: 'POST',
		body: new URLSearchParams(form),
		signal: AbortSignal.timeout(TIMEOUT)
	});
	if (!tokenRes.ok) return false;
	const { access_token: token } = (await tokenRes.json()) as { access_token: string };
	const url = new URL(ags.lineitem);
	url.pathname += '/scores';
	const score = {
		scoreGiven: clip(grade, 100),
		scoreMaximum: 100,
		activityProgress: 'Completed',
		gradingProgress: 'FullyGraded',
		timestamp: new Date().toISOString(),
		userId: claims!.sub
	};
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: 'application/json',
		'Content-Type': 'application/vnd.ims.lis.v1.score+json'
	};
	return (
		await fetch(url, { method: 'POST', headers, body: JSON.stringify(score), signal: AbortSignal.timeout(TIMEOUT) })
	).ok;
};

/** One attempt for an entry: deleted when sent, dropped or out of attempts, else counted. @returns true when retried later. */
async function attempt(coll: Collection<Entry>, doc: Entry, send: Sender<Entry>): Promise<boolean> {
	let sent: boolean | null = false;
	try {
		const userTask = await services().db.c.userTasks.findOne({
			username: doc.username,
			courseid: doc.courseid,
			taskid: doc.taskid
		});
		sent = userTask ? await send(doc, userTask.grade) : false;
	} catch (e) {
		console.error('An error occurred while sending a grade to the LMS:', e);
	}
	if (sent !== false || doc.nb_attempt + 1 >= MAX_ATTEMPTS) {
		if (!sent)
			console.error(`Grade of ${doc.username} for ${doc.courseid}/${doc.taskid} not sent to the LMS: giving up.`);
		await coll.deleteOne({ _id: doc._id });
		return false;
	}
	await coll.updateOne({ _id: doc._id }, { $inc: { nb_attempt: 1 } });
	return true;
}

let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Processes every pending entry (one pass at a time; a failed entry schedules a new pass).
 * Never rejects (database errors are logged): callers run it in the background.
 */
export function drain(): Promise<void> {
	if (running) return ((again = true), running);
	running = (async () => {
		do {
			again = false;
			const { c } = services().db;
			for (const [coll, send] of [
				[c.lisOutcomes, sendLis],
				[c.ltiGrades, sendAgs]
			] as [Collection<Entry>, Sender<Entry>][])
				for (const doc of await coll.find().toArray())
					if ((await attempt(coll, doc, send)) && !timer)
						timer = setTimeout(() => ((timer = null), void drain()), RETRY_DELAY);
		} while (again);
	})()
		.catch((e) => console.error(`LTI grade passback: ${e}`))
		.finally(() => (running = null));
	return running;
}

/**
 * Submission listener (LTI-07/12): queues every member of a completed submission
 * tagged with `lti_version` (see the LTI task page), then processes the queues.
 */
export async function enqueue({ submission: s }: DoneEvent): Promise<void> {
	if (!s.lti_version) return;
	const { c } = services().db;
	for (const username of s.username) {
		const key = { username, courseid: s.courseid, taskid: s.taskid };
		if (s.lti_version === '1.3' && s.message_launch_id)
			await c.ltiGrades.updateOne(
				{ ...key, message_launch_id: s.message_launch_id },
				{ $set: { nb_attempt: 0 } },
				{ upsert: true }
			);
		else if (s.outcome_service_url && s.outcome_result_id && s.outcome_consumer_key)
			await c.lisOutcomes.updateOne(
				{
					...key,
					outcome_service_url: s.outcome_service_url,
					outcome_result_id: s.outcome_result_id,
					outcome_consumer_key: s.outcome_consumer_key
				},
				{ $set: { nb_attempt: 0 } },
				{ upsert: true }
			);
	}
	void drain();
}
