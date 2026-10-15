<!--
@component
Raw data of the displayed submission for course admins (TASK-21): the stored
document (stdout, stderr, custom, state, tests...) as a nested definition
list, inside a collapsible panel. Values are displayed as text only.

Props: `data` (unknown): JSON dump of the submission.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';

	/** Props of DebugInfo. */
	export interface Props {
		/** JSON value to display. */
		data: unknown;
	}

	let { data }: Props = $props();
	/** True for objects displayed as nested lists (arrays are joined). */
	const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
</script>

{#snippet value(v: unknown)}
	{#if isObject(v)}
		<dl class="ms-3 border-s border-surface-300-700 ps-2">
			{#each Object.entries(v) as [key, item] (key)}<dt class="font-semibold">{key}</dt>
				<dd>{@render value(item)}</dd>{/each}
		</dl>
	{:else}
		<pre class="whitespace-pre-wrap">{Array.isArray(v) ? v.join(', ') : String(v)}</pre>
	{/if}
{/snippet}

<details class="panel px-4 py-3 text-xs" data-testid="debug-info">
	<summary class="cursor-pointer text-sm font-semibold">{t('Debug information')}</summary>
	<p class="my-2">{t('The raw data from the container will be displayed here, helping you to debug the task.')}</p>
	{@render value(data)}
</details>
