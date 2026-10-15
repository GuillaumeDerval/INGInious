<!--
@component
Renders the application-wide toasts (see `toaster.ts`). Mounted once by `AppShell`.
Each toast is an elevated card with an accent colour by kind (info/success/warning/error) and can be closed;
toasts only carry a description (`notify` never sets a title).
-->
<script lang="ts">
	import { Toast } from '@skeletonlabs/skeleton-svelte';
	import { toaster } from './toaster.js';

	/** Accent border per toast type (the toaster always sets a type, "info" by default) on an elevated card. */
	const PRESETS: Record<string, string> = {
		success: 'border-s-success-500',
		warning: 'border-s-warning-500',
		error: 'border-s-error-500',
		info: 'border-s-primary-500'
	};
</script>

<Toast.Group {toaster}>
	{#snippet children(toast)}
		<Toast {toast} class={['panel border-s-4 text-surface-900-100 shadow-xl', PRESETS[toast.type!]]}>
			<Toast.Message>
				<Toast.Description>{toast.description}</Toast.Description>
			</Toast.Message>
			<Toast.CloseTrigger />
		</Toast>
	{/snippet}
</Toast.Group>
