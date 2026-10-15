/**
 * Legacy alias `/index` of the home page (AUTH-01): permanent redirect to `/`.
 */
import { redirect } from '@sveltejs/kit';

/** Redirects to the home page. */
export const load = () => redirect(301, '/');
