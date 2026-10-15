/**
 * Scale and performance suite (Playwright): `npm run test:perf`.
 *
 * The production build (build-perf) is started on a large generated data set
 * (generated beforehand by perf/seed.ts: thousands of courses and tasks, 100,000 submissions on one task,
 * multi-megabyte feedback) in its own database and tasks directory, and every
 * scenario of perf/*.perf.ts measures server time, payload size and browser
 * metrics against the budgets of perf/setup-data.ts. Results are written to
 * perf/results/ (docs/performance.md). Not part of the default test run: the
 * first generation of the data set takes a few minutes.
 */
import { defineConfig, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { stringify } from 'yaml';
import { PERF, PERF_ID } from './perf/setup-data.js';

// Configuration of the measured server (paths relative to app/, its working directory).
mkdirSync(PERF.dataDir, { recursive: true });
writeFileSync(
	PERF.configFile,
	stringify({
		backend: 'tcp://127.0.0.1:2000',
		mongo_opt: { database: PERF.database, host: 'localhost' },
		tasks_directory: relative(process.cwd(), PERF.tasksDir),
		backup_directory: relative(process.cwd(), `${PERF.dataDir}/backups`),
		session_parameters: { secret_key: PERF.secretKey, secure: false, timeout: 86400 },
		superadmins: ['superadmin'],
		allow_registration: true,
		allow_deletion: true,
		maintenance: false,
		plugins: [
			{ plugin_module: 'inginious.frontend.plugins.scoreboard' },
			{ plugin_module: 'inginious.frontend.plugins.contests' },
			{ plugin_module: 'inginious.frontend.plugins.upcoming_tasks' }
		]
	})
);

export default defineConfig({
	testDir: 'perf',
	outputDir: `test-results/perf-${PERF_ID}`,
	testMatch: '**/*.perf.ts',
	// Measurements must not compete with each other for the server and the browser.
	workers: 1,
	fullyParallel: false,
	timeout: 300_000,
	expect: { timeout: 60_000 },
	retries: 0,
	reporter: [['list']],
	use: {
		baseURL: `http://127.0.0.1:${PERF.port}`,
		extraHTTPHeaders: { 'x-forwarded-proto': 'http' },
		...devices['Desktop Chrome']
	},
	webServer: {
		command: `node ${PERF.buildDir}`,
		url: `http://127.0.0.1:${PERF.port}/logo.svg`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			PORT: String(PERF.port),
			HOST: '127.0.0.1',
			PROTOCOL_HEADER: 'x-forwarded-proto',
			INGINIOUS_CONFIG: PERF.configFile
		}
	}
});
