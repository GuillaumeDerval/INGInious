/**
 * Server-side sessions stored in the legacy `sessions` collection (AUTH-04).
 *
 * The document format is unchanged (ObjectId `_id`, `loggedin`, `username`, `lti`,
 * TTL index on `expiration`...); the session rules are
 * (docs/features/auth/04-sessions.md, "Permissions & security"):
 *  - the cookie value is `<id>.<HMAC-SHA256(secret, id)>`; predictable ObjectIds
 *    are therefore useless without the server secret;
 *  - the LTI cookieless `session_id` parameter must carry the same signature and
 *    is only accepted for sessions flagged `is_lti`;
 *  - the session id is rotated when a user logs in;
 *  - anonymous sessions are only written to MongoDB once they hold data, and the
 *    sliding expiration is refreshed at most once a minute (no write per request).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { stringifySetCookie } from 'cookie';
import type { Database } from '../db/index.js';
import type { SessionDoc } from '../db/types.js';
import type { SessionConfig } from '../config.js';

/** Minimum delay between two refreshes of the sliding expiration (ms). */
const REFRESH_INTERVAL = 60_000;

/** A session loaded for the current request. */
export interface Session {
	/** The session document (mutate it, then call `markDirty`). */
	doc: SessionDoc;
	/** True when the document exists in MongoDB. */
	stored: boolean;
	/** True when the document must be written back at the end of the request. */
	dirty: boolean;
	/** True when the session was destroyed during the request (cookie must be cleared). */
	destroyed?: boolean;
}

/** Default content of a new session (legacy mongoengine defaults). */
function newSessionDoc(isLti = false): SessionDoc {
	return {
		_id: new ObjectId(),
		permanent: true,
		is_lti: isLti,
		loggedin: false,
		auth_storage: {},
		code_indentation: '4',
		language: '',
		token: null,
		username: null,
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
	};
}

/** Creates, loads, signs and persists sessions. One instance per process. */
export class SessionStore {
	/**
	 * @param database connected database.
	 * @param cfg `session_parameters` of the configuration.
	 */
	constructor(
		private readonly database: Database,
		private readonly cfg: SessionConfig
	) {}

	/** Signs a session id: returns the token `<id>.<signature>` used in cookies and LTI URLs. */
	sign(id: ObjectId): string {
		const mac = createHmac('sha256', this.cfg.secretKey).update(id.toHexString()).digest('base64url');
		return `${id.toHexString()}.${mac}`;
	}

	/** Verifies a token produced by `sign` (constant time); returns the session id or null. */
	verify(token: string | null | undefined): ObjectId | null {
		const match = /^([0-9a-f]{24})\.([A-Za-z0-9_-]{43})$/.exec(token ?? '');
		if (!match) return null;
		const id = new ObjectId(match[1]);
		const expected = Buffer.from(this.sign(id));
		const given = Buffer.from(token!);
		return timingSafeEqual(expected, given) ? id : null;
	}

	/** Returns a new, not yet stored, session. */
	create(isLti = false): Session {
		return { doc: newSessionDoc(isLti), stored: false, dirty: isLti };
	}

	/**
	 * Loads the session of a request.
	 * @param cookieToken signed token read from the session cookie.
	 * @param ltiToken signed token read from the `session_id` query parameter (LTI iframes).
	 * @returns the stored session, or a new anonymous one when the tokens are
	 *          missing, forged, expired or unknown.
	 */
	async load(cookieToken?: string | null, ltiToken?: string | null): Promise<Session> {
		const ltiId = this.verify(ltiToken);
		const id = ltiId ?? this.verify(cookieToken);
		if (!id) return this.create();
		const doc = await this.database.c.sessions.findOne({ _id: id });
		if (!doc || (ltiId && !doc.is_lti)) return this.create();
		if (doc.expiration && doc.expiration.getTime() <= Date.now()) {
			await this.database.c.sessions.deleteOne({ _id: id });
			return this.create();
		}
		const stale = !doc.expiration || doc.expiration.getTime() - this.cfg.timeout * 1000 + REFRESH_INTERVAL < Date.now();
		return { doc, stored: true, dirty: stale };
	}

	/** Flags the session as modified so that `save` persists it. */
	markDirty(session: Session): void {
		session.dirty = true;
	}

	/**
	 * Writes the session back when needed (the expiration slides to now + timeout,
	 * like the legacy `save_session`) and returns the `Set-Cookie` header value to
	 * send, or null when the cookie does not change. LTI sessions never get a cookie.
	 * Called by hooks.server.ts once the response is built.
	 */
	async commit(session: Session): Promise<string | null> {
		const opts = {
			path: this.cfg.cookiePath,
			domain: this.cfg.cookieDomain,
			httpOnly: this.cfg.httpOnly,
			secure: this.cfg.secure,
			sameSite: this.cfg.sameSite
		};
		if (!session.dirty) {
			return session.destroyed
				? stringifySetCookie({ name: this.cfg.cookieName, value: '', ...opts, expires: new Date(0) })
				: null;
		}
		const expiration = new Date(Date.now() + this.cfg.timeout * 1000);
		session.doc.expiration = expiration;
		await this.database.c.sessions.replaceOne({ _id: session.doc._id }, session.doc, { upsert: true });
		session.stored = true;
		session.dirty = false;
		if (session.doc.is_lti) return null;
		return stringifySetCookie({
			name: this.cfg.cookieName,
			value: this.sign(session.doc._id),
			...opts,
			expires: expiration
		});
	}

	/**
	 * Gives the session a new id (called at login/privilege change to prevent
	 * session fixation). The old document is deleted.
	 */
	async rotate(session: Session): Promise<void> {
		if (session.stored) await this.database.c.sessions.deleteOne({ _id: session.doc._id });
		session.doc._id = new ObjectId();
		session.stored = false;
		session.dirty = true;
	}

	/** Deletes a session (logout); `commit` will then clear the cookie. */
	async destroy(session: Session): Promise<void> {
		await this.database.c.sessions.deleteOne({ _id: session.doc._id });
		session.doc = newSessionDoc();
		session.stored = false;
		session.dirty = false;
		session.destroyed = true;
	}
}
