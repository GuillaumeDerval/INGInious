/**
 * Rich text preview of the admin editors (RichTextInput): POST the stored text
 * (RST, or Markdown with the `#MD` marker), get the sanitized HTML. Staff only.
 */
import { requireCourseStaff } from '#lib/server/courses/access.js';
import { renderText } from '#lib/server/text/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	await requireCourseStaff(event, event.params.courseid);
	return new Response(renderText(await event.request.text(), { language: event.locals.lang }), {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});
};
