/**
 * Outgoing e-mail (CORE-05) through the SMTP server of the `smtp:` configuration
 * section (host, port, starttls, usessl, username, password, sendername).
 *
 * Messages are plain text, like legacy. Links inside e-mails (and external sign-in
 * callbacks) must be built with `publicUrl()`, which never trusts the Host header
 * (docs/features/core/05-mail-sending.md).
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { services } from './app.js';

/** A message to send. */
export interface Mail {
	/** Recipient e-mail address. */
	to: string;
	/** Recipient display name (optional). */
	name?: string;
	subject: string;
	text: string;
}

let transporter: Transporter | null = null;
let transporterKey = '';

/** Returns the SMTP transport for the current configuration (cached). */
function transport(): Transporter {
	const smtp = services().config.smtp;
	if (!smtp) throw new Error('No smtp section in the configuration');
	const key = JSON.stringify(smtp);
	if (!transporter || key !== transporterKey) {
		transporter = nodemailer.createTransport({
			host: smtp.host,
			port: smtp.port,
			secure: smtp.usessl,
			requireTLS: smtp.starttls,
			ignoreTLS: !smtp.starttls && !smtp.usessl,
			auth: smtp.username ? { user: smtp.username, pass: smtp.password ?? '' } : undefined,
			connectionTimeout: 10_000
		});
		transporterKey = key;
	}
	return transporter;
}

/**
 * Sends one e-mail. Rejects when no SMTP server is configured or when sending
 * fails, so that callers can roll back (e.g. account creation, AUTH-07).
 */
export async function sendMail(mail: Mail): Promise<void> {
	const from = services().config.smtp?.sendername;
	await transport().sendMail({
		from,
		to: mail.name ? { name: mail.name, address: mail.to } : mail.to,
		subject: mail.subject,
		text: mail.text
	});
}

/** Thrown by `publicUrl` when the public origin of the application is unknown. */
export class PublicUrlError extends Error {}

/** Development hosts whose request origin may be used as is. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Absolute URL of an application path for use in e-mails: `base_url` from the
 * configuration, else the deployment origin from the environment (`APP_ORIGIN`, the value
 * also baked as SvelteKit `paths.origin` at build time, or `ORIGIN`), else — for localhost
 * development only — the request origin.
 * @param path absolute path of the application (starting with "/").
 * @throws PublicUrlError (logged) when none applies: the Host header is never trusted.
 */
export function publicUrl(path: string, requestUrl: URL): string {
	const local = LOCAL_HOSTS.has(requestUrl.hostname) ? requestUrl.origin : null;
	const base = services().config.raw.base_url ?? (process.env.ORIGIN || process.env.APP_ORIGIN || local);
	if (!base) {
		console.error('Cannot build links for e-mails: set `base_url` in configuration.yaml (or the APP_ORIGIN variable)');
		throw new PublicUrlError('base_url is not configured');
	}
	return String(base).replace(/\/+$/, '') + path;
}
