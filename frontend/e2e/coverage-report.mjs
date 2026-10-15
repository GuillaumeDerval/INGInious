#!/usr/bin/env node
/**
 * Builds the integration coverage report once Playwright (and the app server)
 * have exited: merges the browser coverage cached by the fixtures with the
 * server V8 coverage written through NODE_V8_COVERAGE, maps everything back to
 * the TypeScript/Svelte sources with the build sourcemaps and enforces 95 %.
 */
import MCR from 'monocart-coverage-reports';
import { existsSync } from 'node:fs';
import { coverageOptions, RUN_DIR } from './coverage-options.mjs';

const options = {
	...coverageOptions,
	onEnd: (results) => {
		const failed = ['lines', 'branches', 'functions', 'statements'].filter((m) => (results.summary[m]?.pct ?? 0) < 95);
		if (failed.length && process.env.COVERAGE_STRICT !== '0') {
			console.error(`Integration coverage below 95% for: ${failed.join(', ')}`);
			process.exitCode = 1;
		}
	}
};
const mcr = MCR(options);
if (existsSync(`${RUN_DIR}/server-raw`)) await mcr.addFromDir(`${RUN_DIR}/server-raw`);
await mcr.generate();
