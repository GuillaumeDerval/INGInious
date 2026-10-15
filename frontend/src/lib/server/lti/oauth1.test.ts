import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { authorizationHeader, baseString, pct, sign, verify } from './oauth1.js';
import { launch11, oauthSign } from '../../../../e2e/lti/mock/platform.js';

const URL1 = 'http://localhost:8093/lti/lti_test/mcq1';
const pairs = (f: Record<string, string>) => Object.entries(f);

describe('oauth1', () => {
	it('LTI-02 percent-encodes like RFC 3986 and sorts by name then value', () => {
		expect(pct("a b!*'()~")).toBe('a%20b%21%2A%27%28%29~');
		const base = baseString(new URL('HTTP://Example.COM:80/P?b=2&a=3'), [
			['a1', 'x'],
			['a', '2'],
			['oauth_signature', 's'],
			['realm', 'r']
		]);
		expect(base).toBe('POST&http%3A%2F%2Fexample.com%2FP&a%3D2%26a%3D3%26a1%3Dx%26b%3D2');
		expect(base).toContain('a%3D2%26a%3D3%26a1');
		expect(
			baseString(new URL('http://x/'), [
				['a', '2'],
				['a', '1'],
				['a', '1']
			])
		).toBe('POST&http%3A%2F%2Fx%2F&a%3D1%26a%3D1%26a%3D2');
		expect(verify([], new URL('http://x/'), {})).toBeNull();
	});

	it('LTI-02 accepts HMAC-SHA1 and HMAC-SHA256 launches signed by an independent signer', () => {
		const f = launch11(URL1, 'ltikey', 'ltisecret', { roles: 'Instructor, Learner', lti_version: undefined });
		expect(verify(pairs(f), new URL(URL1), { ltikey: 'ltisecret' })).toMatchObject({
			key: 'ltikey',
			nonce: f.oauth_nonce
		});
		const g = launch11(URL1, 'ltikey', 'ltisecret', { oauth_signature_method: 'HMAC-SHA256' });
		expect(verify(pairs(g), new URL(URL1), { ltikey: 'ltisecret' })).not.toBeNull();
	});

	it('LTI-02 refuses PLAINTEXT, bad secrets, unknown keys, stale timestamps, short nonces, bad versions and duplicates', () => {
		const ok = { ltikey: 'ltisecret' };
		const check = (extra: Record<string, string | undefined>, secrets: Record<string, string> = ok) =>
			verify(pairs(launch11(URL1, 'ltikey', 'ltisecret', extra)), new URL(URL1), secrets);
		const plain = launch11(URL1, 'ltikey', 'ltisecret', { oauth_signature_method: 'PLAINTEXT' });
		expect(verify(pairs({ ...plain, oauth_signature: 'ltisecret&' }), new URL(URL1), ok)).toBeNull();
		expect(check({}, { ltikey: 'other' })).toBeNull();
		expect(check({}, {})).toBeNull();
		expect(check({ oauth_timestamp: String(Math.floor(Date.now() / 1000) - 700) })).toBeNull();
		expect(check({ oauth_timestamp: 'abc' })).toBeNull();
		expect(check({ oauth_nonce: 'short' })).toBeNull();
		expect(check({ oauth_signature_method: 'toString' })).toBeNull(); // inherited properties are not methods
		expect(check({ oauth_version: '2.0' })).toBeNull();
		expect(check({ oauth_version: undefined })).not.toBeNull();
		const f = launch11(URL1, 'ltikey', 'ltisecret');
		expect(verify([...pairs(f), ['oauth_nonce', 'x'.repeat(30)]], new URL(URL1), ok)).toBeNull();
		expect(verify(pairs({ ...f, oauth_signature: 'AAAA' }), new URL(URL1), ok)).toBeNull();
		expect(
			verify(
				pairs(f).filter(([k]) => k !== 'oauth_signature'),
				new URL(URL1),
				ok
			)
		).toBeNull();
		// The signature covers the URL actually signed (scheme/host/path).
		expect(verify(pairs(f), new URL('https://localhost:8093/lti/lti_test/mcq1'), ok)).toBeNull();
	});

	it('LTI-07 signs outbound LIS requests with a body hash', () => {
		const body = '<xml/>';
		const header = authorizationHeader('http://lms.example/outcome?x=1', 'k', 's', body);
		const fields = Object.fromEntries(
			[...header.slice(6).matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], decodeURIComponent(m[2])])
		);
		expect(fields.oauth_body_hash).toBe(createHash('sha1').update(body).digest('base64'));
		const { oauth_signature: sig, ...rest } = fields;
		expect(sig).toBe(oauthSign('http://lms.example/outcome?x=1', rest, 's'));
		expect(sign('UNKNOWN', 's', 'b')).toBe(sign('HMAC-SHA1', 's', 'b'));
	});
});
