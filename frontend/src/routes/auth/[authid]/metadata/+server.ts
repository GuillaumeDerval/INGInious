/** Service provider metadata of the SAML auth methods (AUTH-17). */
import { error } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { requireMethod } from '#lib/server/auth/external.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	const method = requireMethod(event.params.authid, event);
	if (!method.metadata) error(404, t("Auth method doesn't exist"));
	return new Response(method.metadata(event.url), { headers: { 'Content-Type': 'text/xml' } });
};
