<!--
@component
Content section with an optional header (title, description, actions).
Used to group related information or form fields on a page.

Props:
- `title` (string, optional): section heading (an `<h2>`).
- `description` (string, optional): text under the heading.
- `actions` (Snippet, optional): buttons in the header.
- `class` (string, optional): extra classes on the card.
- `children` (Snippet): content.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Props of Card. */
	export interface Props {
		/** Section heading. */
		title?: string;
		/** Text under the heading. */
		description?: string;
		/** Header buttons. */
		actions?: Snippet;
		/** Extra classes. */
		class?: string;
		/** Card content. */
		children: Snippet;
	}

	let { title, description, actions, class: klass = '', children }: Props = $props();
</script>

<section class={['panel p-4 sm:p-6', klass]}>
	{#if title || actions}
		<header class="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
			<div class="min-w-0">
				{#if title}<h2 class="text-base font-semibold">{title}</h2>{/if}
				{#if description}<p class="mt-0.5 text-sm text-surface-600-400">{description}</p>{/if}
			</div>
			{#if actions}<div class="flex flex-wrap gap-2">{@render actions()}</div>{/if}
		</header>
	{/if}
	{@render children()}
</section>
