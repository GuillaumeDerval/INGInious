/**
 * Application configuration.
 *
 * The new frontend reads the very same `configuration.yaml` as the legacy Python
 * webapp (see legacy/inginious/frontend/app.py `_put_configuration_defaults` and
 * docs/reference/config.md), so it can replace it without migration. The file is
 * located through the `INGINIOUS_CONFIG` environment variable (default
 * `./configuration.yaml`). Only the keys used by the frontend are typed here; the
 * raw document stays available for plugins (`config.raw`).
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/** One entry of the `plugins:` list (`plugin_module` + plugin specific options). */
export interface PluginConfig {
	plugin_module: string;
	[option: string]: unknown;
}

/** SMTP settings (`smtp:` section). */
export interface SmtpConfig {
	host: string;
	port: number;
	starttls: boolean;
	usessl: boolean;
	username?: string;
	password?: string;
	sendername: string;
}

/** Session cookie settings (`session_parameters:` section). */
export interface SessionConfig {
	secretKey: string;
	/** Session lifetime in seconds. */
	timeout: number;
	cookieName: string;
	cookieDomain?: string;
	cookiePath: string;
	sameSite: 'lax' | 'strict' | 'none';
	httpOnly: boolean;
	secure: boolean;
}

/** Typed view of configuration.yaml. */
export interface AppConfig {
	/** Address of the backend client socket (e.g. tcp://backend:2000). */
	backend: string;
	mongo: { host: string; database: string };
	tasksDirectory: string;
	backupDirectory: string;
	superadmins: string[];
	session: SessionConfig;
	allowedFileExtensions: string[];
	/** Maximum size of an uploaded file, in bytes. */
	maxFileSize: number;
	allowDeletion: boolean;
	allowRegistration: boolean;
	maintenance: boolean;
	plugins: PluginConfig[];
	smtp: SmtpConfig | null;
	/** LTI 1.3 platform configuration (`lti_config`), passed as is. */
	ltiConfig: Record<string, unknown>;
	privacyPage?: string;
	termsPage?: string;
	welcomePage?: string;
	webdavHost?: string;
	webterm?: string;
	sentryIoUrl?: string;
	/** True when both terms and privacy pages are defined (legacy IS_TOS_DEFINED). */
	isTosDefined: boolean;
	/** Raw parsed document, for plugins and less common keys. */
	raw: Record<string, unknown>;
}

/** Reads a YAML key with a default value (`fallback` when absent or null); shared with course.yaml. */
export function get<T>(obj: Record<string, unknown>, key: string, fallback: T): T {
	return (obj[key] ?? fallback) as T;
}

/**
 * Builds the typed configuration from a parsed YAML document, applying the
 * same defaults as the legacy webapp.
 * @throws when the mandatory `session_parameters.secret_key` is missing or the
 *         backend is "local" (not supported: the backend must run separately).
 */
export function buildConfig(raw: Record<string, unknown>): AppConfig {
	const sp = get<Record<string, unknown>>(raw, 'session_parameters', {});
	if (!sp.secret_key) throw new Error('session_parameters.secret_key must be defined in the configuration');
	const backend = get(raw, 'backend', 'local');
	if (backend === 'local')
		throw new Error('backend: "local" is not supported; point "backend" to a running inginious-backend');
	const smtp = raw.smtp as Record<string, unknown> | undefined;
	const mongo = get<Record<string, unknown>>(raw, 'mongo_opt', {});
	const optional = (key: string) => (raw[key] === undefined ? undefined : String(raw[key]));
	const privacyPage = optional('privacy_page');
	const termsPage = optional('terms_page');
	return {
		backend: String(backend),
		mongo: { host: String(get(mongo, 'host', 'localhost')), database: String(get(mongo, 'database', 'INGInious')) },
		tasksDirectory: String(get(raw, 'tasks_directory', './tasks')),
		backupDirectory: String(get(raw, 'backup_directory', './backup')),
		superadmins: get<string[]>(raw, 'superadmins', []).map(String),
		session: {
			secretKey: String(sp.secret_key),
			timeout: Number(get(sp, 'timeout', 86400)),
			cookieName: String(get(sp, 'cookie_name', 'inginious_session_id')),
			cookieDomain: sp.cookie_domain ? String(sp.cookie_domain) : undefined,
			cookiePath: String(get(sp, 'cookie_path', '/')),
			sameSite: String(get(sp, 'samesite', 'Lax')).toLowerCase() as SessionConfig['sameSite'],
			httpOnly: Boolean(get(sp, 'httponly', true)),
			secure: Boolean(get(sp, 'secure', false))
		},
		allowedFileExtensions: get(raw, 'allowed_file_extensions', [
			'.c',
			'.cpp',
			'.java',
			'.oz',
			'.zip',
			'.tar.gz',
			'.tar.bz2',
			'.txt'
		]),
		maxFileSize: Number(get(raw, 'max_file_size', 1024 * 1024)),
		allowDeletion: Boolean(get(raw, 'allow_deletion', true)),
		allowRegistration: Boolean(get(raw, 'allow_registration', true)),
		maintenance: Boolean(get(raw, 'maintenance', false)),
		plugins: get<PluginConfig[]>(raw, 'plugins', []),
		smtp: smtp
			? {
					host: String(smtp.host),
					port: Number(smtp.port),
					starttls: Boolean(smtp.starttls ?? false),
					usessl: Boolean(smtp.usessl ?? false),
					username: smtp.username ? String(smtp.username) : undefined,
					password: smtp.password ? String(smtp.password) : undefined,
					sendername: String(smtp.sendername ?? 'no-reply@ingnious.org')
				}
			: null,
		ltiConfig: get(raw, 'lti_config', {}),
		privacyPage,
		termsPage,
		welcomePage: optional('welcome_page'),
		webdavHost: optional('webdav_host'),
		webterm: optional('webterm'),
		sentryIoUrl: optional('sentry_io_url'),
		isTosDefined: privacyPage !== undefined && termsPage !== undefined,
		raw
	};
}

/** Loads and parses a configuration file. */
export function loadConfig(path: string): AppConfig {
	return buildConfig((parse(readFileSync(path, 'utf8')) ?? {}) as Record<string, unknown>);
}

let current: AppConfig | null = null;

/** Returns the process-wide configuration (loaded lazily from INGINIOUS_CONFIG). */
export function config(): AppConfig {
	current ??= loadConfig(process.env.INGINIOUS_CONFIG ?? './configuration.yaml');
	return current;
}

/** Replaces the process-wide configuration (tests and plugins reloading). */
export function setConfig(cfg: AppConfig | null): void {
	current = cfg;
}
