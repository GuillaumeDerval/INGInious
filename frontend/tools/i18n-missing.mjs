#!/usr/bin/env node
/**
 * Lists the UI messages of the SvelteKit app that are missing from each
 * translation catalog (src/lib/i18n/locales/<lang>.json).
 *
 * Messages are the string literals passed to `t('...')` (single, double or
 * backtick quotes without interpolation) in src (tests excluded).
 * Usage: `node tools/i18n-missing.mjs [--json out.json]` — prints a summary and,
 * with --json, writes `{ "<lang>": ["<msgid>", ...] }`.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = path.join(root, 'src');
const locales = path.join(src, 'lib/i18n/locales');

/** Lists source files recursively (tests excluded). */
const walk = (dir) =>
	fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
		const p = path.join(dir, d.name);
		if (d.isDirectory()) return d.name === 'locales' ? [] : walk(p);
		return /\.(ts|svelte)$/.test(d.name) && !/\.(test|spec)\.ts$/.test(d.name) ? [p] : [];
	});

const msgids = new Set();
const literal = /\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`$\\]*)`)/g;
for (const file of walk(src)) {
	for (const m of fs.readFileSync(file, 'utf8').matchAll(literal)) {
		const raw = m[1] ?? m[2] ?? m[3];
		// Unescape the JS string literal (\' \" \\ \n).
		msgids.add(raw.replace(/\\n/g, '\n').replace(/\\(['"\\])/g, '$1'));
	}
}

const missing = {};
for (const file of fs.readdirSync(locales).filter((f) => f.endsWith('.json'))) {
	const lang = file.slice(0, -5);
	const catalog = JSON.parse(fs.readFileSync(path.join(locales, file), 'utf8'));
	missing[lang] = [...msgids].filter((id) => !catalog[id]).sort();
	console.log(`${lang}: ${msgids.size - missing[lang].length}/${msgids.size} translated`);
}
const out = process.argv.indexOf('--json');
if (out > 0) fs.writeFileSync(process.argv[out + 1], JSON.stringify(missing, null, '\t'));
