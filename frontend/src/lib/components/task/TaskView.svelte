<!--
@component
The task page (TASK-01, docs/ux-design.md, reference page of docs/design-system.md):
statement card on the left and a sticky answer panel on the right (stacked on small
screens; full width when there is no statement) holding the task info card (status,
grade, deadline, limits, group), the result card of the displayed submission (dated,
marked when it is the evaluated one; none after a reload, like legacy, unless a submission
is still being graded) with its tags, one card per
problem with its own feedback, the submit bar (Submit, also Ctrl/Cmd+Enter, with live
status polling; local save/load as icon buttons) and the history card. Staff tools (view
submissions, edit, SSH debug, plugin entries) are grouped in a menu; admins
also get the raw debug data. Talks to the JSON actions of the page URL (TASK-08..12).

In LTI mode (`data.actionUrl` set, LTI-05) the actions go to that URL and the
breadcrumbs, task navigation, staff tools and links to other pages are hidden
(the LMS iframe has no cookie session).

Props: `data` (TaskPageData) from `loadTaskPage` or `loadLtiTask`.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import MoreMenu from '#lib/components/ui/MoreMenu.svelte';
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TerminalIcon from '@lucide/svelte/icons/square-terminal';
	import PuzzleIcon from '@lucide/svelte/icons/puzzle';
	import SendIcon from '@lucide/svelte/icons/send-horizontal';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import SaveIcon from '@lucide/svelte/icons/save';
	import RestoreIcon from '@lucide/svelte/icons/archive-restore';
	import RichText from '#lib/components/common/RichText.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import { notify } from '#lib/components/layout/toaster.js';
	import { t } from '#lib/i18n/index.js';
	import DebugInfo from './DebugInfo.svelte';
	import ProblemCard from './ProblemCard.svelte';
	import SubmissionHistory from './SubmissionHistory.svelte';
	import SubmissionResult from './SubmissionResult.svelte';
	import TaskInfo from './TaskInfo.svelte';
	import TaskTags from './TaskTags.svelte';
	import {
		actionForm,
		inputToAnswer,
		loadAnswers,
		postAction,
		saveAnswers,
		validateAnswers,
		type Answer
	} from './task-client.js';
	import type { SubmissionJson, SubmissionSummary, TaskPageData } from './types.js';

	/** Props of TaskView. */
	export interface Props {
		/** Page data. */
		data: TaskPageData;
		/** Delay between two status polls, in ms. */
		pollMs?: number;
	}

	let { data, pollMs = 1000 }: Props = $props();

	const url = $derived(`/course/${data.courseId}/${data.taskId}`);
	const actionUrl = $derived(data.actionUrl ?? url);
	const initial = () =>
		Object.fromEntries(
			data.problems.map((p) => [p.id, p.type === 'multiple_choice' && p.multiple ? [] : (p.default ?? '')])
		);
	let answers = $state<Record<string, Answer>>(initial());
	let files = $state<Record<string, string>>({});
	let shown = $state<SubmissionJson | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);
	let history = $state(untrack(() => data.submissions));
	let more = $state(untrack(() => data.more));
	let count = $state(untrack(() => data.submissionCount));
	let evaluated = $state(untrack(() => data.evaluated));
	let info = $state(untrack(() => data.info));
	let form: HTMLFormElement;

	/**
	 * Displays a submission result and updates the history / evaluated submission / status.
	 * The submission is in the loaded history, unless it is a waiting one older than the first page.
	 */
	function show(s: SubmissionJson) {
		shown = s;
		error = null;
		const i = history.findIndex((h) => h.id === s.id);
		const tags = data.tags.filter((tag) => s.tests[tag.id]).map((tag) => tag.name);
		if (i >= 0) history[i] = { ...history[i], status: s.status, result: s.result, grade: s.grade, tags };
		if (s.replace && s.status !== 'waiting') {
			evaluated = s.id;
			info.grade = s.grade;
			info.status = s.result === 'success' ? 'succeeded' : 'failed';
		}
	}

	/** Polls a submission until it is graded (TASK-09). */
	async function follow(id: string) {
		busy = true;
		for (;;) {
			const res = await postAction(actionUrl, actionForm('check', { submissionid: id }), true);
			if (res.status !== 'ok') {
				error = String(res.text);
				break;
			}
			show(res.submission as SubmissionJson);
			if (shown!.status !== 'waiting') break;
			await new Promise((r) => setTimeout(r, pollMs));
		}
		busy = false;
	}

	/** Sends the answers (TASK-08); `ssh` starts an SSH debug session (admins, TASK-12). */
	async function submit(ssh = false) {
		if (busy) return;
		error = validateAnswers(data.problems, answers, form);
		if (error) return;
		const body = actionForm('submit', ssh ? { '@debug-mode': 'ssh' } : {}, new FormData(form));
		busy = true;
		shown = null;
		const res = await postAction(actionUrl, body);
		if (res.status !== 'ok') {
			error = String(res.text);
			busy = false;
			return;
		}
		const id = String(res.submissionid);
		const removed = res.remove as string[];
		history = [
			{ id, status: 'waiting', result: 'waiting', grade: 0, submittedOn: new Date().toISOString(), tags: [] },
			...history.filter((h) => !removed.includes(h.id))
		];
		count += 1 - removed.length;
		info.tried += 1;
		await follow(id);
	}

	/**
	 * Reloads the answers and the result of an old submission (TASK-10); never called
	 * while busy (the history is disabled meanwhile).
	 */
	async function reload(id: string) {
		const res = await postAction(actionUrl, actionForm('load', { submissionid: id }));
		if (res.status !== 'ok') {
			error = String(res.text);
			return;
		}
		const s = res.submission as SubmissionJson;
		for (const p of data.problems) {
			const value = s.input?.[p.id] as { filename?: string } | undefined;
			if (p.type === 'file') files[p.id] = value?.filename ?? '';
			else answers[p.id] = inputToAnswer(value);
		}
		show(s);
		if (s.status === 'waiting') await follow(id);
	}

	/** Appends the next page of older submissions to the history (TASK-10). */
	async function loadMore() {
		const res = await postAction(actionUrl, actionForm('history', { before: history.at(-1)!.id }));
		if (res.status !== 'ok') return void (error = String(res.text));
		history = [...history, ...(res.submissions as SubmissionSummary[])];
		more = res.more as boolean;
	}

	/** Kills the displayed submission (TASK-11). */
	async function kill() {
		await postAction(actionUrl, actionForm('kill', { submissionid: shown!.id }));
	}

	/** Restores the answers saved in the browser. */
	function restore() {
		const saved = loadAnswers(data.courseId, data.taskId);
		if (saved) answers = { ...answers, ...saved };
		else notify('warning', t('Nothing saved for this task.'));
	}

	// A submission still waiting when the page is opened is followed (TASK-10).
	let ready = $state(false);
	onMount(() => {
		ready = true;
		if (data.waiting) void reload(data.waiting);
	});
