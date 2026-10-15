<!--
@component
Centred card of the focused, single-task pages (sign-in, registration, course
enrollment, LTI binding): the INGInious logo (or an icon in a tinted tile),
the page title (`<h1>`, also the document title), an optional subtitle, the
card content and an optional line under the card (e.g. "Create an account").

Props:
- `title` (string): page title.
- `subtitle` (string, optional): one-line explanation under the title.
- `icon` (Component, optional): icon shown instead of the logo.
- `wide` (boolean, default false): wider card (forms with several sections).
- `children` (Snippet): card content.
- `footer` (Snippet, optional): text under the card.
-->
<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	export interface Props {
		title: string;
		subtitle?: string;
		icon?: Component;
		wide?: boolean;
		children: Snippet;
		footer?: Snippet;
	}
	let { title, subtitle, icon: Icon, wide = false, children, footer }: Props = $props();
</script>

<svelte:head><title>{`${title} | INGInious`}</title></svelte:head>

<div class={['mx-auto w-full py-2 sm:py-8', wide ? 'max-w-lg' : 'max-w-md']}>
	<header class="mb-6 flex flex-col items-center gap-3 text-center">
		{#if Icon}
			<span class="grid size-12 place-items-center rounded-container bg-primary-500/10 text-primary-600-400">
				<Icon class="size-6" aria-hidden="true" />
			</span>
		{:else}
			<img src="/logo.svg" alt="" class="h-14 w-auto" />
		{/if}
		<h1 class="text-2xl font-semibold tracking-tight break-words">{title}</h1>
		{#if subtitle}<p class="text-sm text-surface-600-400">{subtitle}</p>{/if}
	</header>
	<div class="space-y-5 panel p-5 sm:p-8">{@render children()}</div>
	{#if footer}<p class="mt-5 text-center text-sm text-surface-600-400">{@render footer()}</p>{/if}
</div>
