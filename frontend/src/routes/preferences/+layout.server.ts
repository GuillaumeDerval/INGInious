/**
 * Preferences section (AUTH-11, AUTH-12, AUTH-13): guard and tabs
 * (profile, sign-in methods, and the isolated "Delete my account" when allowed).
 */
import { services } from '#lib/server/app.js';
import { requireSession } from '#lib/server/auth/profile.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	requireSession(event);
	return { allowDeletion: services().config.allowDeletion };
};
