/**
 * Unit tests of password hashing (legacy formats, AUTH-05).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { hashPassword, verifyPassword, needsRehash } from './passwords.js';

/** Hash of "superadmin" written by legacy/deploy/init-mongo.js. */
const LEGACY_ARGON =
	'argon2id-$argon2id$v=19$m=65536,t=3,p=1$QVNVUEVSU0VDVVJFU0FMVA$NpeSDEsx+FwrIS277T9o/Q4z4Ypicibs3LiLZrftXsBUmBxFnK8FKa45w5q85ewM+dOlzZPMFdAmxpmDVAmLlQ';
const sha = (s: string) => createHash('sha512').update(s).digest('hex');

describe('passwords', () => {
	it('verifies legacy argon2id hashes', async () => {
		expect(await verifyPassword(LEGACY_ARGON, 'superadmin')).toBe(true);
		expect(await verifyPassword(LEGACY_ARGON, 'wrong')).toBe(false);
	});

	it('hashes new passwords as argon2id and verifies them', async () => {
		const h = await hashPassword('s3cret!');
		expect(h).toMatch(/^argon2id-\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
		expect(await verifyPassword(h, 's3cret!')).toBe(true);
		expect(needsRehash(h)).toBe(false);
	});

	it('verifies prefixed and bare sha512 hashes and asks for a rehash', async () => {
		expect(await verifyPassword('sha512-' + sha('pw'), 'pw')).toBe(true);
		expect(await verifyPassword(sha('pw').toUpperCase(), 'pw')).toBe(true);
		expect(await verifyPassword(sha('pw'), 'nope')).toBe(false);
		expect(await verifyPassword('sha512-abc', 'pw')).toBe(false);
		expect(needsRehash(sha('pw'))).toBe(true);
	});

	it('rejects missing, unknown and corrupted hashes', async () => {
		expect(await verifyPassword(undefined, 'x')).toBe(false);
		expect(await verifyPassword(null, 'x')).toBe(false);
		expect(await verifyPassword('', 'x')).toBe(false);
		expect(await verifyPassword('md5-abc', 'x')).toBe(false);
		expect(await verifyPassword('argon2id-garbage', 'x')).toBe(false);
	});
});
