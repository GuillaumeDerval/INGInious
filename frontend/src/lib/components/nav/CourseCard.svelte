<!--
@component
Course card of the course grids (/mycourses, /courselist, /marketplace): an
initial tile, the course name (a link covering the whole card when `href` is
set), optional badges under the name, an optional control at the end of the
header (e.g. the pin button), a body and an optional footer band (access state
and call-to-action). Interactive elements of `aside` and `footer` stay
clickable above the covering link.

Props:
- `id` (string): course id (`data-course-id`, used by tests and scripts).
- `name` (string): course name.
- `href` (string, optional): link of the whole card.
- `meta` (Snippet, optional): badges under the name.
- `aside` (Snippet, optional): control at the end of the header.
- `children` (Snippet, optional): body.
- `footer` (Snippet, optional): footer band.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	export interface Props {
		id: string;
		name: string;
		href?: string;
		meta?: Snippet;
		aside?: Snippet;
		children?: Snippet;
		footer?: Snippet;
	}
	let { id, name, href, meta, aside, children, footer }: Props = $props();
</script>

<article
	class={['relative flex flex-col panel transition', href && 'hover:border-primary-500/40 hover:shadow-md']}
	data-course-id={id}
>
	<div class="flex flex-1 flex-col gap-4 p-4 sm:p-5">
		<header class="flex items-start gap-3">
			<span
				class="grid size-10 shrink-0 place-items-center rounded-base bg-primary-500/10 font-semibold text-primary-700-300"
				aria-hidden="true">{name.replace(/^\W+/, '').charAt(0).toUpperCase()}</span
			>
			<div class={['min-w-0 flex-1', !meta && 'self-center']}>
				<h2 class="leading-snug font-semibold break-words">
					{#if href}<a class="after:absolute after:inset-0 after:rounded-container hover:text-primary-700-300" {href}
							>{name}</a
						>{:else}{name}{/if}
				</h2>
				{#if meta}<div class="mt-1.5 flex flex-wrap items-center gap-1.5">{@render meta()}</div>{/if}
			</div>
			{#if aside}<div class="relative -me-1.5 -mt-1">{@render aside()}</div>{/if}
		</header>
		{@render children?.()}
	</div>
	{#if footer}
		<footer
			class="relative flex flex-wrap items-center justify-between gap-2 rounded-b-container border-t border-surface-200-800 bg-surface-100-900/60 px-4 py-3 sm:px-5"
		>
			{@render footer()}
		</footer>
	{/if}
</article>
