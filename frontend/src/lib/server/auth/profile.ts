/**
 * Profile preferences (AUTH-09, AUTH-10, AUTH-11): username completion for
 * external accounts, password change, language, timezone, code indentation,
 * real name and terms of service acceptance.
 *
 * Differences with legacy `save_profile`: the update is atomic (the username
 * was committed even when a later check failed, and a passwordless account
 * setting username + password got a 500), the account is found by the same key
 * on load and save, `session.tos_signed` reflects the checkbox,
 * a password change closes the other sessions and pending reset tokens and
 * gives the current session a new id, and old-password checks are throttled
 * like sign-in. "Log out other sessions" closes every other session of the account.
 */
import { redirect } from '@sveltejs/kit';
import { t, LANGUAGES } from '#lib/i18n/index.js';
import { services } from '../app.js';
import type { UserDoc } from '../db/types.js';
import { signinUrl, type GuardEvent } from '../security/guards.js';
import type { Session } from './session.js';
import { PASSWORD_MAX_LENGTH, USERNAME_RE, failure, isDuplicate, passwordError } from './accounts.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { authThrottle } from './rate-limit.js';

/** Code indentation choices (legacy INDENTATION_TYPES keys). */
export const INDENTATIONS = ['2', '3', '4', 'tabs'];

/** Posted profile form: `username` is only used while the account has none, `tos` is the terms checkbox. */
export type ProfileForm = Record<'realname' | 'language' | 'timezone' | 'code_indentation', string> &
	Partial<Record<'username' | 'oldpasswd' | 'passwd' | 'passwd2', string>> & { tos: boolean };

/**
 * Guard of the preference pages: any logged-in (non-LTI) session, including
 * external accounts that still have to choose a username (which `requireUser`
 * refuses).
 * @returns the session document.
 */
export function requireSession(event: GuardEvent) {
	const doc = event.locals.session.doc;
	if (!doc.loggedin || doc.is_lti) redirect(302, signinUrl(event.url));
	return doc;
}

/** The account of a logged-in session (by e-mail and username, both kept in the session). */
export function sessionAccount(session: Session): Promise<UserDoc | null> {
	return services().db.c.users.findOne({ email: session.doc.email ?? '', username: session.doc.username ?? '' });
}

/** True when `zone` is a time zone known to the runtime. */
const validZone = (zone: string) =>
	Intl.supportedValuesOf('timeZone').includes(zone) || ['UTC', 'Etc/UTC'].includes(zone);

/**
 * Closes every session of the account of `session` except `session` itself. An account
 * without username (AUTH-11) is designated by its e-mail address too.
 */
export async function closeOtherSessions(session: Session): Promise<void> {
	const { username, email } = session.doc;
	await services().db.c.sessions.deleteMany({
		...(username ? { username } : { username: '', email }),
		_id: { $ne: session.doc._id }
	});
}

/** True when `password` is the current password of `user`; failures are throttled like sign-in. */
async function checkOldPassword(user: UserDoc, password: string, client: string): Promise<boolean | null> {
	const account = `local:${user.username}`;
	if (authThrottle.blocked(client, account)) return null;
	const valid = password.length <= PASSWORD_MAX_LENGTH && (await verifyPassword(user.password!, password));
	if (!valid) authThrottle.failed(client, account);
	return valid;
}

/**
 * Validates and saves the profile, then updates the session.
 * @param client client identifier for rate limiting (IP address).
 */
export async function saveProfile(session: Session, f: ProfileForm, client = '') {
	const { config, db, sessions } = services();
	const user = await sessionAccount(session);
	if (!user) return failure(t('Incorrect email.'));
	const set: Partial<UserDoc> = {};
	if (!user.username && f.username !== undefined) {
		if (!USERNAME_RE.test(f.username)) return failure(t('Invalid username format.'));
		if (await db.c.users.findOne({ username: f.username })) return failure(t('Username already taken'));
		set.username = f.username;
	}
	if (config.allowRegistration && f.passwd) {
		const invalid = passwordError(f.passwd, f.passwd2 ?? '');
		if (invalid) return failure(invalid);
		if (user.password) {
			const valid = await checkOldPassword(user, f.oldpasswd ?? '', client);
			if (valid === null) return failure(t('Too many requests, please retry later.'));
			if (!valid) return failure(t('Incorrect old password.'));
		}
		set.password = await hashPassword(f.passwd);
	}
	if (!f.realname.trim()) return failure(t('Name is too short.'));
	if (!validZone(f.timezone)) return failure(t('Incorrect timezone.'));
	const language = Object.hasOwn(LANGUAGES, f.language) ? f.language : 'en';
	Object.assign(set, {
		realname: f.realname,
		timezone: f.timezone,
		language,
		code_indentation: INDENTATIONS.includes(f.code_indentation) ? f.code_indentation : '4'
	});
	if (config.isTosDefined) set.tos_accepted = f.tos;
	try {
		await db.c.users.updateOne({ _id: user._id }, set.password ? { $set: set, $unset: { reset: '' } } : { $set: set });
	} catch (e) {
		// The unique index refuses a username chosen concurrently by another account.
		if (isDuplicate(e)) return failure(t('Username already taken'));
		throw e;
	}
	if (set.password) {
		// A new password ends every other session (found with the former username) and the current one gets a new id.
		await sessions.rotate(session);
		await closeOtherSessions(session);
	}
	const { username = user.username, realname, timezone, code_indentation } = set;
	Object.assign(session.doc, {
		username,
		realname,
		timezone,
		language,
		code_indentation,
		tos_signed: set.tos_accepted ?? session.doc.tos_signed
	});
	sessions.markDirty(session);
	return { message: t('Profile updated.') };
}
