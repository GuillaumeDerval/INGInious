<!--
@component
/mycourses dashboard (NAV-02/03/04/21): "Continue where you left off" strip,
then the user's course cards (pinned first, server order), which can be
filtered with chips (All, Pinned, Archive, LTI, Hidden: links) and searched by
name, one page at a time (server-side search, filter and pagination);
each card shows the pin star (a POST to `?/pin`, progressively enhanced), the
role and course state badges, the grade bar, the tasks succeeded and the next
deadline, and opens the course. Superadmins get a "Create new course" menu.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import StarIcon from '@lucide/svelte/icons/star';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { page } from '$app/state';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import { t } from '#lib/i18n/index.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import DateTime from '#lib/components/ui/DateTime.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import GradeBar from '#lib/components/ui/GradeBar.svelte';
	import MoreMenu from '#lib/components/ui/MoreMenu.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Pager from '#lib/components/ui/Pager.svelte';
	import ListSearch from '#lib/components/nav/ListSearch.svelte';
	import { actionUrl, withQuery } from '#lib/utils/url.js';
	import CourseCard from '#lib/components/nav/CourseCard.svelte';
	import DeadlineChip from '#lib/components/nav/DeadlineChip.svelte';
	import LastTried from '#lib/components/nav/LastTried.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const FILTERS = [
		['', t('All')],
		['pinned', t('Pinned')],
		['archived', t('Archive')],
		['lti', 'LTI'],
		['hidden', t('Hidden')]
	] as const;
	const ROLES = { admin: t('Administrator'), tutor: t('Tutor'), student: t('Student') };
</script>

<PageHeader title={t('My courses')} subtitle={t('Pick up where you left off and follow your progress in each course.')}>
	{#snippet actions()}
		{#if data.superadmin}
			<MoreMenu label={t('Create new course')} icon={PlusIcon} class="w-72 p-4">
				<form method="POST" action={actionUrl(page.url, 'create')} use:enhance={toastEnhance()} class="space-y-3">
					<input
						class="input"
						name="new_courseid"
						placeholder={t('New course id')}
						aria-label={t('New course id')}
						required
					/>
					<button class="btn w-full preset-filled-primary-500">{t('Create new course')}</button>
				</form>
			</MoreMenu>
		{/if}
	{/snippet}
</PageHeader>
<div class="space-y-8">
	<LastTried items={data.lastTried} showCourse strip />
	<section class="space-y-4" aria-label={t('My courses')}>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex flex-wrap gap-1.5" role="group" aria-label={t('Filter')}>
				{#each FILTERS as [flag, label] (flag)}
					<a
						class="chip {data.filter === flag ? 'preset-filled-primary-500' : 'preset-tonal'}"
						aria-current={data.filter === flag ? 'true' : undefined}
						href={withQuery(page.url, { filter: flag || null, page: null })}
						data-sveltekit-noscroll
						data-sveltekit-replacestate>{label}</a
					>
				{/each}
			</div>
			<ListSearch value={data.q} label={t('Search a course by its name')} params={{ filter: data.filter }} />
		</div>
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#each data.courses as c (c.id)}
				<CourseCard id={c.id} name={c.name} href={`/course/${c.id}`}>
					{#snippet meta()}
						<Badge tone={c.role === 'student' ? 'neutral' : 'primary'}>{ROLES[c.role]}</Badge>
						{#if c.lti}<Badge>{t('LTI course')}</Badge>{:else if c.archived}<Badge tone="warning"
								>{t('Archive')} - <DateTime value={c.archiveDate} mode="date" /></Badge
							>{:else if c.hidden}<Badge>{t('Hidden course')}</Badge>{/if}
					{/snippet}
					{#snippet aside()}
						<form method="POST" action={actionUrl(page.url, 'pin')} use:enhance={toastEnhance()}>
							<input type="hidden" name="courseid" value={c.id} />
							<button
								class="btn-icon text-surface-500 btn-icon-sm hover:preset-tonal"
								aria-pressed={c.pinned}
								aria-label={c.pinned ? t('Unpin') : t('Pin')}
								title={c.pinned ? t('Unpin') : t('Pin')}
							>
								<StarIcon
									class={['size-4', c.pinned && 'fill-secondary-400 text-secondary-600-400']}
									aria-hidden="true"
								/>
							</button>
						</form>
					{/snippet}
					<div class="mt-auto space-y-2">
						<GradeBar value={c.grade} />
						<p class="flex flex-wrap items-center justify-between gap-2 text-sm text-surface-600-400">
							{t('{} / {} tasks succeeded', c.succeeded, c.total)}<DeadlineChip value={c.deadline} />
						</p>
					</div>
				</CourseCard>
			{/each}
		</div>
		<Pager page={data.page} pages={data.pages} href={(p) => withQuery(page.url, { page: p })} />
		{#if !data.total}
			<EmptyState
				title={t('You are not registered to any course')}
				description={t('Find a course in the course list and register to it.')}
				><a class="btn preset-filled-primary-500" href="/courselist">{t('Course list')}</a></EmptyState
			>
		{:else if !data.courses.length}
			<EmptyState compact icon={SearchIcon} title={t('No course found.')} />
		{/if}
	</section>
</div>
