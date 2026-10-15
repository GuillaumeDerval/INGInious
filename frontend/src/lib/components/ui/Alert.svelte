<!--
@component
Inline message box (info, success, warning, error), optionally dismissible.
Errors and warnings use `role="alert"` so that screen readers announce them.

Props:
- `kind` ('info' | 'success' | 'warning' | 'error', default 'info').
- `title` (string, optional): bold first line.
- `dismissible` (boolean, default false): adds a close button.
- `children` (Snippet): message.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import InfoIcon from '@lucide/svelte/icons/info';
	import CheckIcon from '@lucide/svelte/icons/circle-check';
	import AlertIcon from '@lucide/svelte/icons/triangle-alert';
	import ErrorIcon from '@lucide/svelte/icons/circle-x';
	import XIcon from '@lucide/svelte/icons/x';
	import { t } from '#lib/i18n/index.js';

	/** Props of Alert. */
	export interface Props {
		/** Kind of message. */
		kind?: 'info' | 'success' | 'warning' | 'error';
		/** Optional title. */
		title?: string;
		/** Adds a close button. */
		dismissible?: boolean;
		/** Message. */
		children: Snippet;
	}

	let { kind = 'info', title, dismissible = false, children }: Props = $props();

	let open = $state(true);
	/** Box tint/border and icon colour of each kind (translucent: works on cards and pages, light and dark). */
	const STYLES = {
		info: { preset: 'bg-primary-500/8 border-primary-500/25', tint: 'text-primary-600-400', icon: InfoIcon },
		success: { preset: 'bg-success-500/8 border-success-500/25', tint: 'text-success-600-400', icon: CheckIcon },
		warning: { preset: 'bg-warning-500/10 border-warning-500/35', tint: 'text-warning-700-300', icon: AlertIcon },
		error: { preset: 'bg-error-500/7 border-error-500/25', tint: 'text-error-600-400', icon: ErrorIcon }
	};
	const style = $derived(STYLES[kind]);
</script>

{#if open}
	<div
		class={['flex items-start gap-3 rounded-container border px-4 py-3 text-surface-900-100', style.preset]}
		role={kind === 'error' || kind === 'warning' ? 'alert' : 'status'}
	>
		<style.icon class={['mt-0.5 size-[1.125rem] shrink-0', style.tint]} aria-hidden="true" />
		<div class="min-w-0 flex-1 space-y-1 text-sm leading-relaxed">
			{#if title}<p class="font-semibold">{title}</p>{/if}
			{@render children()}
		</div>
		{#if dismissible}
			<button
				type="button"
				class="-me-1.5 -mt-1 btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal"
				aria-label={t('Close')}
				onclick={() => (open = false)}
			>
				<XIcon class="size-4" aria-hidden="true" />
			</button>
		{/if}
	</div>
{/if}
