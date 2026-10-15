<!--
@component
Displays rendered rich text (task context, problem headers, MCQ choices, course
descriptions, static pages, grader feedback). This is the ONLY component of the
application allowed to use `{@html}` (architecture §4.2): it accepts only the
branded `SafeHtml` produced by the server-side sanitizer (`lib/server/text`).

After mount and after every update it enhances the content in the browser,
replacing the legacy MathJax / CodeMirror `colorize` / `<time>` scripts:
- math (`\( \)`, `\[ \]`, `$$ $$`, `\begin{equation*}`) is typeset with KaTeX auto-render;
- `pre.code.<lang>` blocks are highlighted with highlight.js (lazy-loaded; same language names as CodeEditor);
- `<time datetime>` elements are formatted in the viewer's locale and time zone;
- tables are wrapped in a horizontally scrolling box, so that wide tables (e.g. test
  results in feedback) never overflow their card on small screens.
Typography comes from Tailwind `prose`; the legacy Bootstrap 4 classes found in course
content are styled by `rich-text.css` (imported by the global stylesheet).

Props:
- `html` (SafeHtml): the sanitized HTML.
- `class` (string, optional): extra classes of the wrapper `div`.

@example <RichText html={task.context} class="mb-4" />
-->
<script lang="ts" module>
	import type { LanguageFn } from 'highlight.js';
	import type { SafeHtml } from '#lib/utils/safe-html.js';
	import { hljsLanguage } from '#lib/components/ui/code-languages.js';

	/** Props of RichText. */
	export interface Props {
		/** Sanitized HTML to display (from `renderText` on the server). */
		html: SafeHtml;
		/** Extra CSS classes of the wrapper. */
		class?: string;
	}

	/** Lazily loaded grammars missing from highlight.js' common bundle (legacy course languages). */
	const EXTRA: Record<string, () => Promise<{ default: LanguageFn }>> = {
		ocaml: () => import('highlight.js/lib/languages/ocaml'),
		scala: () => import('highlight.js/lib/languages/scala'),
		haskell: () => import('highlight.js/lib/languages/haskell'),
		matlab: () => import('highlight.js/lib/languages/matlab'),
		prolog: () => import('highlight.js/lib/languages/prolog'),
		scheme: () => import('highlight.js/lib/languages/scheme'),
		x86asm: () => import('highlight.js/lib/languages/x86asm'),
		latex: () => import('highlight.js/lib/languages/latex')
	};

	/** Math delimiters understood by the legacy MathJax setup + docutils output. */
	const DELIMITERS = [
		{ left: '$$', right: '$$', display: true },
		{ left: '\\[', right: '\\]', display: true },
		{ left: '\\begin{equation*}', right: '\\end{equation*}', display: true },
		{ left: '\\(', right: '\\)', display: false }
	];

	/** Typesets the math of an element (KaTeX and its stylesheet are loaded on first use). */
	async function typesetMath(root: HTMLElement): Promise<void> {
		if (!/\\\(|\\\[|\$\$|\\begin\{/.test(String(root.textContent))) return;
		const [{ default: render }] = await Promise.all([
			import('katex/contrib/auto-render'),
			import('katex/dist/katex.min.css')
		]);
		render(root, {
			delimiters: DELIMITERS,
			throwOnError: false,
			ignoredClasses: ['literal-block']
		});
	}

	/**
	 * Highlights `pre.code` blocks with the first class naming a known language
	 * (names resolved with the editor's alias table, then highlight.js' own aliases).
	 */
	async function highlightCode(root: HTMLElement): Promise<void> {
		const blocks = [...root.querySelectorAll<HTMLElement>('pre.code')];
		if (!blocks.length) return;
		const { default: hljs } = await import('highlight.js/lib/common');
		for (const block of blocks) {
			const language = [...block.classList].map(hljsLanguage).find((c) => hljs.getLanguage(c) || c in EXTRA);
			if (!language) continue;
			if (!hljs.getLanguage(language)) hljs.registerLanguage(language, (await EXTRA[language]()).default);
			// highlight.js escapes the code it receives as text: the result is safe HTML.
			block.innerHTML = hljs.highlight(String(block.textContent), { language, ignoreIllegals: true }).value;
			block.classList.add('hljs');
		}
	}

	/** Wraps the outermost tables in a `.table-scroll` box (scrolls horizontally when too wide). */
	function wrapTables(root: HTMLElement): void {
		for (const table of root.querySelectorAll('table:not(table table)')) {
			const box = document.createElement('div');
			box.className = 'table-scroll';
			table.replaceWith(box);
			box.append(table);
		}
	}
</script>

<script lang="ts">
	import { formatDate, uiPrefs } from '#lib/components/ui/prefs.js';

	let { html, class: klass = '' }: Props = $props();

	const prefs = uiPrefs();
	let container: HTMLDivElement | undefined = $state();

	/** Formats `<time datetime>` elements with the user's locale and time zone. */
	function formatTimes(root: HTMLElement): void {
		for (const time of root.querySelectorAll('time[datetime]')) {
			const iso = String(time.getAttribute('datetime'));
			if (Number.isNaN(Date.parse(iso))) continue;
			time.setAttribute('title', iso);
			time.textContent = formatDate(iso, prefs());
		}
	}

	// Re-run after every content change; the {#key} block below recreates the
	// container, so the enhancements never fight with Svelte's own DOM updates.
	$effect(() => {
		// Runs after mount: the container is bound (reading it subscribes to re-creations).
		const root = container as HTMLDivElement;
		formatTimes(root);
		wrapTables(root);
		root.dataset.enhanced = 'pending';
		// allSettled: a failed lazy import (offline) leaves the content readable, without unhandled rejection.
		void Promise.allSettled([typesetMath(root), highlightCode(root)]).then(() => (root.dataset.enhanced = 'done'));
	});
</script>

{#key html}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- SafeHtml is sanitized server-side (the only allowed {@html}). -->
	<div bind:this={container} class={['rich-text prose max-w-none dark:prose-invert', klass]}>{@html html}</div>
{/key}
