<!--
@component
Danger zone page (CADM-15/16): archive the course data, delete the course,
each in a red-outlined card (icon, consequences, action on the side). Each
action asks for the course id in a confirmation dialog; after an archive, a
success alert links to the new archive course.
-->
<script lang="ts">
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { adminCrumbs, Alert, Badge, ConfirmDialog, PageHeader, t } from '#lib/components/course-admin/kit.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const course = $derived(data.adminCourse);
	/** Danger actions: id, icon, title and consequences. */
	const ACTIONS = [
		[
			'archive',
			ArchiveIcon,
			'Archive course data',
			'This will reset and archive all course data (submissions, audiences, groups, user statistics) from the database. The archive will be stored as a new course.'
		],
		[
			'delete',
			TrashIcon,
			'Delete course',
			'This will permanently remove the course and all its data (including tasks and archive courses) from INGInious.'
		]
	] as const;
</script>

<PageHeader
	title={t('Danger zone')}
	subtitle={t('Actions on the whole course that cannot be undone. Each one asks you to type the course id.')}
	breadcrumbs={adminCrumbs(course, t('Danger zone'))}
/>

<div class="max-w-4xl space-y-4">
	{#if form?.message}
		<Alert kind={'archive' in form ? 'success' : 'error'}>
			<span>{form.message}</span>
			{#if 'archive' in form}
				<a class="ms-1 font-medium text-primary-700-300 underline" href={`/admin/${form.archive}/settings`}
					>{t('Open the archive')}</a
				>
			{/if}
		</Alert>
	{/if}
	{#each ACTIONS as [id, Icon, title, description] (id)}
		<section
			class="flex flex-col gap-4 rounded-container border border-error-500/40 bg-surface-50-950 p-4 sm:flex-row sm:items-center sm:p-6"
		>
			<span class="grid size-10 shrink-0 place-items-center rounded-full bg-error-500/10 text-error-600-400">
				<Icon class="size-5" aria-hidden="true" />
			</span>
			<div class="min-w-0 flex-1 space-y-1">
				<h2 class="text-base font-semibold">{t(title)}</h2>
				<p class="text-sm text-surface-600-400">
					{id === 'archive' && data.archived
						? t('This course is already an archive course. You cannot archive it again.')
						: t(description)}
				</p>
			</div>
			<div class="shrink-0">
				{#if id === 'archive' && data.archived}
					<Badge icon={ArchiveIcon}>{t('Already archived')}</Badge>
				{:else}
					<ConfirmDialog
						title={t(title)}
						description={t(description)}
						triggerLabel={t(title)}
						confirmLabel={t(title)}
						confirmText={course.id}
						action={`?/${id}`}
						fields={{ courseid: course.id }}
					/>
				{/if}
			</div>
		</section>
	{/each}
</div>
