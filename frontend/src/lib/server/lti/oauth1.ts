/**
 * OAuth 1.0a HMAC signatures (RFC 5849 §3.4) used by LTI 1.1 (docs/reference/lti.md §1-2):
 * verification of the inbound basic launch (LTI-02) and signing of the outbound
 * LIS outcome requests with the body-hash extension (LTI-07).
 *
 * Validation rules (LTI-02 "Permissions & security"): PLAINTEXT and RSA methods
 * are refused (only HMAC-SHA1 and HMAC-SHA256 are accepted), the timestamp must be within ±600 s, the signature is compared in constant
 * time and is computed over the parameters actually received (no injected defaults,
 * no re-serialised role lists).
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { safeEqual } from '../courses/access.js';

/** Accepted signature methods -> HMAC digest algorithm. */
const METHODS: Record<string, string> = { 'HMAC-SHA1': 'sha1', 'HMAC-SHA256': 'sha256' };

/** Maximum clock skew between the consumer and INGInious (seconds). */
export const TIMESTAMP_WINDOW = 600;

/** RFC 3986 percent-encoding (OAuth `pct`: only `A-Z a-z 0-9 - . _ ~` are kept). */
export function pct(value: string): string {
	return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Signature base string: `POST&pct(uri)&pct(sorted params)` where the params are the
 * body pairs plus the query string of `url`, without `oauth_signature`/`realm`.
 */
export function baseString(url: URL, params: [string, string][]): string {
	const pairs = [...params, ...url.searchParams]
		.filter(([k]) => k !== 'oauth_signature' && k !== 'realm')
		.map(([k, v]) => [pct(k), pct(v)])
		// Sorted by encoded name, then value (not on the joined "k=v": "a1" > "a=" would be wrong).
		.sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
		.map(([k, v]) => `${k}=${v}`);
	// `URL` already lower-cases the scheme/host and drops default ports.
	return `POST&${pct(url.origin + url.pathname)}&${pct(pairs.join('&'))}`;
}

/** HMAC signature (base64) with the key `pct(secret)&` (no token secret). */
export function sign(method: string, secret: string, base: string): string {
	return createHmac(Object.hasOwn(METHODS, method) ? METHODS[method] : 'sha1', `${pct(secret)}&`)
		.update(base)
		.digest('base64');
}

/**
 * Verifies a signed launch (LTI-02).
 * @param params every received body field, in order.
 * @param url externally visible URL of the request (scheme/host as signed by the LMS).
 * @param secrets consumer key -> secret of the course.
 * @returns the consumer key and nonce/timestamp to record, or null when invalid.
 */
export function verify(params: [string, string][], url: URL, secrets: Record<string, string>, now = Date.now()) {
	const oauth = params.filter(([k]) => k.startsWith('oauth_'));
	const o = Object.fromEntries(oauth);
	const ts = o.oauth_timestamp ?? '';
	// No duplicated oauth_* parameter, HMAC method, version 1.0, timestamp in the window, nonce of 20-64 chars.
	const valid =
		new Set(oauth.map(([k]) => k)).size === oauth.length &&
		Object.hasOwn(METHODS, o.oauth_signature_method ?? '') &&
		(o.oauth_version ?? '1.0') === '1.0' &&
		/^\d{1,10}$/.test(ts) &&
		Math.abs(now / 1000 - Number(ts)) <= TIMESTAMP_WINDOW &&
		/^.{20,64}$/.test(o.oauth_nonce ?? '');
	const key = o.oauth_consumer_key ?? '';
	const secret = Object.hasOwn(secrets, key) ? secrets[key] : null;
	// The signature is always computed (unknown keys use a dummy secret) to keep a constant time.
	const expected = sign(o.oauth_signature_method, secret ?? '', baseString(url, params));
	const ok = safeEqual(expected, o.oauth_signature ?? '');
	return valid && ok && secret !== null ? { key, nonce: o.oauth_nonce, timestamp: Number(ts) } : null;
}

/**
 * `Authorization: OAuth …` header of an outbound request with an XML body
 * (LIS outcomes, `oauth_body_hash` extension, HMAC-SHA1 like `requests_oauthlib`).
 */
export function authorizationHeader(url: string, key: string, secret: string, body: string): string {
	const oauth: Record<string, string> = {
		oauth_nonce: randomBytes(16).toString('hex'),
		oauth_timestamp: String(Math.floor(Date.now() / 1000)),
		oauth_version: '1.0',
		oauth_signature_method: 'HMAC-SHA1',
		oauth_consumer_key: key,
		oauth_body_hash: createHash('sha1').update(body).digest('base64')
	};
	oauth.oauth_signature = sign('HMAC-SHA1', secret, baseString(new URL(url), Object.entries(oauth)));
	return `OAuth ${Object.entries(oauth)
		.map(([k, v]) => `${k}="${pct(v)}"`)
		.join(', ')}`;
}
