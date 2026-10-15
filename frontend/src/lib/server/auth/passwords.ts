/**
 * Password hashing compatible with the legacy `users.password` field (AUTH-05).
 *
 * Accepted stored formats (legacy `UserManager.auth_user`):
 *  - `argon2id-<PHC string>`  (current format, written by both frontends);
 *  - `sha512-<hex digest>`    (old format, unsalted);
 *  - `<hex digest>`           (oldest format: bare SHA-512).
 * New hashes use argon2id with explicit parameters (argon2-cffi defaults, so the
 * legacy frontend can still verify them). SHA-512 hashes are reported as
 * needing a rehash so that the login flow upgrades them.
 */
import { hash, verify, type Algorithm } from '@node-rs/argon2';
import { createHash, timingSafeEqual } from 'node:crypto';

/** argon2id parameters (argon2-cffi `PasswordHasher()` defaults). */
// `Algorithm` is an ambient const enum (not importable with verbatimModuleSyntax): 2 = Argon2id.
const ARGON2 = { algorithm: 2 as Algorithm, memoryCost: 65536, timeCost: 3, parallelism: 4, outputLen: 32 };

/** Returns the stored representation of a new password. */
export async function hashPassword(password: string): Promise<string> {
	return 'argon2id-' + (await hash(password, ARGON2));
}

/** Constant-time comparison of a SHA-512 hex digest. */
function verifySha512(digest: string, password: string): boolean {
	const computed = createHash('sha512').update(password, 'utf8').digest('hex');
	const a = Buffer.from(computed);
	const b = Buffer.from(digest.toLowerCase());
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verifies a password against a stored hash of any supported format.
 * Unknown or malformed formats are rejected (legacy raised a 500 instead).
 */
export async function verifyPassword(stored: string | null | undefined, password: string): Promise<boolean> {
	if (!stored) return false;
	if (stored.startsWith('argon2id-')) {
		try {
			return await verify(stored.slice('argon2id-'.length), password);
		} catch {
			return false;
		}
	}
	if (stored.startsWith('sha512-')) return verifySha512(stored.slice('sha512-'.length), password);
	if (/^[0-9a-fA-F]{128}$/.test(stored)) return verifySha512(stored, password);
	return false;
}

/** True when the stored hash should be replaced by a fresh argon2id hash. */
export function needsRehash(stored: string): boolean {
	return !stored.startsWith('argon2id-');
}
