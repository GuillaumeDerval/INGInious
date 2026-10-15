/**
 * Process-wide services of the server (configuration, database, sessions,
 * backend client), created once by `init` in hooks.server.ts. Feature code
 * obtains them with `services()`; tests install their own with `setServices()`.
 */
import { Dealer } from 'zeromq';
import { config as loadConfig, type AppConfig } from './config.js';
import { connectDatabase, closeDatabase, type Database } from './db/index.js';
import { SessionStore } from './auth/session.js';
import { BackendClient, type DealerLike } from './backend/client.js';
import { plugins, BUNDLED } from './plugins/index.js';

/** The set of singletons shared by every request. */
export interface Services {
	config: AppConfig;
	db: Database;
	sessions: SessionStore;
	backend: BackendClient;
}

let current: Services | null = null;

/** Builds the MongoDB URL from `mongo_opt.host` (a host name or a full URI, like pymongo). */
export function mongoUrl(host: string): string {
	return /^mongodb(\+srv)?:\/\//.test(host) ? host : `mongodb://${host}`;
}

/**
 * Connects to MongoDB and to the backend (once, from the `init` server hook).
 * @param cfg configuration to use (defaults to INGINIOUS_CONFIG).
 */
export async function initServices(cfg: AppConfig = loadConfig()): Promise<Services> {
	const db = await connectDatabase(mongoUrl(cfg.mongo.host), cfg.mongo.database);
	const backend = new BackendClient(cfg.backend, {
		socketFactory: () => new Dealer({ ipv6: true, linger: 0 }) as unknown as DealerLike
	});
	backend.start();
	current = { config: cfg, db, sessions: new SessionStore(db, cfg.session), backend };
	// Like legacy, plugins are not loaded in maintenance mode.
	if (!cfg.maintenance) await plugins().load(cfg.plugins, BUNDLED);
	// adapter-node emits this event on SIGINT/SIGTERM once the HTTP server is closed:
	// release every handle so that the process exits cleanly (and flushes V8 coverage).
	process.once('sveltekit:shutdown' as 'beforeExit', () => void shutdownServices());
	return current;
}

/** Waits for the job results being stored, then disconnects from the backend and MongoDB (once, at shutdown). */
export async function shutdownServices(): Promise<void> {
	// Dynamic import: the submission manager itself depends on this module.
	await (await import('./submissions/manager.js')).settled();
	current!.backend.close();
	current = null;
	await closeDatabase();
}

/** Returns the initialised services; throws when `initServices` was not called. */
export function services(): Services {
	if (!current) throw new Error('Services not initialised');
	return current;
}

/** Replaces the services (unit tests). */
export function setServices(s: Services | null): void {
	current = s;
}
