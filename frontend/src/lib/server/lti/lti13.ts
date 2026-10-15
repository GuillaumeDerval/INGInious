/**
 * LTI 1.3 tool (docs/reference/lti.md §3-7): OIDC login initiation (LTI-08),
 * message launch (LTI-09), deep-linking response (LTI-10), JWKS (LTI-11) and the
 * tool-signed JWTs shared with the grade service (LTI-12). Uses `jose`.
 *
 * Validation rules (LTI-08/09/10/11):
 *  - the id_token is fully validated: RS256 signature with the platform keys
 *    (remote key sets cached per URL), `iss`, `aud` = client id, `exp`, deployment;
 *  - the nonce is bound to the `state` (stored as the value of the legacy
 *    `lti1p3-nonce-<nonce>` document) and consumed once; the state must match the
 *    state cookie set on the browser that started the login; no id_token replay
 *    marker is stored, so a captured launch POST cannot be replayed;
 *  - errors are 400/403 pages instead of 500;
 *  - the JWKS only exposes public keys and never mutates any configuration.
 * The course of a launch is the URL one, else the `custom.courseid` claim, whose
 * configuration is trusted only once the signature verified with it.
 */
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import {
	calculateJwkThumbprint,
	createLocalJWKSet,
	createRemoteJWKSet,
	customFetch,
	decodeJwt,
	exportJWK,
	jwtVerify,
	SignJWT,
	type JWTPayload
} from 'jose';
import { t } from '#lib/i18n/index.js';
import { escapeHtml } from '#lib/utils/escape.js';
import { services } from '../app.js';
import { requireCourse } from '../courses/access.js';
import type { Course } from '../courses/course.js';
import type { LtiLaunchDoc } from '../db/types.js';
import { externalUrl, findClient, realname, startLtiSession, toolConfig, type Client } from './common.js';
import { ltiFetch } from './outbound.js';

/** Prefix of the LTI 1.3 core claim names. */
export const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/';
/** Prefix of the LTI Deep Linking claim names. */
export const DL_CLAIM = 'https://purl.imsglobal.org/spec/lti-dl/claim/';
type Claims = JWTPayload & Record<string, unknown>;

/** Cached remote platform key sets (jose refetches them on an unknown `kid`). */
const remoteSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Key set of a platform: inline `key_set` or `key_set_url` (fetched with `ltiFetch`: public https only). */
function platformKeys(c: Client) {
	if (c.key_set) return createLocalJWKSet(c.key_set);
	const url = String(c.key_set_url);
	const remote = () => createRemoteJWKSet(new URL(url), { [customFetch]: ltiFetch });
	return remoteSets.get(url) ?? remoteSets.set(url, remote()).get(url)!;
}

/** Expiry date `seconds` from now of an `lti_launch` entry (TTL index). */
const expiry = (seconds: number) => new Date(Date.now() + seconds * 1000);

/** Request parameters: form on POST, query string otherwise (never both). */
async function params(event: RequestEvent): Promise<Record<string, string>> {
	const entries = event.request.method === 'POST' ? await event.request.formData() : event.url.searchParams;
	return Object.fromEntries([...entries].map(([k, v]) => [k, String(v)]));
}

/** Public JWK of a registration (from `public_key`, else derived from `private_key`) with its RFC 7638 `kid`. */
async function toolJwk(c: Client) {
	const { e, kty, n } = await exportJWK(createPublicKey(c.public_key || c.private_key));
	const kid = await calculateJwkThumbprint({ e: e!, kty, n: n! });
	// Keys in the order of the legacy Flask `jsonify` (sorted).
	return { alg: 'RS256', e, kid, kty, n, use: 'sig' };
}

/** Signs claims with the tool private key (header `{alg: RS256, kid, typ: JWT}`, LTI-10/12). */
export async function signTool(c: Client, claims: Claims): Promise<string> {
	const { kid } = await toolJwk(c);
	return new SignJWT(claims)
		.setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
		.sign(createPrivateKey(c.private_key));
}

/** Registration matching stored launch claims (`aud` = client id) in the configuration of `course`. */
export function launchClient(course: Course | null, claims: Claims): Client | undefined {
	return findClient(toolConfig(course), String(claims.iss), String(claims.azp ?? [claims.aud].flat()[0]));
}

/**
 * Third-party cookies may be blocked in the LMS iframe: this page checks that a
 * cookie can be stored and continues the login, or offers to open it in a new tab
 * (legacy PyLTI1p3 `CookiesAllowedCheckPage`). Its own CSP only allows its inline
 * script (by hash); the request pipeline adds the frame ancestors.
 */
