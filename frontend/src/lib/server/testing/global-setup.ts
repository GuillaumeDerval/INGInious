/**
 * Global setup of the server test project: removes stale throw-away databases.
 */
import { dropStaleTestDatabases } from './db.js';

export default async function setup(): Promise<void> {
	await dropStaleTestDatabases();
}
