<!--
@component
Table of the course submissions (CSTU-11): evaluation star, students, task (real names
and task names with the "show names" options, their ids in muted text under them),
id (`showId`), submission and replay dates, result badge, grade, tags (`showTags`), and the
row actions view / download / replay (admins: submit button `submissionid`
posting the enclosing form to `?/replay`). Rows have a `selected` checkbox for
the bulk actions of the enclosing form, shown by the `bulk` snippet in the
selection bar.

Props:
- `rows` (SubmissionRow[]): submissions of the page (see `listSubmissions`).
- `base` (string): `/admin/<courseid>`.
- `admin` (boolean): shows the replay buttons.
- `showId`, `showTags` (boolean): optional columns.
- `bulk` (Snippet, optional): buttons of the bulk action bar.
-->
<script lang="ts" module>
	import type { Tone } from '#lib/components/ui/Badge.svelte';

	/** A row of the table. */
	export interface SubmissionRow {
		id: string;
		/** Displayed students and task (names or ids, per the query options) and their ids. */
		users: string[];
		task: string;
		userIds: string[];
		taskid: string;
		submittedOn: string;
		lastReplay: string | null;
		result: string;
		grade: number;
		eval: boolean;
		tags: { label: string; tone: Tone; title: string }[];
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import StarIcon from '@lucide/svelte/icons/star';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ReplayIcon from '@lucide/svelte/icons/rotate-ccw';
	import { t } from '#lib/i18n/index.js';
	import { formatGrade } from '#lib/utils/grade.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import DateTime from '#lib/components/ui/DateTime.svelte';
	import ResultBadge from '#lib/components/ui/ResultBadge.svelte';
	import Table from './Table.svelte';

	/** Props of SubmissionTable. */
	export interface Props {
		rows: SubmissionRow[];
		base: string;
		admin: boolean;
		showId?: boolean;
		showTags?: boolean;
		bulk?: Snippet;
	}

	let { rows, base, admin, showId = false, showTags = false, bulk }: Props = $props();
	const columns = $derived([
		{ key: 'eval', label: '', custom: true },
		{ key: 'users', label: t('Students'), text: (r: SubmissionRow) => r.users.join(', '), custom: true },
		{ key: 'task', label: t('Task'), custom: true },
		...(showId ? [{ key: 'id', label: t('Submission id'), href: (r: SubmissionRow) => `/submission/${r.id}` }] : []),
		{ key: 'submittedOn', label: t('Submitted on'), custom: true },
		{ key: 'lastReplay', label: t('Replayed on'), custom: true },
		{ key: 'result', label: t('Result'), custom: true },
		{ key: 'grade', label: t('Grade'), custom: true, numeric: true },
		...(showTags ? [{ key: 'tags', label: t('Tags'), custom: true }] : [])
	]);
</script>

<!-- A student or the task: displayed text, and the id under it when a name is displayed. -->
{#snippet named(text: string, id: string)}
	<span class="block">{text}</span>
	{#if text !== id}<span class="block font-mono text-xs text-surface-600-400">{id}</span>{/if}
{/snippet}

<Table {columns} {rows} {bulk} select={(r) => r.id} empty={t('No submission matches the filters.')}>
	{#snippet custom(r, key)}
		{#if key === 'eval'}{#if r.eval}<span title={t('Evaluation submission')}
					><StarIcon class="size-4 fill-current text-warning-500" aria-label={t('Evaluation submission')} /></span
				>{/if}
		{:else if key === 'users'}{#each r.users as name, i (i)}{@render named(name, r.userIds[i])}{/each}
		{:else if key === 'task'}{@render named(r.task, r.taskid)}
		{:else if key === 'result'}<ResultBadge result={r.result} />
		{:else if key === 'grade'}<span class="font-medium">{r.result === 'waiting' ? '—' : formatGrade(r.grade)}</span>
		{:else if key === 'tags'}<span class="flex flex-wrap gap-1"
				>{#each r.tags as tag, i (i)}<span title={tag.title}><Badge tone={tag.tone}>{tag.label}</Badge></span
					>{/each}</span
			>
		{:else}<span class="whitespace-nowrap text-surface-700-300"
				><DateTime value={key === 'submittedOn' ? r.submittedOn : r.lastReplay} /></span
			>{/if}
	{/snippet}
	{#snippet actions(r)}
		<!-- Row actions as icon buttons (docs/design-system.md): the label is the tooltip and accessible name. -->
		{@const icon = 'btn-icon btn-icon-sm text-surface-600-400 hover:preset-tonal'}
		<a class={icon} href={`/submission/${r.id}`} title={t('View submission')} aria-label={t('View submission')}
			><EyeIcon /></a
		>
		<a
			class={icon}
			href={`${base}/submissions/submissions.tgz?submission=${r.id}`}
			download
			title={t('Download submission')}
			aria-label={t('Download submission')}><DownloadIcon /></a
		>
		{#if admin}<button
				class={icon}
				formaction="?/replay"
				name="submissionid"
				value={r.id}
				title={t('Replay submission')}
				aria-label={t('Replay submission')}><ReplayIcon /></button
			>{/if}
	{/snippet}
</Table>
