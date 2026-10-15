// Global types of the SvelteKit application.
// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Session } from '#lib/server/auth/session.js';

/** The logged-in user of the current request (derived from the session). */
export interface CurrentUser {
	username: string;
	realname: string;
	email: string;
	language: string;
	timezone: string;
	/** Code indentation preference: "2", "3", "4" or "tabs". */
	codeIndentation: string;
	/** True when the user is listed in the `superadmins` configuration. */
	superadmin: boolean;
}

declare global {
	namespace App {
		/** Per-request data computed by hooks.server.ts. */
		interface Locals {
			/** Server-side session (sessions collection). */
			session: Session;
			/** Logged-in user, or null for anonymous visitors. */
			user: CurrentUser | null;
			/** UI language code (see #lib/i18n). */
			lang: string;
		}
		/** Shape of errors shown by +error.svelte. */
		interface Error {
			message: string;
			status: number;
		}
	}
}

export {};
