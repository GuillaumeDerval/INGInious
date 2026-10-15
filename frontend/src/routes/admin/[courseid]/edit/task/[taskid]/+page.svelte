<!--
@component
Task editor page (CADM-10..13): vertical tabs with icons (general settings,
grading environment, problems, plugin tabs, and a link to the task files;
horizontal and scrollable on small screens), each tab in a card, saved together
as JSON through the sticky save bar. After a failed save the error is listed at
the top, the tab holding the faulty field is marked and opened, and the field
is highlighted in place.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ContainerIcon from '@lucide/svelte/icons/container';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import PuzzleIcon from '@lucide/svelte/icons/puzzle';
	import FolderIcon from '@lucide/svelte/icons/folder-open';
	import ArrowIcon from '@lucide/svelte/icons/arrow-up-right';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import {
		adminCrumbs,
		Alert,
		BASIC_SPEC,
		Badge,
		Card,
		PageHeader,
		SaveBar,
		SpecForm,
		SubproblemsEditor,
		enhance,
		envSpec,
		page,
		t,
		toastEnhance
	} from '#lib/components/course-admin/kit.js';
	import { fieldError, problemError, type FieldSpec } from '#lib/components/course-admin/specs.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const course = $derived(data.adminCourse);
	// The editor state starts from the loaded task and survives saves.
	// svelte-ignore state_referenced_locally
	let values = $state(structuredClone(data.values));
	// svelte-ignore state_referenced_locally
	let problems = $state(structuredClone(data.problems));
	let tab = $state('general');
	const previewUrl = $derived(`/admin/${course.id}/preview`);
	/** Message of the last failed save. */
	const error = $derived(page.status >= 400 ? (page.form as { message?: string } | null)?.message : null);
	/** Tabs: id, label, icon, description, fields (null = the problems editor), optional plugin text. */
	const tabs = $derived([
		{
			id: 'general',
			label: t('General'),
			icon: FileTextIcon,
			description: t('Title, statement and author shown to students.'),
			fields: BASIC_SPEC as FieldSpec[] | null
		},
		{
			id: 'environment',
			label: t('Grading environment'),
			icon: ContainerIcon,
			description: t('Container that runs the grading script, and its limits.'),
			fields: envSpec(data.environments, String(data.values.environment_id ?? ''))
		},
		{
			id: 'problems',
			label: t('Problems'),
			icon: ListChecksIcon,
			description: t('Questions students answer, in display order.'),
			fields: null
		},
		...data.tabs.map((x) => ({ ...x, label: t(x.label), icon: PuzzleIcon, description: '' }))
	]);
	/** Tabs holding the field named by the last save error. */
	const failed = $derived(
		new Set(
			tabs
				.filter((x) =>
					x.fields
						? x.fields.some((f) => fieldError(f, values, error, t))
						: problems.some((p) => problemError(p, error, t))
				)
				.map((x) => x.id)
		)
	);
	// After a failed save, open the first tab holding the faulty field.
	$effect(() => {
		if (error)
			untrack(() => {
				const first = [...failed][0];
				if (first) tab = first;
			});
	});
</script>

<PageHeader
	title={String(data.values.name || data.taskid)}
	subtitle={t('Edit the statement, the grading environment and the problems of this task.')}
	breadcrumbs={adminCrumbs(
		course,
		{ label: t('Task list'), href: `/admin/${course.id}/tasks` },
		t('Edit task "{}"', data.taskid)
	)}
>
	{#snippet actions()}<a class="btn preset-tonal" href={`/course/${course.id}/${data.taskid}`}
			><EyeIcon />{t('View task')}</a
		>{/snippet}
</PageHeader>

<form method="POST" action="?/save" use:enhance={toastEnhance()}>
	<input type="hidden" name="task" value={JSON.stringify({ values, problems })} />
	{#if error}
		<div class="mb-6">
			<Alert kind="error" title={t('The task was not saved')}><p class="whitespace-pre-line">{error}</p></Alert>
		</div>
	{/if}
	<div class="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
		<div
			role="tablist"
			aria-orientation="vertical"
			class="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:sticky md:top-20 md:mx-0 md:flex-col md:self-start md:overflow-visible md:p-0"
		>
			{#each tabs as x (x.id)}
				<button
					type="button"
					role="tab"
					aria-selected={tab === x.id}
					class={[
						'flex shrink-0 items-center gap-2.5 rounded-base px-3 py-2 text-start text-sm font-medium transition-colors',
						tab === x.id
							? 'bg-surface-50-950 text-primary-700-300 shadow-xs ring-1 ring-surface-200-800 md:border-s-3 md:border-secondary-400'
							: 'text-surface-700-300 hover:bg-surface-200-800/60'
					]}
					onclick={() => (tab = x.id)}
				>
					<x.icon class={['size-4 shrink-0', tab === x.id ? 'text-primary-600-400' : 'text-surface-500']} />
					<span class="flex-1 whitespace-nowrap">{x.label}</span>
					{#if failed.has(x.id)}<span class="size-2 rounded-full bg-error-500" title={t('Error')}></span>{/if}
					{#if x.id === 'problems'}<Badge>{problems.length}</Badge>{/if}
				</button>
			{/each}
			<a
				class="flex shrink-0 items-center gap-2.5 rounded-base px-3 py-2 text-sm font-medium text-surface-700-300 hover:bg-surface-200-800/60 md:mt-2 md:border-t md:border-surface-200-800 md:pt-3"
				href={`/admin/${course.id}/edit/task/${data.taskid}/files`}
				><FolderIcon class="size-4 text-surface-500" /><span class="flex-1 whitespace-nowrap">{t('Task files')}</span
				><ArrowIcon class="size-3.5 text-surface-500" /></a
			>
		</div>
		<div class="min-w-0">
			{#each tabs as x (x.id)}
				<div role="tabpanel" aria-label={x.label} hidden={tab !== x.id}>
					{#if x.fields}
						<Card title={x.label} description={x.description}>
							{#if 'text' in x && x.text}<p class="mb-4 text-sm text-surface-600-400">{x.text}</p>{/if}
							<SpecForm fields={x.fields} {values} {previewUrl} {error} />
						</Card>
					{:else}
						<div class="mb-4">
							<h2 class="text-base font-semibold">{x.label}</h2>
							<p class="text-sm text-surface-600-400">{x.description}</p>
						</div>
						<SubproblemsEditor {problems} {previewUrl} {error} />
					{/if}
				</div>
			{/each}
		</div>
	</div>
	<SaveBar values={{ values, problems }} version={data} showError={false} />
</form>
