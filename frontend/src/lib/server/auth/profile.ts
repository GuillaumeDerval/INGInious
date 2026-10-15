/**
 * Profile preferences (AUTH-09, AUTH-10, AUTH-11): username completion for
 * external accounts, password change, language, timezone, code indentation,
 * real name and terms of service acceptance.
 *
 * Differences with legacy `save_profile`: the update is atomic (the username
 * was committed even when a later check failed, and a passwordless account
 * setting username + password got a 500), the account is found by the same key
 * on load and save, `session.tos_signed` reflects the checkbox,
 * and a password change closes the other sessions and pending reset tokens.
 */
import { redirect } from '@sveltejs/kit';
import { t, LANGUAGES } from '#lib/i18n/index.js';
import { services } from '../app.js';
import type { UserDoc } from '../db/types.js';
import { signinUrl, type GuardEvent } from '../security/guards.js';
import type { Session } from './session.js';
import { USERNAME_RE, failure, passwordError } from './accounts.js';
import { hashPassword, verifyPassword } from './passwords.js';

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

/** Validates and saves the profile, then updates the session. */
export async function saveProfile(session: Session, f: ProfileForm) {
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
		if (user.password && !(await verifyPassword(user.password, f.oldpasswd ?? '')))
			return failure(t('Incorrect old password.'));
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
	await db.c.users.updateOne({ _id: user._id }, set.password ? { $set: set, $unset: { reset: '' } } : { $set: set });
	if (set.password && user.username)
		await db.c.sessions.deleteMany({ username: user.username, _id: { $ne: session.doc._id } });
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
