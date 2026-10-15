/**
 * Build of the command-line tools (`npm run build:cli`, docs/cli.md): one plain
 * ESM file per command in build-cli/ (shared code in chunks), `#lib/...` imports
 * resolved and bundled. Like the adapter-node build of the web app, the runtime
 * `dependencies` of package.json stay external (installed node_modules, native
 * zeromq/argon2 modules); everything else is bundled.
 */
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const deps = Object.keys(pkg.dependencies);

export default defineConfig({
	// The `import.meta.glob` of the bundled plugins is resolved relative to the app root.
	root: new URL('..', import.meta.url).pathname,
	ssr: { noExternal: true, external: deps },
	build: {
		ssr: true,
		outDir: process.env.CLI_OUT ?? 'build-cli',
		emptyOutDir: true,
		target: 'node22',
		rolldownOptions: {
			input: {
				'inginious-autotest': 'cli/autotest.ts',
				'inginious-test-task': 'cli/test-task.ts',
				'inginious-setup': 'cli/setup.ts'
			},
			// Sub-path imports (e.g. `yaml/...`) of the external dependencies stay external too.
			external: (id) => deps.some((d) => id === d || id.startsWith(`${d}/`)),
			output: { entryFileNames: '[name].js', banner: (chunk) => (chunk.isEntry ? '#!/usr/bin/env node' : '') }
		}
	}
});
