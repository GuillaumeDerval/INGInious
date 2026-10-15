<!--
@component
Small colored label (status, tag, count): 12px text, translucent tint with a hairline ring.

Props:
- `tone` ('neutral' | 'primary' | 'success' | 'warning' | 'error', default 'neutral').
- `icon` (Component, optional): icon shown before the text.
- `children` (Snippet): label.

@example <Badge tone="success">{t('Open')}</Badge>
-->
<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	/** Color of a badge. */
	export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

	/** Props of Badge. */
	export interface Props {
		/** Color. */
		tone?: Tone;
		/** Optional leading icon. */
		icon?: Component;
		/** Label. */
		children: Snippet;
	}

	let { tone = 'neutral', icon: Icon, children }: Props = $props();

	/** Translucent tint + hairline ring of the tone colour: readable on cards and on the page, light and dark. */
	const PRESETS: Record<Tone, string> = {
		neutral: 'bg-surface-500/10 text-surface-700-300 ring-surface-500/20',
		primary: 'bg-primary-500/12 text-primary-700-300 ring-primary-500/25',
		success: 'bg-success-500/12 text-success-700-300 ring-success-500/25',
		warning: 'bg-warning-500/15 text-warning-700-300 ring-warning-500/30',
		error: 'bg-error-500/10 text-error-700-300 ring-error-500/25'
	};
</script>

<span class={['badge ring-1 ring-inset', PRESETS[tone]]}>
	{#if Icon}<Icon class="size-3.5" aria-hidden="true" />{/if}
	{@render children()}
</span>
