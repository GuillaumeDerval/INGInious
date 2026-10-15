<!--
@component
Ranking table of the scoreboard and contest plugins (SITE-13, SITE-14): a
header row and rows of cells computed on the server; emphasized columns are
highlighted and each cell may carry a CSS class (contest statuses).

Props:
- `header` (string[]): column titles.
- `rows` ({ v: string | number; c?: string }[][]): cells.
- `emphasis` (number[], optional): highlighted column indexes.

@example
<ScoreTable header={['', 'Student(s)', 'Score']} rows={[[{ v: 1 }, { v: 'Alice' }, { v: 20 }]]} emphasis={[2]} />
-->
<script lang="ts">
	import DataTable from '#lib/components/ui/DataTable.svelte';

	/** Props of ScoreTable. */
	export interface Props {
		/** Column titles. */
		header: string[];
		/** Table cells (value + optional classes). */
		rows: { v: string | number; c?: string }[][];
		/** Highlighted columns. */
		emphasis?: number[];
	}

	let { header, rows, emphasis = [] }: Props = $props();
	const tone = (i: number, c = '') => `${c} ${emphasis.includes(i) ? 'preset-tonal-primary font-semibold' : ''}`;
</script>

<DataTable columns={header.map((label, i) => ({ key: String(i), label, class: tone(i) }))} {rows}>
	{#snippet row(cells)}
		<tr>
			{#each cells as cell, i (i)}<td class={tone(i, cell.c)}>{cell.v}</td>{/each}
		</tr>
	{/snippet}
</DataTable>
