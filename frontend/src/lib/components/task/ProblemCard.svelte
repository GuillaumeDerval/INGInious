<!--
@component
Card of one problem of a task (TASK-02..06): title with a type icon, rendered header, the
feedback of the displayed submission for this problem (TASK-09) and the
input widget of its type (code, single line / match, file, multiple choice).

Props:
- `problem` (ProblemData), `value` (Answer, bindable), `disabled` (boolean);
- `feedback` ([result, SafeHtml], optional): per-problem feedback;
- `filename`, `downloadUrl` (optional): file of the reloaded submission (file problems).
-->
<script lang="ts">
	import CodeIcon from '@lucide/svelte/icons/code-xml';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import TextCursorIcon from '@lucide/svelte/icons/text-cursor-input';
	import RichText from '#lib/components/common/RichText.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import type { SafeHtml } from '#lib/utils/safe-html.js';
	import ChoiceProblem from './ChoiceProblem.svelte';
	import CodeProblem from './CodeProblem.svelte';
	import FileProblem from './FileProblem.svelte';
	import TextProblem from './TextProblem.svelte';
	import { alertKind, type Answer } from './task-client.js';
	import type { ProblemData } from './types.js';

	/** Props of ProblemCard. */
	export interface Props {
		/** The problem. */
		problem: ProblemData;
		/** Answer (bindable). */
		value: Answer;
		/** Disabled while a submission is processed. */
		disabled?: boolean;
		/** Feedback of the displayed submission. */
		feedback?: [string, SafeHtml];
		/** File of the reloaded submission. */
		filename?: string | null;
		/** Download URL of that file. */
		downloadUrl?: string | null;
	}

	let { problem, value = $bindable(), disabled = false, feedback, filename, downloadUrl }: Props = $props();
	/** Type icon shown before the title. */
	const ICONS: Record<string, typeof CodeIcon> = { code: CodeIcon, multiple_choice: ListChecksIcon, file: UploadIcon };
	const Icon = $derived(ICONS[problem.type] ?? TextCursorIcon);
</script>

<section class="space-y-4 panel p-4 sm:p-5" data-problem={problem.id}>
	{#if problem.title}
		<h2 class="flex items-center gap-2.5 text-base font-semibold">
			<span class="grid size-7 shrink-0 place-items-center rounded-base bg-primary-500/10 text-primary-600-400">
				<Icon class="size-4" aria-hidden="true" />
			</span>
			{problem.title}
		</h2>
	{/if}
	<!-- Keyed: dismissing the feedback of one submission must not hide the next one's. -->
	{#key feedback}
		{#if feedback}
			<Alert kind={alertKind(feedback[0])} dismissible><RichText html={feedback[1]} class="prose-sm" /></Alert>
		{/if}
	{/key}
	<RichText html={problem.header} class="prose-sm" />
	{#if problem.type === 'code'}
		<CodeProblem {problem} bind:value={() => value as string, (v) => (value = v)} {disabled} />
	{:else if problem.type === 'multiple_choice'}
		<ChoiceProblem {problem} bind:value {disabled} />
	{:else if problem.type === 'file'}
		<FileProblem {problem} {filename} {downloadUrl} {disabled} />
	{:else}
		<TextProblem {problem} bind:value={() => value as string, (v) => (value = v)} {disabled} />
	{/if}
</section>
