/**
 * Local accounts: sign-in, registration, activation, password reset, deletion
 * and API keys (AUTH-05/06/07/08/13/19). Port of the account part of the legacy
 * `UserManager` (docs/reference/user-manager.md), with these properties:
 *  - the session id is rotated at login;
 *  - activation/reset tokens come from a CSPRNG and carry their expiry
 *    (`<64 hex>.<expiry in ms>` stored in the unchanged `activate`/`reset`
 *    fields); tokens without expiry are refused;
 *  - registration and lost password answer the same way whether or not the
 *    account exists;
 *  - sign-in failures and outgoing mails are rate limited;
 *  - older SHA-512 hashes are upgraded to argon2id at login;
 *  - links in mails are built with `publicUrl` (never from the Host header).
 * Functions used by form actions directly return the action result:
 * `{ message }` on success, `fail(400, { message })` otherwise.
 */
import { randomBytes } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { services } from '../app.js';
import type { UserDoc } from '../db/types.js';
import { publicUrl, sendMail } from '../mail.js';
import { attempt } from '../attempt.js';
import { unregisterUser } from '../courses/members.js';
import type { Session } from './session.js';
import { hashPassword, needsRehash, verifyPassword } from './passwords.js';
import { authThrottle, RateLimiter } from './rate-limit.js';

