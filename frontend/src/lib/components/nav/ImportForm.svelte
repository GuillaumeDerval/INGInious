<!--
@component
Marketplace import form (NAV-18/19): asks the id of the new course and
POSTs it (with the marketplace course id when given) to the page action.

Props:
- `courseid` (string, optional): marketplace course to import (hidden field).
- `primary` (boolean, default false): filled primary button (detail page) instead of a tonal one (card grids).
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import { t } from '#lib/i18n/index.js';

	export interface Props {
		courseid?: string;
		primary?: boolean;
	}
	let { courseid, primary = false }: Props = $props();
</script>

<form method="POST" use:enhance={toastEnhance()} class="flex w-full flex-wrap gap-2">
	{#if courseid}<input type="hidden" name="courseid" value={courseid} />{/if}
	<input
		class="input min-w-0 flex-1"
		name="new_courseid"
		placeholder={t('New course id')}
		aria-label={t('New course id')}
		required
	/>
	<button class="btn {primary ? 'preset-filled-primary-500' : 'preset-tonal-primary'}">{t('Import course')}</button>
</form>
