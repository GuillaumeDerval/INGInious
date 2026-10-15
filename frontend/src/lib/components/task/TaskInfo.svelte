<!--
@component
Task facts card at the top of the answer panel (TASK-01/13/14/16/18, docs/design-system.md
"key-value info list"): the viewer's status and grade (large, with a progress bar, stating
which submission it comes from: best or last one, so that it is not confused with the
result of the displayed submission), then a
key/value list with attempts, deadline (red when past the soft deadline), submissions left /
limit, group, author, categories and the contact link.

Props: `info` (TaskInfoData), `courseId` (string), `group` (description of the viewer's group, optional),
`mode` ('best' | 'last', default 'best'): evaluation mode of the task.
-->
<script lang="ts">
	import type { Component } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/circle-check';
	import XIcon from '@lucide/svelte/icons/circle-x';
	import CircleIcon from '@lucide/svelte/icons/circle-dashed';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import MailIcon from '@lucide/svelte/icons/mail';
	import { formatGrade } from '#lib/utils/grade.js';
	import Badge, { type Tone } from '#lib/components/ui/Badge.svelte';
	import DateTime from '#lib/components/ui/DateTime.svelte';
	import GradeBar from '#lib/components/ui/GradeBar.svelte';
	import { t } from '#lib/i18n/index.js';
	import type { TaskInfoData } from './types.js';

	/** Props of TaskInfo. */
	export interface Props {
		/** Data to display. */
		info: TaskInfoData;
		/** Course id (link to the group page). */
		courseId: string;
		/** Group task: name of the viewer's group (null: no group yet). */
		group?: { description: string | null } | null;
		/** Evaluation mode of the task (the grade is the one of the best or of the last submission). */
		mode?: 'best' | 'last';
	}

	let { info, courseId, group = null, mode = 'best' }: Props = $props();
	/** Label (legacy msgid), colour and icon of each status of the viewer. */
	const STATUS: Record<string, [string, Tone, Component]> = {
		notattempted: ['Not yet attempted', 'neutral', CircleIcon],
		succeeded: ['Succeeded', 'success', CheckIcon],
		waiting: ['Waiting for verification', 'primary', LoaderIcon],
		failed: ['Failed', 'error', XIcon]
	};
	const status = $derived(info.status && STATUS[info.status]);
	const { amount, period } = $derived(info.limit);
	const limit = $derived(
		amount < 0
			? t('No limitation')
			: period > 0
				? t('{} submissions every {} hour(s)', amount, period)
				: t('{} submissions', amount)
	);
	const late = $derived(info.pastSoftDeadline || info.neverAccessible);
</script>

<section class="panel p-4 sm:p-5" aria-label={t('Information')}>
	{#if status}
		<div class="mb-4 space-y-2.5">
			<div class="flex items-end justify-between gap-3">
				<div>
					<p class="eyebrow">{t('Grade')}</p>
					<p class="text-2xl leading-tight font-semibold tabular-nums" data-testid="task-grade">
						{formatGrade(info.grade)}
					</p>
				</div>
				<span data-testid="task-status"><Badge tone={status[1]} icon={status[2]}>{t(status[0])}</Badge></span>
			</div>
			<GradeBar value={info.grade} showValue={false} />
			<p class="text-xs text-surface-600-400" data-testid="grade-source">
				{mode === 'last' ? t('Grade of your last submission') : t('Grade of your best submission')}
			</p>
		</div>
	{/if}
	<dl class="kv">
		{#if status}
			<dt>{t('Attempts')}</dt>
			<dd data-testid="task-tries">{info.tried}</dd>
		{/if}
		<dt>{t('Deadline')}</dt>
		<dd data-testid="deadline">
			{#if late}<Badge tone="error"
					>{#if info.neverAccessible}{t("It's too late")}{:else}<DateTime value={info.deadline!} />{/if}</Badge
				>{:else if info.deadline}<DateTime value={info.deadline} />{:else}{t('No deadline')}{/if}
		</dd>
		<dt>{t('Submission limit')}</dt>
		<dd class={info.left === 0 ? 'text-warning-700-300' : ''}>
			{info.left === null ? limit : `${t('{} submissions left', info.left)} (${limit})`}
		</dd>
		{#if group}
			<dt>{t('Group')}</dt>
			<dd>
				<a
					href={`/group/${courseId}`}
					class="anchor"
					aria-label={`${t('Group')}: ${group.description ?? t('Group management')}`}
					>{group.description ?? t('Group management')}</a
				>
			</dd>
		{/if}
		{#if info.author}
			<dt>{t('Author(s)')}</dt>
			<dd>{info.author}</dd>
		{/if}
		{#if info.categories.length}
			<dt>{t('Category tags')}</dt>
			<dd class="flex flex-wrap gap-1">
				{#each info.categories as category (category)}<Badge>{category}</Badge>{/each}
			</dd>
		{/if}
	</dl>
	{#if info.contactUrl}
		<a
			class="mt-4 inline-flex items-center gap-1.5 anchor text-sm"
			href={info.contactUrl}
			target="_blank"
			rel="noopener noreferrer"><MailIcon class="size-4" aria-hidden="true" />{t('Contact link')}</a
		>
	{/if}
</section>
