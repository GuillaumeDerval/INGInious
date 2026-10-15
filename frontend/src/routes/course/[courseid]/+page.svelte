<!--
@component
/course/<courseid> (NAV-09..15): header with the "Course administration"
button of staff, page alerts (hidden course, sign-in or enrollment
invitation in preview mode), the progress card of registered users (grade,
tasks succeeded), the collapsible "About this course", category filter chips
and the task list (or an empty state explaining why no task is visible); side
column of registered students with the last tried exercises and the
unregistration dialog.
-->
<script lang="ts">
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import ChevronIcon from '@lucide/svelte/icons/chevron-right';
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import { t } from '#lib/i18n/index.js';
	import { formatGrade } from '#lib/utils/grade.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import GradeBar from '#lib/components/ui/GradeBar.svelte';
	import RichText from '#lib/components/common/RichText.svelte';
	import TaskList, { countTasks } from '#lib/components/nav/TaskList.svelte';
	import StudentSide from '#lib/components/nav/StudentSide.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let category = $state('');
	const course = $derived(data.course);
	const side = $derived(data.registered && !data.staff);
</script>

<PageHeader
	title={course.name}
	breadcrumbs={[
		data.registered ? { label: t('My courses'), href: '/mycourses' } : { label: t('Course list'), href: '/courselist' },
		{ label: course.name }
	]}
>
	{#snippet actions()}
		{#if data.staff}<a class="btn preset-tonal" href={`/admin/${course.id}`}
				><SettingsIcon aria-hidden="true" />{t('Course administration')}</a
			>{/if}
	{/snippet}
</PageHeader>
<div class={['grid gap-6', side && 'lg:grid-cols-[minmax(0,1fr)_18rem]']}>
	<div class="min-w-0 space-y-6">
		{#if data.hidden || data.anonymous || data.canRegister}
			<div class="space-y-3">
				{#if data.hidden}<Alert kind="warning"
						>{t(
							'This course is currently invisible for students. You can change this by modifying the "accessibility" option in the configuration of the course.'
						)}</Alert
					>{/if}
				{#if data.anonymous}<Alert
						>{t(
							'Please register or sign in to see the complete list of courses and be able to submit answers to problems.'
						)} <a class="anchor" href={`/signin?redirect=/course/${course.id}`}>{t('Sign in')}</a></Alert
					>{/if}
				{#if data.canRegister}<Alert kind="info" title={t('Enroll in the course')}
						>{t('Please enroll in the course to be able to submit answers to problems.')}
						<a class="mt-2 btn preset-filled-primary-500 btn-sm" href={`/register/${course.id}`}
							>{t('Enroll in the course')}</a
						></Alert
					>{/if}
			</div>
		{/if}
		{#if data.registered && data.total}
			<section class="flex flex-wrap items-center gap-x-6 gap-y-3 panel p-4 sm:p-5" aria-label={t('Current grade')}>
				<div>
					<p class="eyebrow">{t('Current grade')}</p>
					<p class="text-2xl font-semibold tabular-nums">{formatGrade(data.grade)}</p>
				</div>
				<div class="min-w-48 flex-1 space-y-1.5">
					<GradeBar value={data.grade} label={t('Current grade')} showValue={false} />
					<p class="text-sm text-surface-600-400">{t('{} / {} tasks succeeded', data.succeeded, data.total)}</p>
				</div>
			</section>
		{/if}
		{#if course.description}
			<details class="group panel">
				<summary
					class="flex list-none items-center gap-2 px-4 py-3 font-semibold select-none sm:px-5 [&::-webkit-details-marker]:hidden"
				>
					<ChevronIcon
						class="size-4 text-surface-500 transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90"
						aria-hidden="true"
					/>{t('About this course')}
				</summary>
				<RichText html={course.description} class="border-t border-surface-200-800 px-4 py-4 sm:px-5" />
			</details>
		{/if}
		{#if course.categories.length}
			<div class="flex flex-wrap gap-1.5" role="group" aria-label={t('Filter tasks by category')}>
				{#each ['', ...course.categories] as c (c)}
					<button
						type="button"
						class="chip {category === c ? 'preset-filled-primary-500' : 'preset-tonal'}"
						aria-pressed={category === c}
						onclick={() => (category = c)}>{c || t('All')}</button
					>
				{/each}
			</div>
		{/if}
		{#if countTasks(data.sections)}
			<div class="space-y-4">
				<TaskList sections={data.sections} courseid={course.id} registered={data.registered} {category} />
			</div>
		{:else if data.staff}
			<EmptyState
				icon={ListTodoIcon}
				title={t('No task is visible yet')}
				description={t('Open the task list to add tasks or to set their accessibility.')}
				><a class="btn preset-filled-primary-500" href={`/admin/${course.id}/tasks`}>{t('Task list')}</a></EmptyState
			>
		{:else}
			<EmptyState
				icon={ListTodoIcon}
				title={t('No task available yet')}
				description={t('Your teachers have not opened any task yet. Come back later!')}
			/>
		{/if}
	</div>
	{#if side}<StudentSide {course} lastTried={data.lastTried} canUnregister={data.canUnregister} />{/if}
</div>
