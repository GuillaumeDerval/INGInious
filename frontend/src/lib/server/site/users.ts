/**
 * Site administration of user accounts (SITE-01..05), port of the legacy
 * `AdministrationUsersPage` / `AdministrationUserActionPage`.
 *
 * Differences with legacy (documented in the SITE specs):
 *  - SITE-01: a search box (username, real name or e-mail) is added; the page
 *    number is a GET parameter clamped to the valid range (legacy: 500).
 *  - SITE-02: the hints of the form are enforced server side (username rule,
 *    real name, valid e-mail, password of `password_min_length`+ characters,
 *    see `newUserDoc`) and the e-mail is normalised.
 *  - SITE-03/05: deletion and binding revocation reuse the account logic of
 *    the AUTH area (`deleteUser`, `revokeBinding`), which also removes GridFS
 *    files and sessions and keeps the group submissions of teammates.
 *  - SITE-04: only pending accounts can be activated ("User not found" otherwise).
 */
import { t } from '#lib/i18n/index.js';
import { services } from '../app.js';
import { insertUser, newUserDoc, type NewUser } from '../auth/accounts.js';
import type { UserDoc } from '../db/types.js';
import { pageSlice } from '../pagination.js';

/** Users per page (legacy constant). */
export const PAGE_SIZE = 10;

/** One row of the user table. */
export interface UserRow {
	username: string;
	realname: string;
	email: string;
	/** Account waiting for its activation (`activate` field present). */
	pending: boolean;
	/** Auth method id -> identifier at the provider. */
	bindings: Record<string, string>;
}

/** Escapes a string for use inside a regular expression (no regex injection). */
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * SITE-01: one page of users in natural order, optionally filtered.
 * @param page wished page (clamped to [1, pages]).
 * @returns the rows, the effective page and the number of pages (at least 1).
 */
export async function listUsers(page: number, query = ''): Promise<{ rows: UserRow[]; page: number; pages: number }> {
	const re = { $regex: escapeRegex(query.trim()), $options: 'i' };
	const filter = query.trim() ? { $or: [{ username: re }, { realname: re }, { email: re }] } : {};
	const users = services().db.c.users;
	const slice = pageSlice(await users.countDocuments(filter), page, PAGE_SIZE);
	const docs = await users.find(filter).skip(slice.skip).limit(slice.limit).toArray();
	const bindings = (b: UserDoc['bindings']) =>
		Object.fromEntries(Object.entries(b ?? {}).map(([id, v]) => [id, String(v?.[0] ?? '')]));
	const rows = docs.map((u) => ({
		username: u.username,
		realname: u.realname ?? '',
		email: u.email ?? '',
		pending: u.activate !== undefined,
		bindings: bindings(u.bindings)
	}));
	return { rows, page: slice.page, pages: slice.pages };
}

/**
 * SITE-02: creates an activated local account with the policy of every
 * account creation (`newUserDoc`); the username and the e-mail must be free.
 * @returns null on success, else the error message.
 */
export async function createUser(
	f: Pick<NewUser, 'username' | 'realname' | 'email' | 'password'>
): Promise<string | null> {
	const doc = await newUserDoc(f);
	if (typeof doc === 'string') return doc;
	const users = services().db.c.users;
	// The unique indexes also refuse an account created concurrently with the same username or e-mail.
	if ((await users.findOne({ $or: [{ username: doc.username }, { email: doc.email }] })) || !(await insertUser(doc)))
		return t('User could not be created.');
	return null;
}

/** SITE-04: activates a pending account. @returns false when there is no such pending account. */
export async function activateUser(username: string): Promise<boolean> {
	const r = await services().db.c.users.updateOne(
		{ username, activate: { $exists: true } },
		{ $unset: { activate: '' } }
	);
	return r.matchedCount > 0;
}