function cookieCheckPage(url: URL, p: Record<string, string>, https: boolean): Response {
	const next = new URL(url.pathname, url);
	for (const [k, v] of Object.entries({ ...p, lti1p3_new_window: '1' })) next.searchParams.set(k, v);
	const href = JSON.stringify(next.pathname + next.search).replace(/</g, '\\u003c');
	const attrs = https ? '; SameSite=None; Secure; Partitioned' : '';
	const link = `<a href="${escapeHtml(next.pathname + next.search)}" target="_blank">${escapeHtml(t('Click here to open content in the new tab.'))}</a>`;
	const script = `document.cookie="lti1p3_test_cookie=1; path=/${attrs}";if(document.cookie.includes("lti1p3_test_cookie"))location.replace(${href});else document.getElementById("m").innerHTML=${JSON.stringify(`${escapeHtml(t('Your browser prohibits to save cookies in the iframes.'))} ${link}`).replace(/</g, '\\u003c')}`;
	const html = `<!doctype html><meta charset="utf-8"><title>INGInious</title><p id="m">${escapeHtml(t('Loading...'))}</p><script>${script}</script>`;
	const hash = createHash('sha256').update(script).digest('base64');
	const csp = `default-src 'none'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'`;
	return new Response(html, {
		headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp }
	});
}

/**
 * LTI-08 `GET|POST /lti1.3/oidc_login[/<courseid>]`: cookie check, then state
 * cookie + nonce and redirect to the platform authorization endpoint.
 */
export async function oidcLogin(event: RequestEvent, courseid?: string): Promise<Response> {
	const course = courseid ? requireCourse(courseid) : null;
	const p = await params(event);
	if (!p.iss || !p.login_hint || !p.target_link_uri) error(400, t('Invalid LTI login request.'));
	const client = findClient(toolConfig(course), p.iss, p.client_id);
	if (!client) error(400, t('Unknown LTI platform.'));
	const https = externalUrl(event).protocol === 'https:';
	if (!p.lti1p3_new_window) return cookieCheckPage(event.url, p, https);
	const state = `state-${randomUUID()}`;
	const nonce = randomBytes(24).toString('hex');
	await services().db.c.ltiLaunch.insertOne({
		key: `lti1p3-nonce-${nonce}`,
		value: state,
		expires: expiry(3600)
	} as LtiLaunchDoc);
	event.cookies.set(`lti1p3-${state}`, state, {
		path: '/',
		httpOnly: true,
		maxAge: 300,
		secure: https,
		sameSite: https ? 'none' : 'lax',
		partitioned: https
	});
	const target = new URL(client.auth_login_url);
	const query = {
		scope: 'openid',
		response_type: 'id_token',
		response_mode: 'form_post',
		prompt: 'none',
		client_id: client.client_id,
		redirect_uri: p.target_link_uri,
		state,
		nonce,
		login_hint: p.login_hint,
		lti_message_hint: p.lti_message_hint
	};
	for (const [k, v] of Object.entries(query)) if (v) target.searchParams.append(k, v);
	redirect(302, target.href, { external: true });
}

/**
 * LTI-09 `GET|POST /lti1.3/launch[/<courseid>[/<taskid>]]` and `/lti1.3/deeplaunch[/<courseid>]`:
 * validates the id_token, stores the launch in `lti_launch` and starts the LTI session.
 */
