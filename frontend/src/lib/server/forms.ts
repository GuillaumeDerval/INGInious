/**
 * Form and download helpers of the form actions and endpoints: text and JSON
 * fields of a posted form, uploaded text files, and attachment responses
 * (RFC 5987 file names, `nosniff`, so uploaded HTML is never rendered on the site).
 */
import { error } from '@sveltejs/kit';
import type { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import { attempt } from './attempt.js';

/** Parses the posted form with a zod schema; malformed submissions get a 400 (like legacy KeyErrors). */
export async function parseForm<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
	const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
	return parsed.success ? parsed.data : error(400, t('Invalid form data.'));
}

/** Text of a form field ('' when absent; not trimmed). */
export const formText = (form: FormData, name: string): string => String(form.get(name) ?? '');

/** Parses the JSON form field `name` with a zod schema (null when absent, malformed or invalid). */
export function jsonField<S extends z.ZodType>(form: FormData, name: string, schema: S): z.output<S> | null {
	const parsed = schema.safeParse(
		attempt(
			() => JSON.parse(formText(form, name)),
			() => undefined
		)
	);
	return parsed.success ? parsed.data : null;
}

/** Text of the uploaded file `name` of a form, null without (non-empty) file. */
export async function uploadText(form: FormData, name: string): Promise<string | null> {
	const file = form.get(name);
	return file instanceof File && file.size ? file.text() : null;
}

/** `Content-Disposition` value with an ASCII fallback and the RFC 5987 encoded file name. */
export function disposition(kind: 'inline' | 'attachment', name: string): string {
	return `${kind}; filename="${name.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Attachment response (`nosniff`: the browser never renders it as another type). */
export function download(body: BodyInit, name: string, type = 'application/octet-stream'): Response {
	return new Response(body, {
		headers: {
			'Content-Type': type,
			'Content-Disposition': disposition('attachment', name),
			'X-Content-Type-Options': 'nosniff'
		}
	});
}
