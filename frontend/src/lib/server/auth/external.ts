/**
 * External authentication methods (AUTH-12, AUTH-14): registry filled by the
 * bundled auth plugins (OAuth, LDAP, SAML), generic sign-in/callback flow and
 * account binding (legacy `AuthMethod`, `bind_user`, `revoke_binding`).
 *
 * The return target is a validated same-site path given by the page (never
 * the Referer), the flow starts with a POST
 * (no state change on GET) and its state is kept in the server-side session
 * (`auth_storage.<id>`), never trusted from the browser (SAML RelayState).
 */
import { error, redirect, type Cookies } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { services } from '../app.js';
import { setFlash } from '../flash.js';
import { forbidLti, safeRedirectTarget, type GuardEvent } from '../security/guards.js';
import type { UserDoc } from '../db/types.js';
import type { Session } from './session.js';
import { connectUser, insertUser, newUserDoc, sanitizeEmail } from './accounts.js';
import { sessionAccount } from './profile.js';

/** Identity returned by a provider (legacy tuple `(id, realname, email, additional)`). */
export interface ExternalUser {
	/** Identifier of the user at the provider (stored in `users.bindings.<method>[0]`). */
	id: string;
	realname: string;
	email: string;
	/** Extra attributes stored in `users.bindings.<method>[1]` (SAML). */
	additional?: Record<string, unknown>;
	/**
	 * False when the provider does not confirm that the user owns `email`: such an
	 * identity can sign in to the account bound to it, or be bound to the logged-in
	 * account, but never creates an account with that address. Default true.
	 */
	emailVerified?: boolean;
}

/** Per-method state stored in the session during a flow (`sessions.auth_storage.<id>`). */
export type AuthStorage = Record<string, unknown>;

/** What the provider sent back. */
export interface CallbackInput {
	/** Callback URL (query string of OAuth providers). */
	url: URL;
	/** Posted form (SAML response, LDAP credentials), null for GET callbacks. */
	form: FormData | null;
}

/** An external authentication method (one entry of the `plugins:` configuration). */
export interface AuthMethod {
	/** Method id (plugin option `id`): used in URLs and as key of `users.bindings`. */
	id: string;
	/** Display name. */
	name: string;
	/** Optional image URL shown on the sign-in button (plugin option `imlink`). */
	imlink?: string;
	/** True when credentials are typed in a form hosted by INGInious (`/auth/page/<id>`, LDAP). */
	form?: boolean;
	/** Returns the URL where the browser starts the flow; may keep state in `storage`. */
	authLink(storage: AuthStorage, url: URL): Promise<string>;
	/** Checks the provider answer: the user, an error message to display (form methods) or null. */
	callback(storage: AuthStorage, input: CallbackInput): Promise<ExternalUser | string | null>;
	/** Service provider metadata document (SAML), if any. */
	metadata?(url: URL): string;
}

/** Registered auth methods by id, in configuration order (button order); plugins add theirs in `init`. */
export const authMethods = new Map<string, AuthMethod>();

/** Public description of the methods, for sign-in buttons and the bindings page. */
export function methodList(): { id: string; name: string; imlink: string | null }[] {
	return [...authMethods.values()].map((m) => ({ id: m.id, name: m.name, imlink: m.imlink ?? null }));
}

/** Error shown when the provider did not return a usable identity. */
const fetchError = () =>
	t(
		"Couldn't fetch the required information from the service. Please check the provided permissions (name, email) and contact your INGInious administrator if the error persists."
	);

/** Error shown when the e-mail address of a new identity belongs to an account not bound with the method. */
const bindError = () =>
	t(
		'An account using this email already exists and is not bound with this service. For security reasons, please log in via another method and bind your account in your profile.'
	);

/**
 * Signs in, binds or creates the account of an external identity (legacy `bind_user`).
 * New accounts are built by `newUserDoc` (same policy as the other account
 * creations), without username: the profile page asks for one (AUTH-11).
 * @returns null on success, else the error message: unusable identity,
 *          e-mail already used by a non-bound account while nobody is logged
 *          in (the legacy "binderror" case), or unverified e-mail address of a
 *          new identity while nobody is logged in.
 */
