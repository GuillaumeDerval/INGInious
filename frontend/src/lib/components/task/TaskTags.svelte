<!--
@component
Tags obtained by the displayed submission (TASK-20): skills in green,
misconceptions in red, auto-tags (admins only) in orange, truncated to 28
characters. Nothing is rendered when no tag is set.

Props: `tags` (TagData[]): course tags shown on the page; `tests` (Record<string, unknown>): tags of the result.
-->
<script lang="ts">
	import Badge from '#lib/components/ui/Badge.svelte';
	import { t } from '#lib/i18n/index.js';
	import type { TagData } from './types.js';

	/** Props of TaskTags. */
	export interface Props {
		/** Course tags displayable on the page. */
		tags: TagData[];
		/** Tag values of the submission. */
		tests: Record<string, unknown>;
	}

	let { tags, tests }: Props = $props();
	const shown = $derived(tags.filter((tag) => tests[tag.id]));
	const auto = $derived(
		Object.entries(tests)
			.filter(([id]) => id.startsWith('*auto-tag-'))
			.map(([, v]) => String(v))
	);
</script>

{#if shown.length || auto.length}
	<div class="flex flex-wrap gap-1" aria-label={t('Tags')}>
		{#each shown as tag (tag.id)}<Badge tone={tag.type === 1 ? 'error' : 'success'}>{tag.name}</Badge>{/each}
		{#each auto as value, i (i)}
			<span title={value}><Badge tone="warning">{value.length > 28 ? `${value.slice(0, 28)}…` : value}</Badge></span>
		{/each}
	</div>
{/if}
