/**
 * monocart-coverage-reports options shared by the Playwright fixtures (browser
 * coverage) and e2e/coverage-report.mjs (final merged report). Only the
 * application sources are reported (src/lib, src/routes, hooks, params).
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Paths (relative to app/) that belong to the application. */
const APP_SOURCE = /^src\/(lib|routes)\/|^src\/(hooks(\.server|\.client)?|params)\.ts$/;

/** Coverage directory of this run (see e2e/setup-data.ts). */
const RUN_DIR =
	!process.env.E2E_ID || process.env.E2E_ID === 'main' ? 'coverage/e2e' : `coverage/e2e-${process.env.E2E_ID}`;

/** @type {import('monocart-coverage-reports').CoverageReportOptions} */
export { RUN_DIR };
export const coverageOptions = {
	name: 'INGInious integration coverage',
	outputDir: `${RUN_DIR}/report`,
	reports: ['v8', 'console-summary', 'json-summary', 'lcovonly'],
	// Browser scripts of the app, and server files of the build that have a source map
	// (generated glue code without source map cannot be attributed to src/).
	entryFilter: (entry) =>
		// Browser scripts must carry a source map (otherwise they cannot be attributed to src/);
		// translation catalogs (JSON data chunks: `var e={"msgid":...}`) are not code.
		(/^https?:\/\/localhost:\d+\//.test(entry.url) &&
			(entry.source ?? '').includes('sourceMappingURL') &&
			!/^var \w+=\{"/.test(entry.source ?? '')) ||
		(entry.url.startsWith('file://') &&
			/\/build(-[\w-]+)?\//.test(entry.url) &&
			!/\/chunks\/(de|el|es|fr|he|nl|nb_NO|pt|vi)(-[\w-]+)?\.js$/.test(entry.url) && // translation catalogs (data)
			existsSync(fileURLToPath(entry.url) + '.map')),
	sourceFilter: (path) => APP_SOURCE.test(path) && !/\.(test|spec|e2e)\.ts$/.test(path) && !path.includes('/testing/')
};
