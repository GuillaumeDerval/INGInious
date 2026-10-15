import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	// Source maps are only produced for coverage builds (integration tests).
	build: { sourcemap: process.env.COVERAGE === '1' },
	// Pre-bundle the lazily imported client libraries of RichText (stable component tests).
	optimizeDeps: { include: ['highlight.js/lib/core', 'katex', 'katex/contrib/auto-render'] },
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			// Parallel integration runs (one per E2E_ID) need their own output directories.
			outDir: process.env.KIT_OUT_DIR ?? '.svelte-kit',
			// Public origin baked into the production build (adapter-node), e.g. for the
			// Docker image served over plain http; otherwise derived from the request.
			paths: { origin: process.env.APP_ORIGIN || undefined },
			// CSRF is enforced by our own check (lib/server/request.ts `isCrossSiteForbidden`),
			// which can exempt the LTI/SAML endpoints that receive signed cross-site POSTs.
			csrf: { trustedOrigins: ['*'] },
			// Content-Security-Policy (architecture §4.8): SvelteKit adds nonces to its own
			// scripts; nothing else may run. Inline styles are needed by CodeMirror/KaTeX,
			// https images by task statements, frames by the optional webterm.
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'https:'],
					'font-src': ['self', 'data:'],
					// https: lets the optional Sentry reporting (CORE-06) reach its ingest host.
					'connect-src': ['self', 'https:'],
					'frame-src': ['self', 'https:'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self', 'https:']
				}
			},
			adapter: adapter({ out: process.env.BUILD_OUT ?? 'build' })
		})
	],
	test: {
		expect: { requireAssertions: true },
		// Unit + component coverage (objective: >= 95 % on every metric).
		coverage: {
			provider: 'v8',
			// Own directory: vitest empties it at start, so it must not be the parent of the
			// integration coverage (coverage/e2e) of a run in progress.
			reportsDirectory: 'coverage/unit',
			// Always produce the report, even when a (flaky) test fails.
			reportOnFailure: true,
			include: ['src/**/*.{ts,svelte}', 'cli/**/*.ts'],
			exclude: ['{src,cli}/**/*.{test,spec}.ts', 'src/**/*.d.ts', '{src,cli}/**/testing/**', 'cli/vite.config.ts'],
			thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 }
		},
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					testTimeout: 30_000,
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					// Generous budgets: many tests use a real MongoDB (and set up a database in
					// beforeAll) and the whole suite runs in parallel, also on slower CI runners.
					testTimeout: 20_000,
					hookTimeout: 30_000,
					globalSetup: ['src/lib/server/testing/global-setup.ts'],
					include: ['src/**/*.{test,spec}.{js,ts}', 'cli/**/*.test.ts'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
