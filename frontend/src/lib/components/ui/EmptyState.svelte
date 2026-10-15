<!--
@component
Placeholder shown when a list or a page has no content (ux-design "empty states teach"):
an icon in a tinted circle, a title, an explanation and optional call-to-action buttons.

Props:
- `title` (string): main message.
- `description` (string, optional): explanation or hint.
- `icon` (Component, optional): illustration icon (default: an inbox).
- `compact` (boolean, default false): smaller variant for side panels and short lists.
- `children` (Snippet, optional): call-to-action buttons.
-->
<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import InboxIcon from '@lucide/svelte/icons/inbox';

	/** Props of EmptyState. */
	export interface Props {
		/** Main message. */
		title: string;
		/** Explanation. */
		description?: string;
		/** Illustration icon. */
		icon?: Component;
		/** Smaller variant. */
		compact?: boolean;
		/** Call-to-action buttons. */
		children?: Snippet;
	}

	let { title, description, icon: Icon = InboxIcon, compact = false, children }: Props = $props();
</script>

<div
	class={[
		'flex flex-col items-center text-center',
		compact
			? 'gap-1.5 px-4 py-6'
			: 'gap-2 rounded-container border border-dashed border-surface-300-700 bg-surface-50-950/60 px-6 py-12'
	]}
>
	<span
		class={[
			'mb-1 grid place-items-center rounded-full bg-primary-500/10 text-primary-600-400',
			compact ? 'size-9' : 'size-12'
		]}
		aria-hidden="true"
	>
		<Icon class={compact ? 'size-[1.125rem]' : 'size-6'} />
	</span>
	<p class={['font-semibold text-surface-900-100', compact && 'text-sm']}>{title}</p>
	{#if description}<p class="max-w-md text-sm text-surface-600-400">{description}</p>{/if}
	{#if children}<div class="mt-3 flex flex-wrap justify-center gap-2">{@render children()}</div>{/if}
</div>
