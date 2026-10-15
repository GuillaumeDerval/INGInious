/**
 * Helpers shared by LTI 1.1 and 1.3 (docs/features/lti):
 *  - `externalUrl`: the URL as seen by the LMS (reverse proxies, LTI-02 base string);
 *  - `toolConfig` / `findClient`: LTI 1.3 registrations = course + global `lti_config`,
 *    always merged into NEW objects (fixes the LTI-01/11 config pollution bug), course
 *    registrations shadowing another platform being refused (`registrationConflict`);
 *  - LTI sessions (LTI-03): `startLtiSession`, `requireLti`, `sessionToken`, `ltiUrl`;
 *  - login through account bindings and binding itself (LTI-04), with short-lived
 *    signed bind tokens (never the raw session id).
 *
 * LMS roles are stored in the session but never grant rights (like legacy):
 * staff rights only come from the bound INGInious account.
 */
import { createHmac } from 'node:crypto';
import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { ObjectId } from 'mongodb';
import type { JSONWebKeySet } from 'jose';
import { t } from '#lib/i18n/index.js';
import { services } from '../app.js';
import { connectUser } from '../auth/accounts.js';
import { safeEqual } from '../courses/access.js';
import { listCourses, type Course } from '../courses/course.js';
import type { LtiData } from '../db/types.js';

/** One LTI 1.3 platform registration (docs/reference/lti.md §3). */
export interface Client {
	client_id: string;
	auth_login_url: string;
	auth_token_url: string;
	auth_audience?: string | null;
	default?: boolean;
	/** Platform keys: URL of its JWKS, or the key set itself. */
	key_set_url?: string;
	key_set?: JSONWebKeySet | null;
	deployment_ids: string[];
	private_key: string;
	public_key?: string;
}

/** Issuer -> registrations. */
export type ToolConfig = Record<string, Client[]>;

/** Lifetime of a bind link (seconds). */
const BIND_TTL = 15 * 60;

/**
 * Externally visible URL of a request. `X-Forwarded-Proto`/`X-Forwarded-Host` are
 * only trusted when `reverse-proxy-config.enable` is set (otherwise any client
 * could choose the URL used in signature checks).
 */
export function externalUrl(event: { url: URL; request: Request }): URL {
	const url = new URL(event.url);
	if ((services().config.raw['reverse-proxy-config'] as { enable?: boolean } | undefined)?.enable) {
		const first = (h: string) => event.request.headers.get(h)?.split(',')[0].trim();
		const proto = first('x-forwarded-proto');
		const host = first('x-forwarded-host');
		if (proto) url.protocol = `${proto}:`;
		// The host setter keeps the current port when the new host has none: reset it first.
		if (host) {
			url.port = '';
			url.host = host;
		}
	}
	return url;
}

/** Client entries of one `lti_config` mapping (a single client may be given as a dict). */
const clientsOf = (list: unknown) => ([] as Client[]).concat(list as Client);

/** Platform keys of a registration: whoever controls them can sign id_tokens for it. */
const platformKeyId = (c: Client) => JSON.stringify([c.key_set_url ?? null, c.key_set ?? null]);

/**
 * Bindings are keyed by `iss/client_id/deployment`
 * (legacy `users.ltibindings` format, kept readable), so one `(iss, client_id)` must
 * designate one platform across the whole instance. Returns where else `(iss, client)`
 * is declared with OTHER platform keys (global config or another LTI course), or null.
 * A course admin can therefore not register a known platform with their own key set
 * and sign id_tokens for users bound through it.
 */
export function registrationConflict(courseid: string, iss: string, client: Client): string | null {
	const others: [string, Record<string, unknown>][] = [['configuration.yaml', services().config.ltiConfig]];
	for (const [id, course] of listCourses()) if (id !== courseid) others.push([`course ${id}`, course.ltiConfig]);
	for (const [source, cfg] of others)
		if (
			clientsOf(cfg[iss] ?? []).some(
				(c) => c?.client_id === client.client_id && platformKeyId(c) !== platformKeyId(client)
			)
		)
			return source;
	return null;
}

/**
 * Registrations of a course (LTI courses only) followed by the global ones. Course
 * registrations conflicting with another declaration (`registrationConflict`) are
 * ignored, so a launch of course A never trusts keys that course A chose for a
 * platform declared elsewhere. Always merged into NEW objects.
 */
export function toolConfig(course: Course | null): ToolConfig {
	const out: ToolConfig = {};
	const add = (iss: string, c: Client) => (out[iss] = [...(out[iss] ?? []), c]);
	for (const [iss, list] of Object.entries(course?.ltiConfig ?? {}))
		for (const c of clientsOf(list)) {
			const conflict = registrationConflict(course!.id, iss, c);
			if (conflict) console.error(`LTI: ${course!.id} redeclares ${iss}/${c.client_id} of ${conflict}, ignored`);
			else add(iss, c);
		}
	for (const [iss, list] of Object.entries(services().config.ltiConfig)) for (const c of clientsOf(list)) add(iss, c);
	return out;
}

/** Registration of `iss`: by client id, else the only one, else the `default` one. */
export function findClient(cfg: ToolConfig, iss: string, clientId?: string | null): Client | undefined {
	const list = cfg[iss] ?? [];
	return clientId
		? list.find((c) => c.client_id === clientId)
		: list.length === 1
			? list[0]
			: list.find((c) => c.default);
}

