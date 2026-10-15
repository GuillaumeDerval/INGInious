/**
 * Mock LMS used by the LTI tests (unit and integration), inspired by
 * infra/agent-configs/lti-mock/mock_platform.py. One HTTP server plays:
 *  - an LTI 1.1 consumer: `launch11(...)` builds OAuth1-signed launch fields, and
 *    `GET /page?id=` serves an auto-submitting form (real cross-site browser launch);
 *    `POST /outcome` answers LIS replaceResult (success, or failure on `/outcome_fail`);
 *  - an LTI 1.3 platform: RSA keys generated with jose, `GET /jwks`, `GET /auth`
 *    (OIDC authorization: auto-posts an id_token built from `nextClaims`),
 *    `POST /token`, `POST /lineitems/1/lineitem/scores[_fail]`, `POST /dlreturn`.
 * Every request is recorded in `log`.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createHmac, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { exportJWK, SignJWT, type JWTPayload } from 'jose';

/** A request received by the mock. */
export interface Logged {
	method: string;
	path: string;
	headers: IncomingMessage['headers'];
	body: string;
}

/** RFC 3986 encoding used by OAuth 1. */
const pct = (s: string) =>
	encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Independent OAuth1 HMAC-SHA1 signer (does not reuse the code under test). */
export function oauthSign(url: string, fields: Record<string, string>, secret: string, method = 'HMAC-SHA1'): string {
	const u = new URL(url);
	const pairs = [...Object.entries(fields), ...u.searchParams].map(([k, v]) => [pct(k), pct(v)]);
	pairs.sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1));
	const base = ['POST', pct(u.origin + u.pathname), pct(pairs.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
	return createHmac(method === 'HMAC-SHA256' ? 'sha256' : 'sha1', `${pct(secret)}&`)
		.update(base)
		.digest('base64');
}

/** Builds a signed LTI 1.1 launch (fields overridable; `undefined` removes one). */
export function launch11(
	url: string,
	key: string,
	secret: string,
	extra: Record<string, string | undefined> = {}
): Record<string, string> {
	const fields: Record<string, string | undefined> = {
		lti_message_type: 'basic-lti-launch-request',
		lti_version: 'LTI-1p0',
		resource_link_id: 'rl1',
		user_id: 'lms-user-1',
		roles: 'Learner',
		lis_person_name_full: 'LMS User One',
		lis_person_contact_email_primary: 'lmsuser1@lms.example',
		context_id: 'c1',
		context_title: 'LMS course',
		context_label: 'C101',
		tool_consumer_instance_name: 'MockLMS',
		tool_consumer_instance_description: 'Mock LMS 1.1',
		tool_consumer_instance_url: 'http://lms.example',
		lis_outcome_service_url: 'http://lms.example/outcome',
		lis_result_sourcedid: 'sourcedid-1',
		oauth_consumer_key: key,
		oauth_signature_method: 'HMAC-SHA1',
		oauth_timestamp: String(Math.floor(Date.now() / 1000)),
		oauth_nonce: randomBytes(16).toString('hex'),
		oauth_version: '1.0',
		...extra
	};
	const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Record<string, string>;
	return { ...clean, oauth_signature: oauthSign(url, clean, secret, clean.oauth_signature_method) };
}

/** Escapes an HTML attribute. */
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** Auto-submitting form page. */
const autoPost = (action: string, fields: Record<string, string>) =>
	`<!doctype html><form id="f" method="POST" action="${attr(action)}">${Object.entries(fields)
		.map(([k, v]) => `<input type="hidden" name="${attr(k)}" value="${attr(v)}">`)
		.join('')}</form><script>document.getElementById('f').submit()</script>`;

/** PEM key pair. */
export function rsaPems() {
	const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	return {
		privatePem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
		publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
		privateKey
	};
}

/** A running mock LMS. */
export interface MockLms {
	url: string;
	iss: string;
	log: Logged[];
	/** Platform key pair (signs id_tokens) and tool key pair (to put in the tool configuration). */
	platform: ReturnType<typeof rsaPems>;
	tool: ReturnType<typeof rsaPems>;
	/** Claims added to the id_token issued by the next `GET /auth`. */
	nextClaims: Record<string, unknown>;
	/** Pages served at `/page?id=<id>`. */
	pages: Map<string, string>;
	/** Signs an id_token with the platform key. */
	idToken: (claims: JWTPayload) => Promise<string>;
	/** Registers an auto-submitting page posting `fields` to `action`; returns its URL. */
	page: (action: string, fields: Record<string, string>) => string;
	close: () => Promise<void>;
}

/** Starts the mock on a random port (http://localhost:<port>). */
export async function startMockLms(): Promise<MockLms> {
	const platform = rsaPems();
	const tool = rsaPems();
	const publicJwk = {
		...(await exportJWK(createPublicKey(platform.privateKey))),
		kid: 'platform-kid-1',
		alg: 'RS256',
		use: 'sig'
	};
	const log: Logged[] = [];
	const mock = { log, platform, tool, nextClaims: {}, pages: new Map<string, string>() } as unknown as MockLms;
	const send = (res: import('node:http').ServerResponse, status: number, type: string, body: string) =>
		res.writeHead(status, { 'Content-Type': type }).end(body);
	const server: Server = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', async () => {
			const u = new URL(req.url!, mock.url);
			log.push({ method: req.method!, path: u.pathname, headers: req.headers, body });
			const xml = (code: string) =>
				`<?xml version="1.0" encoding="UTF-8"?><imsx_POXEnvelopeResponse xmlns="http://www.imsglobal.org/services/ltiv1p1/xsd/imsoms_v1p0"><imsx_POXHeader><imsx_POXResponseHeaderInfo><imsx_statusInfo><imsx_codeMajor>${code}</imsx_codeMajor></imsx_statusInfo></imsx_POXResponseHeaderInfo></imsx_POXHeader></imsx_POXEnvelopeResponse>`;
			switch (u.pathname) {
				case '/jwks':
					return send(res, 200, 'application/json', JSON.stringify({ keys: [publicJwk] }));
				case '/outcome':
					return send(res, 200, 'application/xml', xml('success'));
				case '/outcome_fail':
					return send(res, 500, 'application/xml', xml('failure'));
				case '/token':
					return send(
						res,
						200,
						'application/json',
						JSON.stringify({ access_token: 'mock-access-token', token_type: 'Bearer', expires_in: 3600 })
					);
				case '/lineitems/1/lineitem/scores':
					return send(res, 200, 'application/json', '{}');
				case '/lineitems/1/lineitem_fail/scores':
					return send(res, 500, 'application/json', '{}');
				case '/dlreturn':
					return send(res, 200, 'text/html', '<p>Deep link received</p>');
				case '/page':
					return send(res, 200, 'text/html', mock.pages.get(u.searchParams.get('id')!) ?? '');
				case '/auth': {
					const q = Object.fromEntries(u.searchParams);
					const token = await mock.idToken({ nonce: q.nonce, aud: q.client_id, sub: q.login_hint, ...mock.nextClaims });
					return send(res, 200, 'text/html', autoPost(q.redirect_uri, { id_token: token, state: q.state }));
				}
				default:
					return send(res, 404, 'text/plain', 'not found');
			}
		});
	});
	// Dual-stack listener; `localhost` is same-site with the app (SameSite=Lax cookies over http).
	await new Promise<void>((r) => server.listen(0, r));
	const port = (server.address() as import('node:net').AddressInfo).port;
	mock.url = `http://localhost:${port}`;
	mock.iss = 'https://platform.example';
	mock.idToken = (claims) => {
		const now = Math.floor(Date.now() / 1000);
		return new SignJWT({ iss: mock.iss, iat: now, exp: now + 300, ...claims })
			.setProtectedHeader({ alg: 'RS256', kid: 'platform-kid-1' })
			.sign(platform.privateKey);
	};
	mock.page = (action, fields) => {
		const id = randomBytes(6).toString('hex');
		mock.pages.set(id, autoPost(action, fields));
		return `${mock.url}/page?id=${id}`;
	};
	mock.close = () => new Promise((r) => server.close(() => r()));
	return mock;
}