</script>

<PageHeader
	title={data.name}
	breadcrumbs={data.actionUrl
		? []
		: [{ label: data.courseName, href: `/course/${data.courseId}` }, { label: data.name }]}
	actions={data.actionUrl ? undefined : actions}
/>

{#snippet actions()}
	{#if data.prev}<a
			class="btn-icon preset-tonal"
			href={`/course/${data.courseId}/${data.prev}`}
			title={t('Previous task')}
			aria-label={t('Previous task')}><ArrowLeftIcon class="size-4 rtl:rotate-180" /></a
		>{/if}
	{#if data.next}<a
			class="btn-icon preset-tonal"
			href={`/course/${data.courseId}/${data.next}`}
			title={t('Next task')}
			aria-label={t('Next task')}><ArrowRightIcon class="size-4 rtl:rotate-180" /></a
		>{/if}
	{#if data.staff || data.menu.length}
		<MoreMenu label={t('Staff tools')} icon={WrenchIcon} class="w-60 p-1.5">
			{#if data.staff}<a class="menu-item" href={`/admin/${data.courseId}/submissions?tasks=${data.taskId}`}
					><EyeIcon />{t('View submissions')}</a
				>{/if}
			{#if data.admin}
				<a class="menu-item" href={`/admin/${data.courseId}/edit/task/${data.taskId}`}><PencilIcon />{t('Edit task')}</a
				>
				<button
					type="button"
					class="menu-item"
					disabled={busy}
					title={t('Start remote SSH console with this input')}
					onclick={() => submit(true)}><TerminalIcon />{t('SSH debug')}</button
				>
			{/if}
			{#each data.menu as item (item.href)}<a class="menu-item" href={item.href}><PuzzleIcon />{item.label}</a>{/each}
		</MoreMenu>
	{/if}
{/snippet}

<div class="space-y-3 empty:hidden">
	{#if data.courseHidden}<Alert kind="warning"
			>{t(
				'This course is currently invisible for students. You can change this by modifying the "accessibility" option in the configuration of the course.'
			)}</Alert
		>{/if}
	{#if data.taskHidden}<Alert kind="warning"
			>{t(
				'This task is currently invisible for students. You can change this by modifying the "accessibility" option in the configuration of the task.'
			)}</Alert
		>{/if}
</div>

<div class={['mt-4 grid items-start gap-6 xl:gap-8', data.context && 'lg:grid-cols-2']}>
	{#if data.context}
		<article class="min-w-0 panel p-5 sm:p-7" aria-label={t('Statement')}>
			<RichText html={data.context} />
		</article>
	{/if}
	<div
		class={[
			'min-w-0 space-y-4',
			data.context
				? 'lg:sticky lg:top-18 lg:-mx-1 lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:px-1 lg:pb-1'
				: 'mx-auto w-full max-w-3xl'
		]}
	>
		<TaskInfo {info} courseId={data.courseId} group={data.group} mode={data.evaluationMode} />
		{#if error}<Alert kind="error" title={t('Error')}>{error}</Alert>{/if}
		{#if shown}
			<SubmissionResult
				submission={shown}
				webterm={data.webterm}
				onkill={kill}
				evaluated={shown.id === evaluated ? data.evaluationMode : null}
			>
				<TaskTags tags={data.tags} tests={shown.tests} />
			</SubmissionResult>
		{/if}
		<!-- Ctrl/Cmd+Enter submits (captured before the code editors handle it). -->
		<form
			bind:this={form}
			class="space-y-4"
			data-ready={ready || undefined}
			onsubmit={(e) => (e.preventDefault(), submit())}
			onkeydowncapture={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && (e.preventDefault(), submit())}
		>
			{#each data.random as r, i (i)}<input type="hidden" name={`@random_${i}`} value={String(r)} />{/each}
			{#each data.problems as problem (problem.id)}
				<ProblemCard
					{problem}
					bind:value={answers[problem.id]}
					disabled={busy}
					feedback={shown?.problems[problem.id]}
					filename={files[problem.id]}
					downloadUrl={shown && files[problem.id] && !data.actionUrl ? `${url}/$input/${shown.id}/${problem.id}` : null}
				/>
			{/each}
			<!-- Submit bar: one primary action, the local draft actions as icon buttons. -->
			<div class="flex flex-wrap items-center gap-2 panel px-3 py-2.5 sm:px-4">
				{#if data.blocked}
					<button type="button" class="btn preset-tonal" disabled>{data.blocked}</button>
					{#if !data.username}<a
							class="btn preset-filled-primary-500"
							href={`/signin?redirect=${encodeURIComponent(url)}`}>{t('Sign in')}</a
						>{/if}
					{#if data.registerUrl}<a class="btn preset-filled-primary-500" href={data.registerUrl}
							>{t('Enroll in the course')}</a
						>{/if}
				{:else}
					<button type="submit" class="btn min-w-28 preset-filled-primary-500" disabled={busy} title="Ctrl/Cmd+Enter">
						{#if busy}<LoaderIcon class="animate-spin" aria-hidden="true" />{:else}<SendIcon aria-hidden="true" />{/if}
						{t('Submit')}
					</button>
					<span class="hidden text-xs text-surface-500 sm:inline" aria-hidden="true"
						><kbd class="kbd">Ctrl</kbd> + <kbd class="kbd">Enter</kbd></span
					>
				{/if}
				<span class="ms-auto flex gap-1">
					<button
						type="button"
						class="btn-icon text-surface-600-400 hover:preset-tonal"
						title={t('Save my work in memory')}
						aria-label={t('Save my work in memory')}
						onclick={() => saveAnswers(data.courseId, data.taskId, answers)}><SaveIcon /></button
					>
					<button
						type="button"
						class="btn-icon text-surface-600-400 hover:preset-tonal"
						title={t('Load my work from memory')}
						aria-label={t('Load my work from memory')}
						onclick={restore}><RestoreIcon /></button
					>
				</span>
			</div>
		</form>
		{#if data.admin && shown?.debug}<DebugInfo data={shown.debug} />{/if}
		{#if data.registered}<SubmissionHistory
				submissions={history}
				{count}
				{more}
				onmore={loadMore}
				{evaluated}
				current={shown?.id}
				mode={data.evaluationMode}
				onselect={reload}
				disabled={busy}
			/>{/if}
	</div>
</div>