/** Legacy username rule: at least 4 ASCII letters, digits, `-`, `_`, `|` or `~`. */
export const USERNAME_RE = /^[-_|~0-9A-Z]{4,}$/i;
/** Legacy e-mail rule (dot-atom or quoted local part, domain with a 2-6 letter TLD). */
const EMAIL_RE =
	// eslint-disable-next-line no-control-regex -- RFC 5322 quoted strings may contain control characters (legacy regex).
	/^(?:[-!#$%&'*+/=?^_`{}|~0-9A-Z]+(?:\.[-!#$%&'*+/=?^_`{}|~0-9A-Z]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f!#-[\]-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?$/i;
/** Format of the activation/reset tokens issued by this frontend. */
export const TOKEN_RE = /^[0-9a-f]{64}\.\d+$/;
/** Registration / reset mails allowed per client every 15 minutes. */
export const mailLimiter = new RateLimiter(10, 15 * 60_000);

/** Shorthand for the typed collections. */
const db = () => services().db.c;
/** Form action failure with a message. */
export const failure = (message: string) => fail(400, { message });
let dummyHash: Promise<string> | undefined;

/** Validates an e-mail address; returns it with a lower-cased domain, or null (legacy `sanitize_email`). */
export function sanitizeEmail(email: string): string | null {
	const at = email.lastIndexOf('@');
	return EMAIL_RE.test(email) ? email.slice(0, at) + '@' + email.slice(at + 1).toLowerCase() : null;
}

/** Legacy password rules: the error message for a new password and its confirmation, or null. */
export function passwordError(passwd: string, passwd2: string): string | null {
	return passwd.length < 6 ? t('Password too short.') : passwd === passwd2 ? null : t("Passwords don't match !");
}

/** Fields of a new account; `password` is in clear text, `tos` the state of the terms of service checkbox. */
export type NewUser = Pick<UserDoc, 'username' | 'realname' | 'email'> &
	Partial<Pick<UserDoc, 'language' | 'timezone' | 'bindings' | 'activate'>> & { password?: string; tos?: boolean };

/**
 * The single validation policy of new accounts, shared by self-registration
 * (AUTH-07), external sign-up (AUTH-14) and user administration (SITE-02):
 * legacy username rule (the username may only be empty for an external
 * account, which chooses it later, AUTH-11), real name required, valid e-mail
 * and, when given, a password of 6+ characters.
 * @returns the error message, or null.
 */
export function newUserError(f: NewUser): string | null {
	const external = !f.username && Object.keys(f.bindings ?? {}).length > 0;
	if (!external && !USERNAME_RE.test(f.username)) return t('Invalid username format.');
	if (!f.realname.trim()) return t('Name is too short.');
	if (!sanitizeEmail(f.email)) return t('Invalid email format.');
	return f.password !== undefined && f.password.length < 6 ? t('Password too short.') : null;
}

/**
 * Validates (`newUserError`) and builds the document of a new account, with
 * the same defaults everywhere: English, the server time zone, indentation
 * "4", no LTI binding nor pin; the terms of service count as accepted only
 * when they are defined and were checked.
 * @returns the document to insert, or the error message.
 */
export async function newUserDoc(f: NewUser): Promise<UserDoc | string> {
	const invalid = newUserError(f);
	if (invalid) return invalid;
	return {
		username: f.username,
		realname: f.realname.trim(),
		email: sanitizeEmail(f.email)!,
		...(f.password !== undefined && { password: await hashPassword(f.password) }),
		...(f.activate && { activate: f.activate }),
		language: f.language || 'en',
		code_indentation: '4',
		bindings: f.bindings ?? {},
		ltibindings: {},
		tos_accepted: services().config.isTosDefined && !!f.tos,
		timezone: f.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
		pinned_courses: []
	};
}

/** A new random token valid for `ttl` milliseconds. */
const newToken = (ttl: number) => `${randomBytes(32).toString('hex')}.${Date.now() + ttl}`;
/** True for a well-formed token that has not expired yet. */
const liveToken = (token: string) => TOKEN_RE.test(token) && Number(token.split('.')[1]) > Date.now();

/**
 * Checks local credentials (shared by /signin and the REST API, SITE-07).
 * Only activated accounts with a password can sign in; a legacy SHA-512 hash
 * is replaced by an argon2id one. Failures are rate limited per account and per client.
 * @param login username (surrounding spaces ignored, like legacy).
 * @param client client identifier for rate limiting (IP address).
 * @returns the user document, or null (wrong credentials or too many attempts).
 */
export async function authenticate(login: string, password: string, client = ''): Promise<UserDoc | null> {
	const username = login.trim();
	const account = `local:${username}`;
	// Checked before hashing: a throttled guess costs no argon2 computation.
	if (authThrottle.blocked(client, account)) return null;
	const user = await db().users.findOne({ username, activate: { $exists: false } });
	const stored = user?.password;
	// Unknown users also cost a hash computation, so that timing does not reveal accounts.
	const valid = await verifyPassword(
		stored || (await (dummyHash ??= hashPassword(randomBytes(16).toString('hex')))),
		password
	);
	if (!user || !stored || !valid) return (authThrottle.failed(client, account), null);
	if (needsRehash(stored))
		await db().users.updateOne({ _id: user._id }, { $set: { password: await hashPassword(password) } });
	return user;
}

/**
 * Logs a user in on the current session (legacy `connect_user`): the session id
 * is rotated first, then the user preferences are copied into the session.
 */
export async function connectUser(session: Session, user: UserDoc): Promise<void> {
	await services().sessions.rotate(session);
	const { username, email, realname, timezone = session.doc.timezone, code_indentation = '4' } = user;
	const language = user.language || session.doc.language || 'en';
	Object.assign(session.doc, {
		loggedin: true,
		username,
		email,
		realname,
		language,
		timezone,
		code_indentation,
		tos_signed: !!user.tos_accepted,
		token: null,
		auth_storage: {}
	});
	console.info(`User ${username} connected - ${realname} - ${email}`);
}

/** True when e-mail links can be built for this request (no Host-header fallback, the error is logged). */
const canLink = (url: URL) =>
	attempt(
		() => !!publicUrl('/', url),
		() => false
	);

/** Sends a mail in the background (no timing or delivery oracle); failures are logged. */
function mailLater(to: string, name: string, subject: string, text: string): void {
	sendMail({ to, name, subject, text }).catch((e) => console.error(`Couldn't send email : ${e}`));
}

/** Fields of the registration form (AUTH-07); `tos` is the terms of service checkbox. */
export type Registration = Record<'username' | 'realname' | 'email' | 'passwd' | 'passwd2', string> & { tos: boolean };

/**
 * Creates a local account and mails its activation link (AUTH-07). The account
 * is removed again when the mail cannot be sent. When the e-mail address is
 * already used, the same success message is shown and the owner of the address
 * is notified instead (no enumeration).
 * @param url URL of the request (fallback base of the links, see `publicUrl`).
 * @param client client identifier for rate limiting.
 */
export async function register(f: Registration, lang: string, url: URL, client: string) {
	const fields = { ...f, password: f.passwd, language: lang, activate: newToken(7 * 86400_000) };
	const tos =
		services().config.isTosDefined && !f.tos ? t('Please accept the Terms of Service and Data Privacy') : null;
	const invalid = newUserError(fields) ?? passwordError(f.passwd, f.passwd2) ?? tos;
	if (invalid) return failure(invalid);
	if (await db().users.findOne({ username: f.username })) return failure(t('This username is already taken !'));
	if (!mailLimiter.hit(client)) return failure(t('Too many requests, please retry later.'));
	if (!canLink(url))
		return failure(t('Something went wrong while sending you activation email. Please contact the administrator.'));
	const doc = (await newUserDoc(fields)) as UserDoc;
	const done = { message: t('You are succesfully registered. An email has been sent to you for activation.') };
	if (await db().users.findOne({ email: doc.email })) {
		const text = t('An account already uses this e-mail address. If you lost its password, you can reset it here:\n');
		return (
			mailLater(doc.email, f.realname, t('Welcome on INGInious'), text + publicUrl('/register#lostpasswd', url)),
			done
		);
	}
	await db().users.insertOne(doc);
	try {
		const text = t('Welcome on INGInious !\n\nTo activate your account, please click on the following link :\n');
		await sendMail({
			to: doc.email,
			name: f.realname,
			subject: t('Welcome on INGInious'),
			text: text + publicUrl(`/register?activate=${doc.activate}`, url)
		});
		return done;
	} catch (e) {
		await db().users.deleteOne({ _id: doc._id });
		console.error(`Couldn't send email : ${e}`);
		return failure(t('Something went wrong while sending you activation email. Please contact the administrator.'));
	}
}

/** Activates the account owning a (non-expired) activation token (AUTH-07). */
export async function activate(token: string) {
	const user =
		liveToken(token) && (await db().users.findOneAndUpdate({ activate: token }, { $unset: { activate: '' } }));
	return user ? { message: t('User successfully activated.') } : failure(t('Invalid activation hash.'));
}

/**
 * Lost password (AUTH-08): stores a reset token valid one hour and mails the
 * link when an account uses this exact address. The answer is the same whether
 * or not the address is known (no enumeration).
 */
export async function requestReset(email: string, url: URL, client: string) {
	if (!sanitizeEmail(email)) return failure(t('Invalid email format.'));
	if (!mailLimiter.hit(client)) return failure(t('Too many requests, please retry later.'));
	if (!canLink(url))
		return failure(t('Something went wrong while sending you reset email. Please contact the administrator.'));
	const reset = newToken(3600_000);
	const user = await db().users.findOneAndUpdate({ email }, { $set: { reset } });
	if (user) {
		const text = t(
			'Dear {realname},\n\nSomeone (probably you) asked to reset your INGInious password. If this was you, please click on the following link :\n',
			{ realname: user.realname }
		);
		mailLater(
			email,
			user.realname,
			t('INGInious password recovery'),
			text + publicUrl(`/register?reset=${reset}`, url)
		);
	}
	return { message: t('An email has been sent to you to reset your password.') };
}

/** The account owning a valid reset token, or null. */
export async function resetUser(token: string): Promise<UserDoc | null> {
	return liveToken(token) ? db().users.findOne({ reset: token }) : null;
}

/**
 * Sets a new password from a reset token (AUTH-08). The token is consumed, the
 * account activated and every session of the user closed. Password errors keep
 * the reset form displayed (`reset`: data of the form).
 */
export async function resetPassword(token: string, passwd: string, passwd2: string) {
	const user = await resetUser(token);
	const invalid = user ? passwordError(passwd, passwd2) : t('Invalid reset hash.');
	if (invalid)
		return fail(400, { message: invalid, reset: user && { token, realname: user.realname, username: user.username } });
	await db().users.updateOne(
		{ _id: user!._id, reset: token },
		{ $set: { password: await hashPassword(passwd) }, $unset: { reset: '', activate: '' } }
	);
	await db().sessions.deleteMany({ username: user!.username });
	return { message: t('Your password has been successfully changed.') };
}

/**
 * Deletes an account and its data (AUTH-13, also used by user administration).
 * The account is designated by its document (`_id`), never by a possibly
 * empty username. Unlike legacy, group submissions shared with other students
 * are kept for them (the user is only removed from their `username` list); the
 * user's own submissions are deleted with their GridFS files, and all their
 * sessions closed. An account without username (external sign-up not
 * completed, AUTH-11) has no course data: only its own sessions are closed.
 * @param confirmationEmail when given, the account e-mail must match exactly.
 * @returns false when no such account exists.
 */
export async function deleteUser(user: UserDoc | null, confirmationEmail?: string): Promise<boolean> {
	const c = db();
	if (!user || (confirmationEmail !== undefined && user.email !== confirmationEmail)) return false;
	if (!(await c.users.findOneAndDelete({ _id: user._id }))) return false;
	const { username, email } = user;
	if (username) {
		const own = await c.submissions.find({ username: [username] }, { projection: { input: 1, archive: 1 } }).toArray();
		for (const file of own.flatMap((s) => [s.input, s.archive])) if (file) await services().db.deleteFile(file);
		await c.submissions.deleteMany({ username: [username] });
		await c.submissions.updateMany({ username }, { $pull: { username } });
		await c.userTasks.deleteMany({ username });
		for (const course of await c.courses.find({ students: username }).toArray())
			await unregisterUser(course._id, username);
	}
	await c.sessions.deleteMany(username ? { username } : { username, email });
	return true;
}

/**
 * API key of a user (AUTH-19, WebDAV password): generated on first use as 80
 * hex characters from a CSPRNG and stored in `users.apikey`.
 * @throws when the user does not exist.
 */
export async function apiKey(username: string): Promise<string> {
	await db().users.updateOne({ username, apikey: null }, { $set: { apikey: randomBytes(40).toString('hex') } });
	const user = await db().users.findOne({ username });
	if (!user?.apikey) throw new Error(`Unknown user ${username}`);
	return user.apikey;
}
