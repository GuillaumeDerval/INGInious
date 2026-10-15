/**
 * LTI 1.1 basic launch `POST /lti/<courseid>/<taskid>` (LTI-02, docs/reference/lti.md §1).
 *
 * Validation rules (LTI-02):
 *  - replays are refused: the nonce is recorded AFTER a valid signature in the
 *    legacy `nonce` collection, protected by a unique index (created here when
 *    absent) and purged by its TTL index on `expiration`;
 *  - timestamp window ±600 s, HMAC only, constant-time comparison (oauth1.ts);
 *  - the signature covers the received parameters as they are (no injected
 *    defaults, no re-serialised role lists); unknown parameters are accepted
 *    (they are signed);
 *  - the URL of the base string honours the reverse proxy configuration.
 */
import { error, type RequestEvent } from '@sveltejs/kit';
import { MongoServerError } from 'mongodb';
import { t } from '#lib/i18n/index.js';
import { services } from '../app.js';
import { requireCourse } from '../courses/access.js';
import { externalUrl, realname, startLtiSession } from './common.js';
import { TIMESTAMP_WINDOW, verify } from './oauth1.js';

let nonceIndex: Promise<unknown> | null = null;

/**
 * Unique index on (nonce, timestamp), so that each nonce is accepted once. The legacy
 * model declares a `(timestamp, nonce)` index; a different key order avoids clashing with it.
 * When old duplicates prevent the creation, the (short-lived) nonces are dropped first.
 */
function ensureNonceIndex(): Promise<unknown> {
	const c = services().db.c.nonce;
	const create = () => c.createIndex({ nonce: 1, timestamp: 1 }, { unique: true });
	nonceIndex ??= create().catch(async () => (await c.deleteMany({}), create()));
	return nonceIndex;
}

/** Records a nonce; false when it was already used (replay). */
export async function useNonce(nonce: string, timestamp: number): Promise<boolean> {
	await ensureNonceIndex();
	const date = new Date(timestamp * 1000);
	const doc = { timestamp: date, nonce, expiration: new Date(date.getTime() + TIMESTAMP_WINDOW * 1000) };
	// A duplicate key error (11000) means a replay; other errors propagate.
	return services()
		.db.c.nonce.insertOne(doc)
		.then(
			() => true,
			(e) => (e instanceof MongoServerError && e.code === 11000 ? false : Promise.reject(e))
		);
}

/** Validates the launch, creates the LTI session and redirects to the LTI login step. */
export async function launch11(event: RequestEvent, courseid: string, taskid: string): Promise<never> {
	const course = requireCourse(courseid);
	const params = [...(await event.request.formData())].map(([k, v]) => [k, String(v)] as [string, string]);
	const checked = verify(params, externalUrl(event), course.ltiKeys);
	if (!checked || !(await useNonce(checked.nonce, checked.timestamp))) error(403, t("Couldn't validate LTI request"));
	// Like Werkzeug's MultiDict -> dict: the first value of a repeated field wins.
	const p = Object.fromEntries(params.toReversed());
	if (!p.user_id) error(400, t('Missing parameter user_id.'));
	const outcome = course.ltiSendBackGrade;
	if (outcome && !(p.lis_outcome_service_url && p.lis_result_sourcedid))
		error(
			403,
			t(
				'In order to send grade back to the TC, INGInious needs the parameters lis_outcome_service_url and lis_outcome_result_id in the LTI basic-launch-request. Please contact your administrator.'
			)
		);
	const na = (k: string) => p[k] || 'N/A';
	const email = p.lis_person_contact_email_primary ?? '';
	startLtiSession(
		event,
		{
			version: '1.1',
			email,
			username: p.user_id,
			realname: realname(p.lis_person_name_full, p.lis_person_name_given, p.lis_person_name_family, email, p.user_id),
			roles: (p.roles || 'Student').split(',').map((r) => r.trim()),
			task: [course.id, taskid],
			consumer_key: checked.key,
			context_title: na('context_title'),
			context_label: na('context_label'),
			tool_description: na('tool_consumer_instance_description'),
			tool_name: na('tool_consumer_instance_name'),
			tool_url: na('tool_consumer_instance_url'),
			...(outcome && { outcome_service_url: p.lis_outcome_service_url, outcome_result_id: p.lis_result_sourcedid })
		},
		'task'
	);
}