/** Legacy `_find_realname` (with a space between given and family names, legacy forgot it). */
export function realname(full?: string, given?: string, family?: string, email?: string, id = ''): string {
	return full || (given && family ? `${given} ${family}` : '') || email || family || given || id;
}

/** URL of an LTI page of the session's version (`/lti/<page>` or `/lti1.3/<page>`) with its session token. */
export const ltiUrl = (lti: Pick<LtiData, 'version'>, page: string, token: string) =>
	`/lti${lti.version === '1.3' ? '1.3' : ''}/${page}?session_id=${token}`;

/**
 * Replaces the session of the request by a fresh LTI session (LTI-03): never
 * stored in a cookie, reached through the signed `session_id` parameter; then
 * redirects to the login step (LTI-04).
 * @param page LTI page reached after login (`redir_url`).
 */
export function startLtiSession(event: RequestEvent, lti: Omit<LtiData, 'redir_url'>, page: string): never {
	const { sessions } = services();
	const fresh = sessions.create(true);
	fresh.doc.language = event.locals.lang;
	const token = sessions.sign(fresh.doc._id);
	fresh.doc.lti = { ...lti, redir_url: ltiUrl(lti, page, token) };
	// The request pipeline commits `locals.session`: replace its content in place.
	Object.assign(event.locals.session, fresh);
	event.locals.user = null;
	redirect(302, ltiUrl(lti, 'login', token));
}

/** LTI data of the session; 403 "No LTI data available." for non-LTI sessions. */
export function requireLti(event: { locals: App.Locals }): LtiData {
	const { doc } = event.locals.session;
	if (!doc.is_lti || !doc.lti) error(403, t('No LTI data available.'));
	return doc.lti;
}

/** Signed token of the current session (`?session_id=` of every LTI link). */
export function sessionToken(event: { locals: App.Locals }): string {
	return services().sessions.sign(event.locals.session.doc._id);
}

/**
 * Key of `users.ltibindings` (LTI-04): `<courseid>/<consumer key>` or the platform instance id
 * `iss/client_id/deployment`, without `.` and `$` — the legacy format, unchanged. Scoping
 * is ensured upstream: a 1.3 platform instance id is unique to one platform key set
 * (`registrationConflict`), and 1.1 keys already contain the course.
 */
export function bindingField(lti: LtiData): string {
	return (lti.version === '1.3' ? String(lti.platform_instance_id) : `${lti.task[0]}/${lti.consumer_key}`).replace(
		/[.$]/g,
		''
	);
}

/**
 * LTI-04 login step: logs the LTI session in (`connectUser`) when its LMS user is bound
 * to an account (the session id is rotated, so the redirect URL gets the new token).
 * @returns the page to go to, or null when the user still has to bind an account.
 */
export async function ltiLogin(event: { locals: App.Locals }): Promise<string | null> {
	const lti = requireLti(event);
	const { db, sessions } = services();
	const session = event.locals.session;
	if (!session.doc.loggedin) {
		const user = await db.c.users.findOne({ [`ltibindings.${bindingField(lti)}`]: lti.username });
		if (!user) return null;
		await connectUser(session, user);
		lti.redir_url = `${lti.redir_url.split('?')[0]}?session_id=${sessions.sign(session.doc._id)}`;
	}
	return lti.redir_url;
}

/** HMAC of a bind token payload (own context, so it cannot be confused with session tokens). */
const bindMac = (payload: string) =>
	createHmac('sha256', services().config.session.secretKey).update(`lti-bind:${payload}`).digest('base64url');

/** Short-lived token designating an LTI session on the bind page (`lti_session_id`). */
export function bindToken(id: ObjectId, now = Date.now()): string {
	const payload = `${id.toHexString()}.${Math.floor(now / 1000) + BIND_TTL}`;
	return `${payload}.${bindMac(payload)}`;
}

/**
 * LTI data of the session designated by a bind token; 400 "Invalid LTI session id"
 * when the token is forged/expired or the session is gone.
 */
export async function bindTarget(token: string | null, now = Date.now()): Promise<LtiData> {
	const m = /^([0-9a-f]{24})\.(\d+)\.([\w-]{43})$/.exec(token ?? '');
	const valid = m && Number(m[2]) * 1000 > now && safeEqual(bindMac(`${m[1]}.${m[2]}`), m[3]);
	const doc = valid ? await services().db.c.sessions.findOne({ _id: new ObjectId(m[1]), is_lti: true }) : null;
	if (!doc?.lti) error(400, t('Invalid LTI session id'));
	return doc.lti;
}

/**
 * Binds the LMS user of `lti` to `username` (LTI-04). Refused when the LMS user is
 * bound to another account or the account is bound to another LMS user of this
 * context; binding twice the same pair succeeds.
 */
export async function bindAccount(username: string, lti: LtiData): Promise<boolean> {
	const field = `ltibindings.${bindingField(lti)}`;
	const users = services().db.c.users;
	if (await users.findOne({ [field]: lti.username, username: { $ne: username } })) return false;
	const filter = { username, $or: [{ [field]: { $exists: false } }, { [field]: lti.username }] };
	return (await users.updateOne(filter, { $set: { [field]: lti.username } })).matchedCount === 1;
}
