/**
 * Code languages shared by the editor (CodeEditor, CodeMirror) and the rich text
 * highlighter (RichText, highlight.js): one canonical alias table, so that the same
 * `language:` value of a task problem or `code-block` resolves to the same language
 * in both. Names follow the legacy `language` values of task problems and
 * `data-x-language` attributes (python, c, cpp, java, ocaml, sh, ...). Each
 * CodeMirror language is a separate chunk downloaded only when an editor needs it.
 */
import type { Extension } from '@codemirror/state';
import { StreamLanguage, type StreamParser } from '@codemirror/language';

/** Alternative names (file extensions, legacy CodeMirror 5 mode names) → canonical name. */
const ALIASES: Record<string, string> = {
	py: 'python',
	python3: 'python',
	ipython: 'python',
	c: 'cpp',
	'c++': 'cpp',
	h: 'cpp',
	js: 'javascript',
	ts: 'typescript',
	yml: 'yaml',
	md: 'markdown',
	bash: 'shell',
	sh: 'shell',
	console: 'shell',
	ml: 'ocaml',
	'c#': 'csharp',
	cs: 'csharp',
	rs: 'rust',
	hs: 'haskell',
	matlab: 'octave',
	make: 'makefile',
	tex: 'latex',
	asm: 'x86asm',
	racket: 'scheme',
	html: 'xml'
};

/** Canonical name of a language (lower case, aliases resolved; "" for none). */
export function canonicalLanguage(name: string | null | undefined): string {
	const key = (name ?? '').trim().toLowerCase();
	return ALIASES[key] ?? key;
}

/** highlight.js grammar of the canonical names that differ. */
const HLJS_NAMES: Record<string, string> = { shell: 'bash', octave: 'matlab' };

/** highlight.js grammar name of a language (aliases resolved like for the editor). */
export function hljsLanguage(name: string): string {
	const canonical = canonicalLanguage(name);
	return HLJS_NAMES[canonical] ?? canonical;
}

/** Wraps a legacy (CodeMirror 5) mode. */
const legacy = async (parser: Promise<StreamParser<unknown>>) => StreamLanguage.define(await parser);

/** Loader per canonical language name. */
const LOADERS: Record<string, () => Promise<Extension>> = {
	python: async () => (await import('@codemirror/lang-python')).python(),
	cpp: async () => (await import('@codemirror/lang-cpp')).cpp(),
	java: async () => (await import('@codemirror/lang-java')).java(),
	javascript: async () => (await import('@codemirror/lang-javascript')).javascript(),
	typescript: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
	sql: async () => (await import('@codemirror/lang-sql')).sql(),
	yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
	markdown: async () => (await import('@codemirror/lang-markdown')).markdown(),
	shell: () => legacy(import('@codemirror/legacy-modes/mode/shell').then((m) => m.shell)),
	ocaml: () => legacy(import('@codemirror/legacy-modes/mode/mllike').then((m) => m.oCaml)),
	scala: () => legacy(import('@codemirror/legacy-modes/mode/clike').then((m) => m.scala)),
	kotlin: () => legacy(import('@codemirror/legacy-modes/mode/clike').then((m) => m.kotlin)),
	csharp: () => legacy(import('@codemirror/legacy-modes/mode/clike').then((m) => m.csharp)),
	rust: () => legacy(import('@codemirror/legacy-modes/mode/rust').then((m) => m.rust)),
	haskell: () => legacy(import('@codemirror/legacy-modes/mode/haskell').then((m) => m.haskell)),
	octave: () => legacy(import('@codemirror/legacy-modes/mode/octave').then((m) => m.octave)),
	oz: () => legacy(import('@codemirror/legacy-modes/mode/oz').then((m) => m.oz)),
	go: () => legacy(import('@codemirror/legacy-modes/mode/go').then((m) => m.go)),
	scheme: () => legacy(import('@codemirror/legacy-modes/mode/scheme').then((m) => m.scheme)),
	latex: () => legacy(import('@codemirror/legacy-modes/mode/stex').then((m) => m.stex)),
	xml: () => legacy(import('@codemirror/legacy-modes/mode/xml').then((m) => m.xml))
};

/**
 * Returns the CodeMirror support of a language, or null for plain text
 * (unknown names, "plain", "rst" which has no CodeMirror 6 mode, ...).
 */
export async function loadLanguage(name: string | null | undefined): Promise<Extension | null> {
	const loader = LOADERS[canonicalLanguage(name)];
	return loader ? loader() : null;
}
