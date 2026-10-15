<!--
@component
Deadline chip (NAV-10, NAV-02 UX): relative time when close ("in 2 days",
"3 hours ago", within 30 days), else the date, in the UI language; red when
past or within 2 days, amber within a week; the absolute date is in the
tooltip. Nothing is shown without deadline.

Props:
- `value` (string | null): ISO date of the deadline.
- `now` (number, optional): current time in ms (tests).
-->
<script lang="ts">
	import ClockIcon from '@lucide/svelte/icons/clock';
	import { formatDate, uiPrefs } from '#lib/components/ui/prefs.js';
	import Badge from '#lib/components/ui/Badge.svelte';

	export interface Props {
		value: string | null;
		now?: number;
	}
	let { value, now = Date.now() }: Props = $props();
	const prefs = uiPrefs();
	// Lazily derived: only read under `{#if value}`.
	const ms = $derived(Date.parse(value!) - now);
	const days = $derived(ms / 86_400_000);
	const text = $derived.by(() => {
		const rtf = new Intl.RelativeTimeFormat([prefs().locale, 'en'], { numeric: 'auto' });
		if (Math.abs(days) > 30) return formatDate(value!, prefs(), 'date');
		return Math.abs(days) >= 1 ? rtf.format(Math.round(days), 'day') : rtf.format(Math.round(ms / 3_600_000), 'hour');
	});
</script>

{#if value}
	<span title={formatDate(value, prefs())}>
		<Badge icon={ClockIcon} tone={days < 2 ? 'error' : days < 7 ? 'warning' : 'neutral'}>{text}</Badge>
	</span>
{/if}
