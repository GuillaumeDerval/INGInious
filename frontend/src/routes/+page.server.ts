/**
 * Home page (AUTH-01): the configured `welcome_page` static page, or a
 * redirection to the course list when none is configured.
 */
import { redirect } from '@sveltejs/kit';
import { services } from '#lib/server/app.js';
import { requireStaticPage } from '#lib/server/auth/static-pages.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const id = services().config.welcomePage;
	return id ? requireStaticPage(id, locals.lang) : redirect(302, '/courselist');
};