export async function bindUser(session: Session, authId: string, user: ExternalUser): Promise<string | null> {
	const c = services().db.c;
	if (!user.id || !sanitizeEmail(user.email)) return fetchError();
	const key = `bindings.${authId}`;
	const binding = { [key]: [user.id, user.additional ?? {}] };
	const doc = session.doc;
	const profile = await c.users.findOne({ [`${key}.0`]: user.id });
	const account = doc.loggedin ? await sessionAccount(session) : null;
	if (profile && !doc.loggedin) await connectUser(session, profile);
	else if (profile && account?._id?.equals(profile._id!))
		await c.users.updateOne({ _id: profile._id }, { $set: binding });
	else if (profile) console.warn('Tried to bind an already bound account !');
	else if (account) await c.users.updateOne({ _id: account._id }, { $set: binding });
	else if (doc.loggedin) return t('Incorrect email.');
	else if (user.emailVerified === false)
		return t(
			'This service does not confirm that your e-mail address is verified. Please sign up with another method, then bind this service in your profile.'
		);
	else if (await c.users.findOne({ email: sanitizeEmail(user.email)! })) return bindError();
	else {
		const created = await newUserDoc({
			...user,
			username: '',
			bindings: { [authId]: binding[key] },
			language: doc.language,
			timezone: doc.timezone
		});
		if (typeof created === 'string') return fetchError();
		// Same answer when the address was taken concurrently (unique index).
		if (!(await insertUser(created))) return bindError();
		await connectUser(session, created);
	}
	return null;
}

/**
 * Removes a binding of an account (AUTH-12, SITE-05), designated by its
 * document (never by a possibly empty username). The last binding of an
 * account without password cannot be removed. Unlike legacy, bindings of
 * methods that are no longer configured can be removed too.
 * @returns an error message, or null on success.
 */
export async function revokeBinding(user: UserDoc | null, id: string): Promise<string | null> {
	if (!user || !Object.hasOwn(user.bindings ?? {}, id)) return t('Incorrect authentication binding.');
	if (Object.keys(user.bindings).length < 2 && !user.password)
		return t('You must set a password before removing all bindings.');
	await services().db.c.users.updateOne({ _id: user._id }, { $unset: { [`bindings.${id}`]: '' } });
	return null;
}

/**
 * Starts the flow of a method (POST /auth/signin/<id>).
 * @param target same-site path to come back to at the end.
 * @returns the URL to redirect the browser to.
 */
export async function startAuth(
	session: Session,
	method: AuthMethod,
	target: string | null,
	url: URL
): Promise<string> {
	const storage: AuthStorage = { redir_url: safeRedirectTarget(target, '/') };
	const link = await method.authLink(storage, url);
	session.doc.auth_storage = { ...session.doc.auth_storage, [method.id]: storage };
	services().sessions.markDirty(session);
	return link;
}

/**
 * Completes the flow of a method (callback or LDAP form).
 * @returns `location` to redirect to (with an `error` to flash when the provider
 *          failed), or only `error` when a form method must show its form again.
 */
export async function finishAuth(
	session: Session,
	method: AuthMethod,
	input: CallbackInput
): Promise<{ location?: string; error?: string }> {
	const storage = (session.doc.auth_storage?.[method.id] ?? {}) as AuthStorage;
	const result = await method.callback(storage, input).catch((e) => (console.error(e), null));
	if (typeof result === 'string') return { error: result };
	delete session.doc.auth_storage?.[method.id];
	services().sessions.markDirty(session);
	const back = safeRedirectTarget(storage.redir_url as string, '/');
	const error = result ? await bindUser(session, method.id, result) : fetchError();
	return error ? { location: session.doc.loggedin ? back : '/signin', error } : { location: back };
}

/** The registered method `id`, or a 404 (legacy answered 500); LTI sessions are refused. */
export function requireMethod(id: string, event: GuardEvent): AuthMethod {
	forbidLti(event);
	return authMethods.get(id) ?? error(404, t("Auth method doesn't exist"));
}

/** Ends a flow: flashes the error, if any, and redirects (`finishAuth` result). */
export function endAuth(cookies: Cookies, result: { location?: string; error?: string }): never {
	if (result.error) setFlash(cookies, 'error', result.error);
	redirect(303, result.location ?? '/signin');
}
