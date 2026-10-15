<!--
@component
Renders a date as a `<time>` element formatted in the user's locale and time
zone (from the shell preferences, see `prefs.ts`), replacing the legacy
client-side reformatting of `<time>` tags (CORE-01). Invalid or missing dates
render `fallback`.

Props:
- `value` (Date | string | number | null): the date.
- `mode` ('datetime' | 'date', default 'datetime').
- `fallback` (string, default "—"): text for missing dates.
-->
<script lang="ts">
	import { formatDate, uiPrefs } from './prefs.js';

	/** Props of DateTime. */
	export interface Props {
		/** Date to display. */
		value: Date | string | number | null | undefined;
		/** Which parts to show. */
		mode?: 'datetime' | 'date';
		/** Text for missing/invalid dates. */
		fallback?: string;
	}

	let { value, mode = 'datetime', fallback = '—' }: Props = $props();

	const prefs = uiPrefs();
	const date = $derived(value === null || value === undefined || value === '' ? null : new Date(value));
</script>

{#if date && !Number.isNaN(date.getTime())}
	<time datetime={date.toISOString()} title={date.toISOString()}>{formatDate(date, prefs(), mode)}</time>
{:else}
	<span>{fallback}</span>
{/if}