/** LTI 1.3 registration of the mock in a tool configuration (`lti_config`). */
export function registration(mock: MockLms, extra: Record<string, unknown> = {}) {
	return {
		[mock.iss]: [
			{
				default: true,
				client_id: 'tool-client-1',
				auth_login_url: `${mock.url}/auth`,
				auth_token_url: `${mock.url}/token`,
				key_set_url: `${mock.url}/jwks`,
				deployment_ids: ['dep-1'],
				private_key: mock.tool.privatePem,
				public_key: mock.tool.publicPem,
				...extra
			}
		]
	};
}

/** Standard claims of a resource-link launch (deployment dep-1, AGS score scope). */
export function resourceClaims(
	mock: MockLms,
	custom: Record<string, string>,
	extra: Record<string, unknown> = {},
	lineitem = 'lineitem'
) {
	const C = 'https://purl.imsglobal.org/spec/lti/claim/';
	return {
		[`${C}deployment_id`]: 'dep-1',
		[`${C}message_type`]: 'LtiResourceLinkRequest',
		[`${C}version`]: '1.3.0',
		[`${C}resource_link`]: { id: 'rl-1' },
		[`${C}roles`]: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
		[`${C}custom`]: custom,
		[`${C}context`]: { id: 'ctx', title: 'Platform course', label: 'P101' },
		[`${C}tool_platform`]: { name: 'MockLMS', description: 'Mock LMS', url: 'http://lms.example' },
		name: 'Platform User',
		email: 'plat-user@platform.example',
		'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint': {
			scope: [
				'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
				'https://purl.imsglobal.org/spec/lti-ags/scope/score'
			],
			lineitem: `${mock.url}/lineitems/1/${lineitem}`
		},
		...extra
	};
}
