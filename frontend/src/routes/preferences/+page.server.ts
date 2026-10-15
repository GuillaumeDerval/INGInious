/** `/preferences` opens the profile (AUTH-11). */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(302, '/preferences/profile');
