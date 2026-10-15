<!--
@component
Horizontal progress bar for a grade or a completion ratio (0-100): a native
`<progress>` (implicit `progressbar` role) coloured by level, with the value as
text. Values are clamped.

Props:
- `value` (number): percentage (0-100).
- `label` (string, optional): accessible name (default "Grade").
- `showValue` (boolean, default true): show the percentage next to the bar.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import { formatGrade, roundGrade } from '#lib/utils/grade.js';

	/** Props of GradeBar. */
	export interface Props {
		/** Percentage, 0-100. */
		value: number;
		/** Accessible name. */
		label?: string;
		/** Show the numeric value. */
		showValue?: boolean;
	}

	let { value, label = t('Grade'), showValue = true }: Props = $props();

	const pct = $derived(roundGrade(Math.min(100, Math.max(0, value || 0))));
	const color = $derived(pct >= 100 ? 'success' : pct >= 50 ? 'primary' : pct > 0 ? 'warning' : 'surface');
</script>

<div class="flex items-center gap-2">
	<progress
		class="h-1.5 min-w-12 flex-1 appearance-none overflow-hidden rounded-full bg-surface-200-800 [&::-moz-progress-bar]:bg-(--bar) [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:bg-(--bar)"
		style:--bar="var(--color-{color}-500)"
		aria-label={label}
		max="100"
		value={pct}
	></progress>
	{#if showValue}<span class="w-12 text-end text-xs font-medium text-surface-700-300 tabular-nums"
			>{formatGrade(pct)}</span
		>{/if}
</div>
