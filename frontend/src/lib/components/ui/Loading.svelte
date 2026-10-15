<!--
@component
Placeholder of a section whose data is still loading (a spinner and "Loading..."),
e.g. the `{#await}` branch of data streamed by a load function because it cannot be
computed within the page's time budget (docs/performance.md).

Props:
- `label` (string, optional): text shown next to the spinner (default "Loading...").
-->
<script lang="ts">
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import { t } from '#lib/i18n/index.js';

	let { label = t('Loading...') }: { label?: string } = $props();
</script>

<p role="status" class="flex items-center justify-center gap-2 py-8 text-sm text-surface-600-400">
	<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />{label}
</p>
