<!--
@component
Side column of a registered student on the course and group pages (NAV-08,
NAV-16, NAV-21): optional course grade card, last tried exercises and the
"Unregister from this course" confirmation dialog.

Props:
- `course` ({ id, name }): the course.
- `lastTried` (LastTriedItem[]): last tried exercises.
- `canUnregister` (boolean): shows the unregistration dialog.
- `grade` (number, optional): course grade (percent), shown as a progress card.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import { formatGrade } from '#lib/utils/grade.js';
	import ConfirmDialog from '#lib/components/ui/ConfirmDialog.svelte';
	import GradeBar from '#lib/components/ui/GradeBar.svelte';
	import LastTried from './LastTried.svelte';
	import type { LastTriedItem } from './types.js';

	export interface Props {
		course: { id: string; name: string };
		lastTried: LastTriedItem[];
		canUnregister: boolean;
		grade?: number;
	}
	let { course, lastTried, canUnregister, grade }: Props = $props();
</script>

<aside class="space-y-4">
	{#if grade !== undefined}
		<section class="space-y-2 panel p-4" aria-label={t('Current grade')}>
			<p class="eyebrow">{t('Current grade')}</p>
			<p class="text-2xl font-semibold tabular-nums">{formatGrade(grade)}</p>
			<GradeBar value={grade} label={t('Current grade')} showValue={false} />
		</section>
	{/if}
	<LastTried items={lastTried} />
	{#if canUnregister}
		<ConfirmDialog
			title={t('Unregister from {}', course.name)}
			description={t('This will keep your submissions saved but will remove you from your group.') +
				' ' +
				t('Are you sure ?')}
			triggerLabel={t('Unregister from this course')}
			confirmLabel={t('Unregister')}
			action={`/course/${course.id}?/unregister`}
		/>
	{/if}
</aside>