export async function launch13(event: RequestEvent, courseid?: string, taskid?: string): Promise<never> {
	const { id_token: idToken = '', state = '' } = await params(event);
	const invalid = (what: string): never => error(403, t('Invalid LTI launch ({}).', what));
	if (!state || event.cookies.get(`lti1p3-${state}`) !== state) invalid('state');
	event.cookies.delete(`lti1p3-${state}`, { path: '/' });
	// Any failure of a check is a 403 naming it (legacy: 500).
	const guard = <T>(f: () => T | Promise<T>, what: string) =>
		Promise.resolve()
			.then(f)
			.catch(() => invalid(what));
	let claims: Claims = await guard(() => decodeJwt(idToken), 'id_token');
	const custom = (claims[`${CLAIM}custom`] ?? {}) as Record<string, string>;
	const cid = courseid ?? custom.courseid;
	const client = launchClient(cid ? requireCourse(cid) : null, claims) ?? invalid('issuer');
	const options = {
		issuer: String(claims.iss),
		audience: client.client_id,
		algorithms: ['RS256'],
		requiredClaims: ['exp', 'sub', 'nonce']
	};
	claims = (await guard(() => jwtVerify(idToken, platformKeys(client), options), 'signature')).payload;
	const { db } = services();
	if (!(await db.c.ltiLaunch.findOneAndDelete({ key: `lti1p3-nonce-${claims.nonce}`, value: state }))) invalid('nonce');
	const deployment = String(claims[`${CLAIM}deployment_id`]);
	if (!client.deployment_ids.includes(deployment)) invalid('deployment');
	const deep = claims[`${CLAIM}message_type`] === 'LtiDeepLinkingRequest';
	const resource = claims[`${CLAIM}message_type`] === 'LtiResourceLinkRequest' && cid && (taskid ?? custom.taskid);
	if (claims[`${CLAIM}version`] !== '1.3.0' || !(deep ? claims[`${DL_CLAIM}deep_linking_settings`] : resource))
		invalid('message');
	const key = `lti1p3-launch-${randomUUID()}`;
	// Kept a week: grade passback reads the launch when the submission is graded (with retries).
	await db.c.ltiLaunch.insertOne({ key, value: claims, expires: expiry(7 * 86400) } as LtiLaunchDoc);
	const str = (name: string) => (claims[name] as string | undefined) || undefined;
	const tool = (claims[`${CLAIM}tool_platform`] ?? {}) as Record<string, string>;
	const context = (claims[`${CLAIM}context`] ?? {}) as Record<string, string>;
	startLtiSession(
		event,
		{
			version: '1.3',
			email: str('email') ?? '',
			username: String(claims.sub),
			realname: realname(str('name'), str('given_name'), str('family_name'), str('email'), claims.sub),
			roles: (claims[`${CLAIM}roles`] ?? []) as string[],
			task: deep ? ['', ''] : [String(cid), String(taskid ?? custom.taskid)],
			platform_instance_id: `${claims.iss}/${client.client_id}/${deployment}`,
			course_secret: deep ? '' : (custom.secret ?? ''),
			message_launch_id: key,
			// Legacy read `context_title`/`context_label` (always N/A): the claim keys are `title`/`label`.
			context_title: context.title || 'N/A',
			context_label: context.label || 'N/A',
			tool_description: tool.description || 'N/A',
			tool_name: tool.name || 'N/A',
			tool_url: tool.url || 'N/A'
		},
		deep ? 'deeplink' : 'task'
	);
}

/**
 * LTI-10: signed `LtiDeepLinkingResponse` for a task (docs/reference/lti.md §6).
 * @param claims the stored deep-linking launch; @param secret deployment secret of the course.
 * @returns the platform return URL and the JWT to post to it.
 */
export async function deepLinkResponse(
	client: Client,
	claims: Claims,
	item: { title: string; url: string; custom: Record<string, string> }
) {
	const settings = claims[`${DL_CLAIM}deep_linking_settings`] as { deep_link_return_url: string; data?: unknown };
	const now = Math.floor(Date.now() / 1000);
	const jwt = await signTool(client, {
		iss: client.client_id,
		aud: [String(claims.iss)],
		iat: now,
		exp: now + 600,
		nonce: `nonce-${randomBytes(16).toString('hex')}`,
		[`${CLAIM}deployment_id`]: claims[`${CLAIM}deployment_id`],
		[`${CLAIM}message_type`]: 'LtiDeepLinkingResponse',
		[`${CLAIM}version`]: '1.3.0',
		[`${DL_CLAIM}content_items`]: [{ type: 'ltiResourceLink', ...item }],
		[`${DL_CLAIM}data`]: settings.data ?? null
	});
	return { url: settings.deep_link_return_url, jwt };
}

/** LTI-11 `GET /lti1.3/jwks/[<courseid>/]<md5(iss + client_id)>` (`path` after jwks/): public key of a registration, 404 otherwise. */
export async function jwks(path: string): Promise<Response> {
	const [hash, courseid, extra] = path.split('/').reverse();
	if (extra !== undefined) error(404, t('Keyset not found'));
	for (const [iss, clients] of Object.entries(toolConfig(courseid ? requireCourse(courseid) : null)))
		for (const c of clients) {
			const md5 = createHash('md5').update(iss + c.client_id);
			if (md5.digest('hex') === hash) return Response.json({ keys: [await toolJwk(c)] });
		}
	error(404, t('Keyset not found'));
}
