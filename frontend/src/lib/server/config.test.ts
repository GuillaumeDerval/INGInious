/**
 * Unit tests of the configuration loader (legacy configuration.yaml compatibility).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig, loadConfig, config, setConfig } from './config.js';

const minimal = { backend: 'tcp://backend:2000', session_parameters: { secret_key: 's3cret' } };

describe('buildConfig', () => {
	it('applies the legacy defaults', () => {
		const c = buildConfig(minimal);
		expect(c).toMatchObject({
			backend: 'tcp://backend:2000',
			mongo: { host: 'localhost', database: 'INGInious' },
			tasksDirectory: './tasks',
			superadmins: [],
			allowedFileExtensions: ['.c', '.cpp', '.java', '.oz', '.zip', '.tar.gz', '.tar.bz2', '.txt'],
			maxFileSize: 1048576,
			allowDeletion: true,
			allowRegistration: true,
			passwordMinLength: 10,
			webdavAllowHttp: false,
			maintenance: false,
			plugins: [],
			smtp: null,
			ltiConfig: {},
			isTosDefined: false,
			session: {
				secretKey: 's3cret',
				timeout: 86400,
				maxLifetime: 7 * 86400,
				cookieName: 'inginious_session_id',
				cookiePath: '/',
				sameSite: 'lax',
				httpOnly: true,
				secure: null
			}
		});
		expect(c.session.cookieDomain).toBeUndefined();
		expect(c.welcomePage).toBeUndefined();
	});

	it('makes the session cookie Secure by default on https deployments only', () => {
		const secure = (raw: Record<string, unknown>, sp: Record<string, unknown> = {}) =>
			buildConfig({ ...minimal, ...raw, session_parameters: { secret_key: 'k', ...sp } }).session.secure;
		expect(secure({ base_url: 'https://inginious.example' })).toBe(true);
		// Not configured and no https public URL: decided per request.
		expect(secure({ base_url: 'http://inginious.example' })).toBeNull();
		expect(secure({ base_url: 'https://inginious.example' }, { secure: false })).toBe(false);
		expect(secure({}, { secure: true })).toBe(true);
		process.env.APP_ORIGIN = 'https://app.example';
		expect(secure({})).toBe(true);
		delete process.env.APP_ORIGIN;
	});

	it('reads every supported key', () => {
		const c = buildConfig({
			...minimal,
			mongo_opt: { host: 'db', database: 'X' },
			tasks_directory: '/t',
			backup_directory: '/b',
			superadmins: ['root'],
			session_parameters: {
				secret_key: 'k',
				timeout: 10,
				max_lifetime: 3600,
				cookie_name: 'sid',
				cookie_domain: 'example.org',
				cookie_path: '/app',
				samesite: 'Strict',
				httponly: false,
				secure: true
			},
			allowed_file_extensions: ['.py'],
			max_file_size: 10,
			allow_deletion: false,
			allow_registration: false,
			password_min_length: 12,
			webdav_allow_http: true,
			maintenance: true,
			plugins: [{ plugin_module: 'inginious.frontend.plugins.scoreboard' }],
			smtp: { host: 'mail', port: '25', username: 'u', password: 'p', starttls: true, usessl: true, sendername: 'me' },
			lti_config: { a: 1 },
			privacy_page: 'privacy',
			terms_page: 'terms',
			welcome_page: 'welcome',
			webdav_host: 'http://dav',
			webterm: 'http://term',
			sentry_io_url: 'http://sentry'
		});
		expect(c).toMatchObject({
			mongo: { host: 'db', database: 'X' },
			tasksDirectory: '/t',
			backupDirectory: '/b',
			superadmins: ['root'],
			session: {
				secretKey: 'k',
				timeout: 10,
				maxLifetime: 3600,
				cookieName: 'sid',
				cookieDomain: 'example.org',
				cookiePath: '/app',
				sameSite: 'strict',
				httpOnly: false,
				secure: true
			},
			allowedFileExtensions: ['.py'],
			maxFileSize: 10,
			allowDeletion: false,
			allowRegistration: false,
			passwordMinLength: 12,
			webdavAllowHttp: true,
			maintenance: true,
			smtp: { host: 'mail', port: 25, username: 'u', password: 'p', starttls: true, usessl: true, sendername: 'me' },
			ltiConfig: { a: 1 },
			isTosDefined: true,
			welcomePage: 'welcome',
			webdavHost: 'http://dav',
			webterm: 'http://term',
			sentryIoUrl: 'http://sentry'
		});
		expect(c.plugins[0].plugin_module).toBe('inginious.frontend.plugins.scoreboard');
	});

	it('uses smtp defaults', () => {
		const c = buildConfig({ ...minimal, smtp: { host: 'h', port: 1 } });
		expect(c.smtp).toEqual({
			host: 'h',
			port: 1,
			starttls: false,
			usessl: false,
			username: undefined,
			password: undefined,
			sendername: 'no-reply@ingnious.org'
		});
	});

	it('requires a secret key and a remote backend', () => {
		expect(() => buildConfig({ backend: 'tcp://x:1' })).toThrow(/secret_key/);
		expect(() => buildConfig({ session_parameters: { secret_key: 'a' } })).toThrow(/local/);
	});
});

describe('loadConfig / config()', () => {
	afterEach(() => {
		setConfig(null);
		delete process.env.INGINIOUS_CONFIG;
	});

	it('parses a YAML file and caches the process configuration', () => {
		const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
		const file = join(dir, 'configuration.yaml');
		writeFileSync(file, 'backend: tcp://b:2000\nsession_parameters:\n  secret_key: abc\nsuperadmins: [admin]\n');
		expect(loadConfig(file).superadmins).toEqual(['admin']);
		process.env.INGINIOUS_CONFIG = file;
		const c = config();
		expect(c.backend).toBe('tcp://b:2000');
		expect(config()).toBe(c);
	});

	it('rejects an empty file', () => {
		const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
		const file = join(dir, 'empty.yaml');
		writeFileSync(file, '');
		expect(() => loadConfig(file)).toThrow(/secret_key/);
	});
});
