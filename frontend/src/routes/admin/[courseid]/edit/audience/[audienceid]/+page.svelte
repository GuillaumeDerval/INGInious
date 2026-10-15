<!--
@component
Audience edition page (CSTU-05): description and tutors (course staff) on the
left, students (user search; unregistered users are enrolled on save) on the
right, save button at the bottom and deletion (confirmed) in the header.
-->
<script lang="ts">
	import SaveIcon from '@lucide/svelte/icons/save';
	import ListIcon from '@lucide/svelte/icons/list-checks';
	import {
		adminCrumbs,
		Card,
		ConfirmDialog,
		PageHeader,
		SearchSelect,
		enhance,
		t,
		toastEnhance
	} from '#lib/components/course-admin/kit.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const base = $derived(`/admin/${data.adminCourse.id}`);
</script>

<PageHeader
	title={data.audience.description}
	subtitle={t('Edit the audience, its tutors and its students.')}
	breadcrumbs={adminCrumbs(
		data.adminCourse,
		{ label: t('Audiences'), href: `${base}/students?tab=audiences` },
		data.audience.description
	)}
>
	{#snippet actions()}
		<a class="btn preset-tonal" href={`${base}/submissions?audiences=${data.audience.id}`}
			><ListIcon aria-hidden="true" />{t('View submissions')}</a
		>
		<ConfirmDialog
			title={t('Delete audience')}
			description={t('Are you really sure ?')}
			triggerLabel={t('Delete audience')}
			action="?/delete"
		/>
	{/snippet}
</PageHeader>

<form method="POST" action="?/update" use:enhance={toastEnhance()} class="space-y-6">
	<div class="grid items-start gap-6 lg:grid-cols-2">
		<Card title={t('General')}>
			<div class="space-y-5">
				<label class="label"
					><span class="label-text">{t('Audience description')}</span><input
						class="input"
						name="description"
						required
						value={data.audience.description}
					/></label
				>
				<fieldset>
					<legend class="label-text">{t('Tutor list')}</legend>
					<p class="mb-2 text-xs text-surface-600-400">{t('Tutors see this audience marked with a star.')}</p>
					<div class="divide-y divide-surface-200-800 rounded-base border border-surface-200-800">
						{#each data.staff as s (s.value)}<label
								class="flex items-center gap-3 px-3 py-2 text-sm hover:bg-surface-100-900"
								><input
									type="checkbox"
									class="checkbox"
									name="tutors"
									value={s.value}
									checked={data.audience.tutors.includes(s.value)}
								/>{s.label}</label
							>{/each}
					</div>
				</fieldset>
			</div>
		</Card>
		<Card title={t('Student list')} description={t('Users who are not registered yet are enrolled on save.')}>
			<SearchSelect
				name="students"
				label={t('Student list')}
				url={`${base}/search_user`}
				selected={data.audience.students}
			/>
		</Card>
	</div>
	<div class="flex justify-end">
		<button class="btn preset-filled-primary-500"><SaveIcon aria-hidden="true" />{t('Update')}</button>
	</div>
</form>
