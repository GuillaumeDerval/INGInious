<!--
@component
Result card of the displayed submission (TASK-09): a header tinted by the result
(icon + result title, or a spinner and the queue message while waiting, with a
kill button and the SSH instructions if any), then the date of the submission (so that
the feedback is never mistaken for the one of another submission) marked "Best/Last
submission" when it is the evaluated one, the rendered global feedback, the optional
`children` (tags obtained) and the submission number.

Props: `submission` (SubmissionJson), `webterm` (string | null), `onkill` (() => void, optional),
`evaluated` ('best' | 'last' | null, optional): evaluation mode when it is the evaluated submission,
`children` (Snippet, optional): extra content (e.g. TaskTags) shown under the feedback.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import CheckIcon from '@lucide/svelte/icons/circle-check';
	import XIcon from '@lucide/svelte/icons/circle-x';
	import AlertIcon from '@lucide/svelte/icons/triangle-alert';
	import StarIcon from '@lucide/svelte/icons/star';
	import Badge from '#lib/components/ui/Badge.svelte';
	import RichText from '#lib/components/common/RichText.svelte';
	import DateTime from '#lib/components/ui/DateTime.svelte';
	import { t } from '#lib/i18n/index.js';
	import SshPanel from './SshPanel.svelte';
	import { alertKind } from './task-client.js';
	import type { SubmissionJson } from './types.js';

	/** Props of SubmissionResult. */
	export interface Props {
		/** The submission. */
		submission: SubmissionJson;
		/** Web terminal URL (SSH debug). */
		webterm?: string | null;
		/** Kills the running submission. */
		onkill?: () => void;
		/** Evaluation mode of the task when this is the evaluated submission (graded the task). */
		evaluated?: 'best' | 'last' | null;
		/** Extra content under the feedback (tags). */
		children?: Snippet;
	}

	let { submission, webterm, onkill, evaluated = null, children }: Props = $props();
	const waiting = $derived(submission.status === 'waiting');
	/** Header tint and icon per alert kind of the result. */
	const TONES = {
		info: ['bg-primary-500/8 text-primary-700-300', LoaderIcon],
		success: ['bg-success-500/10 text-success-700-300', CheckIcon],
		warning: ['bg-warning-500/12 text-warning-700-300', AlertIcon],
		error: ['bg-error-500/8 text-error-700-300', XIcon]
	} as const;
	const tone = $derived(TONES[alertKind(submission.result)]);
	const Icon = $derived(tone[1]);
</script>

<section id="task-result" aria-live="polite" class="overflow-hidden panel">
	<header
		class={['flex items-center gap-2.5 border-b border-surface-200-800 px-4 py-3 font-semibold sm:px-5', tone[0]]}
	>
		<Icon class={['size-5 shrink-0', waiting && 'animate-spin']} aria-hidden="true" />
		{#if waiting}
			<RichText html={submission.text} class="prose-sm min-w-0 flex-1 font-medium" />
			{#if onkill}<button type="button" class="btn preset-filled-error-500 btn-sm" onclick={onkill}>{t('Kill')}</button
				>{/if}
		{:else}
			<span class="min-w-0 flex-1">{submission.title}</span>
		{/if}
	</header>
	<div class="space-y-3 px-4 py-4 sm:px-5">
		<p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-surface-600-400" data-testid="result-date">
			<span>{t('Submitted on')} <DateTime value={submission.submittedOn} /></span>
			{#if evaluated}<Badge tone="success" icon={StarIcon}
					>{evaluated === 'last' ? t('Last submission') : t('Best submission')}</Badge
				>{/if}
		</p>
		{#if waiting}
			{#if submission.ssh}<SshPanel ssh={submission.ssh} {webterm} />{/if}
		{:else}
			<RichText html={submission.text} class="prose-sm" />
		{/if}
		{@render children?.()}
		<p class="text-xs text-surface-600-400">
			{t('Submission #{}', submission.id)}
		</p>
	</div>
</section>
