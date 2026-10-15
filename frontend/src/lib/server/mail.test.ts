/**
 * Tests of the mail module against the Mailpit SMTP catcher of the Colima stack
 * (SMTP localhost:1025, REST API localhost:8025).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { setServices, type Services } from './app.js';
import { buildConfig } from './config.js';
import { sendMail, publicUrl, PublicUrlError } from './mail.js';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/** Installs a configuration with the given extra keys. */
function configure(extra: Record<string, unknown>) {
	setServices({
		config: buildConfig({ backend: 'tcp://x:1', session_parameters: { secret_key: 'k' }, ...extra })
	} as Services);
}
afterAll(() => setServices(null));

describe('sendMail', () => {
	it('delivers plain-text mails through SMTP', async () => {
		configure({ smtp: { host: 'localhost', port: 1025, sendername: 'INGInious <no-reply@inginious.local>' } });
		const subject = `Test ${randomBytes(6).toString('hex')}`;
		await sendMail({ to: 'alice@example.org', name: 'Alice Doe', subject, text: 'Hello\nworld' });
		await sendMail({ to: 'bob@example.org', subject: subject + ' 2', text: 'x' });
		const search = await (
			await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`)
		).json();
		const message = search.messages.find((m: { Subject: string }) => m.Subject === subject);
		expect(message.From.Address).toBe('no-reply@inginious.local');
		expect(message.To[0]).toMatchObject({ Name: 'Alice Doe', Address: 'alice@example.org' });
		const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
		expect(full.Text.trim()).toBe('Hello\r\nworld');
		expect(full.HTML).toBe('');
		await fetch(`${MAILPIT}/api/v1/messages`, {
			method: 'DELETE',
			body: JSON.stringify({ IDs: search.messages.map((m: { ID: string }) => m.ID) })
		});
	});

	it('reuses the transport and supports authentication settings', async () => {
		configure({ smtp: { host: 'localhost', port: 1, username: 'u', password: 'p' } });
		await expect(sendMail({ to: 'a@b.c', subject: 's', text: 't' })).rejects.toThrow();
		await expect(sendMail({ to: 'a@b.c', subject: 's', text: 't' })).rejects.toThrow();
		configure({ smtp: { host: 'localhost', port: 1, starttls: true } });
		await expect(sendMail({ to: 'a@b.c', subject: 's', text: 't' })).rejects.toThrow();
		configure({ smtp: { host: 'localhost', port: 1, usessl: true, username: 'only-user' } });
		await expect(sendMail({ to: 'a@b.c', subject: 's', text: 't' })).rejects.toThrow();
	});

	it('fails without smtp configuration', async () => {
		configure({});
		await expect(sendMail({ to: 'a@b.c', subject: 's', text: 't' })).rejects.toThrow(/smtp/);
	});
});

describe('publicUrl', () => {
	it('prefers the configured base_url over the request origin', () => {
		configure({ base_url: 'https://inginious.example.org/' });
		expect(publicUrl('/register?reset=x', new URL('http://evil.example/'))).toBe(
			'https://inginious.example.org/register?reset=x'
		);
		configure({});
		expect(publicUrl('/register', new URL('http://localhost:5173/a/b'))).toBe('http://localhost:5173/register');
	});

	it('never uses a foreign Host header: deployment origin, else refusal', () => {
		configure({});
		const env = { ...process.env };
		try {
			delete process.env.ORIGIN;
			delete process.env.APP_ORIGIN;
			expect(() => publicUrl('/x', new URL('http://evil.example/'))).toThrow(PublicUrlError);
			process.env.APP_ORIGIN = 'https://app.example';
			expect(publicUrl('/x', new URL('http://evil.example/'))).toBe('https://app.example/x');
			process.env.ORIGIN = 'https://origin.example/';
			expect(publicUrl('/x', new URL('http://localhost/'))).toBe('https://origin.example/x');
		} finally {
			process.env = env;
		}
	});
});
