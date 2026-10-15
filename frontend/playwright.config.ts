/**
 * Integration tests (Playwright) of the new frontend.
 *
 * The production build (`vite build`, adapter-node) is started against the
 * Colima stack (MongoDB + unchanged backend + grading agents). Each run is
 * isolated by `E2E_ID` (database INGInious_e2e[_<id>], port, build and coverage
 * directories) so that several runs can execute in parallel. The configuration
 * file given to the app is generated from e2e/config.yaml with the run's database.
 * Server-side V8 coverage goes to <coverageDir>/server-raw (NODE_V8_COVERAGE),
 * browser coverage is collected by e2e/fixtures.ts, e2e/coverage-report.mjs merges both.
 */
import { defineConfig, devices } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { E2E, E2E_ID } from './e2e/setup-data.js';

// Configuration of the app for this run (database name differs per run).
mkdirSync('e2e/.generated', { recursive: true });
const configFile = `e2e/.generated/config-${E2E_ID}.yaml`;
const config = parse(readFileSync('e2e/config.yaml', 'utf8'));
config.mongo_opt.database = E2E.database;
config.tasks_directory = E2E.tasksDir;
config.backup_directory = E2E.backupDir;
writeFileSync(configFile, stringify(config));

export default defineConfig({
	testDir: 'e2e',
	// Parallel runs must not share their artifacts directory (traces, screenshots).
	outputDir: `test-results/${E2E_ID}`,
	testMatch: '**/*.e2e.ts',
	timeout: 60_000,
	expect: { timeout: 10_000 },
	workers: 4,
	retries: 0,
	reporter: [['list']],
	globalSetup: './e2e/global-setup.ts',
	use: {
		baseURL: `http://localhost:${E2E.port}`,
		// adapter-node assumes https unless told otherwise: the server reads the protocol
		// from this header (PROTOCOL_HEADER below), so that SvelteKit's CSRF origin check
		// accepts the forms posted over plain http.
		extraHTTPHeaders: { 'x-forwarded-proto': 'http' },
		trace: 'retain-on-failure',
		...devices['Desktop Chrome'],
		// Keep one renderer process per tab: by default Chromium may move a page to a new
		// process on a full navigation, which drops the browser coverage of the pages seen
		// before it (fixtures.ts collects the coverage of the whole test at its end).
		launchOptions: {
			args: ['--disable-features=ProactivelySwapBrowsingInstance,BackForwardCache,RenderDocument']
		}
	},
	webServer: {
		command: `node ${E2E.buildDir}`,
		url: `http://localhost:${E2E.port}`,
		reuseExistingServer: false,
		timeout: 60_000,
		gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
		env: {
			PORT: String(E2E.port),
			PROTOCOL_HEADER: 'x-forwarded-proto',
			INGINIOUS_CONFIG: configFile,
			NODE_V8_COVERAGE: `${E2E.coverageDir}/server-raw`
		}
	}
});
