<!--
@component
User management page (CSTU-01..08): tabs Students, Teaching staff, Audiences
and Groups (not for LTI courses). Students, audiences and groups are searched
and paginated on the server (thousands of rows); the student table has a bulk
action bar (unregistration of the checked rows, or of every student matching
the search), import/export live in secondary menus. Admin-only controls
(register/unregister, audience upload) are only shown to admins and also
checked by the server.
-->
<script lang="ts">
	import GraduationIcon from '@lucide/svelte/icons/graduation-cap';
	import StaffIcon from '@lucide/svelte/icons/user-cog';
	import AudienceIcon from '@lucide/svelte/icons/users-round';
	import GroupIcon from '@lucide/svelte/icons/boxes';
	import ListIcon from '@lucide/svelte/icons/list-checks';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import StarIcon from '@lucide/svelte/icons/star';
	import UserMinusIcon from '@lucide/svelte/icons/user-minus';
	import {
		adminCrumbs,
		Alert,
		Card,
		ConfirmDialog,
		FileDrop,
		GradeBar,
		GroupsEditor,
		MoreMenu,
		PageHeader,
		SearchSelect,
		Table,
		enhance,
		t,
		toastEnhance
	} from '#lib/components/course-admin/kit.js';
	import { page } from '$app/state';
	import Pager from '#lib/components/ui/Pager.svelte';
	import LinkTabs from '#lib/components/course-students/LinkTabs.svelte';
	import SearchForm from '#lib/components/course-students/SearchForm.svelte';
	import { withQuery } from '#lib/utils/url.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const base = $derived(`/admin/${data.adminCourse.id}`);
	let bulkForm = $state<HTMLFormElement>();
	let unregisterAll = $state(false);
	const c = $derived(data.counts);
	const tabs = $derived([
		{ id: 'students', label: t('Students'), icon: GraduationIcon, count: c.students },
		{ id: 'staff', label: t('Teaching staff'), icon: StaffIcon, count: c.staff },
		{ id: 'audiences', label: t('Audiences'), icon: AudienceIcon, count: c.audiences },
		...(c.groups === null ? [] : [{ id: 'groups', label: t('Groups'), icon: GroupIcon, count: c.groups }])
	]);
	type Member = NonNullable<PageProps['data']['staff']>[number];
	type Audience = NonNullable<PageProps['data']['audiences']>['rows'][number];
	/** URL of a page of the current list (search and tab kept). */
	const pageHref = (p: number) => withQuery(page.url, { page: p });
	/** Classes of the row icon buttons (docs/design-system.md). */
	const icon = 'btn-icon btn-icon-sm text-surface-600-400 hover:preset-tonal';
	const members = $derived([
		{ key: 'realname', label: t('Name'), text: (r: Member) => r.realname || r.username, custom: true },
		{ key: 'email', label: t('Email address'), href: (r: Member) => (r.email ? `mailto:${r.email}` : null) },
		{ key: 'task_tried', label: t('Tasks tried'), numeric: true },
		{ key: 'task_succeeded', label: t('Tasks succeeded'), numeric: true },
		{ key: 'grade', label: t('Current grade'), custom: true }
	]);
	const audienceColumns = $derived([
		{ key: 'description', label: t('Audience'), custom: true },
		{ key: 'students', label: t('Students'), text: (r: Audience) => r.students.length, numeric: true },
		{ key: 'tutors', label: t('Tutors'), text: (r: Audience) => r.tutors.length, numeric: true },
		{ key: 'tried', label: t('Tasks tried'), numeric: true },
		{ key: 'done', label: t('Tasks succeeded'), numeric: true }
	]);
</script>

<PageHeader
	title={t('User management')}
	subtitle={t('Students, teaching staff, audiences and groups of the course.')}
	breadcrumbs={adminCrumbs(data.adminCourse, t('User management'))}
>
	{#snippet actions()}<a class="btn preset-tonal" href={`${base}/submissions`}
			><ListIcon aria-hidden="true" />{t('View all submissions')}</a
		>{/snippet}
</PageHeader>

<div class="space-y-6">
	<LinkTabs {tabs} active={data.tab} />
	{#if form?.message}<Alert>{form.message}</Alert>{/if}

	{#snippet upload(action: string, label: string, accept: string, button: string)}
		<form method="POST" {action} enctype="multipart/form-data" use:enhance={toastEnhance()} class="space-y-2">
			<FileDrop name="file" {label} {accept} required />
			<button class="btn w-full preset-tonal-error">{button}</button>
		</form>
	{/snippet}

	{#snippet memberTable(rows: Member[], students: boolean)}
		<Table
			columns={members}
			{rows}
			searchable={!students}
			select={students && data.admin ? (r) => r.username : undefined}
			empty={students
				? data.q
					? t('Nothing matches your search.')
					: t('No student registered yet: add one below or let them register.')
				: undefined}
		>
			{#snippet custom(r, key)}
				{#if key === 'grade'}<div class="w-36"><GradeBar value={r.grade} /></div>
				{:else}
					<!-- Name with initials avatar and the username under it. -->
					<div class="flex items-center gap-3">
						<span
							class="grid size-8 shrink-0 place-items-center rounded-full bg-primary-500/12 text-xs font-semibold text-primary-700-300 uppercase"
							aria-hidden="true">{(r.realname || r.username).slice(0, 2)}</span
						>
						<div class="min-w-0 leading-tight">
							<a
								class="font-medium text-surface-950-50 hover:text-primary-700-300 hover:underline"
								href={`${base}/student/${r.username}`}>{r.realname || r.username}</a
							>
							<p class="font-mono text-xs text-surface-600-400">{r.username}</p>
						</div>
					</div>
				{/if}
			{/snippet}
			{#snippet actions(r)}<a
					class={icon}
					href={`${base}/submissions?users=${r.username}`}
					title={t('View submissions')}
					aria-label={t('View submissions')}><ListIcon /></a
				>{/snippet}
			{#snippet bulk()}<ConfirmDialog
					title={t('Unregister selected')}
					description={t('The selected students will be removed from the course (their submissions are kept).')}
					triggerLabel={t('Unregister selected')}
					onconfirm={() => bulkForm?.requestSubmit()}
				/>{/snippet}
		</Table>
	{/snippet}

	{#if data.students}
		{@const list = data.students}
		{@const all = data.q ? t('Unregister the {} matching students', list.matching) : t('Unregister all')}
		<Card title={t('Number of students : {}', c.students)}>
			{#snippet actions()}
				<MoreMenu label={t('More actions')} iconOnly summaryClass="hover:preset-tonal" class="w-60 p-1.5">
					<a class="menu-item" href={`${base}/students/students.csv`} download
						><DownloadIcon aria-hidden="true" />{t('Download CSV')}</a
					>
					{#if data.admin}<button
							type="button"
							class="menu-item text-error-600-400"
							onclick={() => (unregisterAll = true)}><UserMinusIcon aria-hidden="true" />{all}</button
						>{/if}
				</MoreMenu>
				{#if data.admin}<ConfirmDialog
						bind:open={unregisterAll}
						title={all}
						description={t(
							'This will remove {} from the course. Are you sure ?',
							data.q ? t('{} students', list.matching) : t('all students')
						)}
						action="?/unregister"
						fields={{ all: '1', q: data.q }}
					/>{/if}
			{/snippet}
			<SearchForm q={data.q} matching={list.matching} placeholder={t('Name, username or email')} />
			<form method="POST" action="?/unregister" bind:this={bulkForm}>
				{@render memberTable(list.rows, true)}
			</form>
			<div class="mt-3"><Pager page={list.page} pages={list.pages} href={pageHref} /></div>
			{#if data.admin}
				<form
					method="POST"
					action="?/register"
					use:enhance={toastEnhance()}
					class="mt-5 flex flex-col gap-2 border-t border-surface-200-800 pt-5 sm:flex-row sm:items-end"
				>
					<div class="min-w-0 flex-1">
						<SearchSelect
							name="username"
							label={t('Add student')}
							url={`${base}/search_user`}
							multiple={false}
							placeholder={t('Search a user by name, username or email')}
						/>
					</div>
					<button class="btn preset-filled-primary-500"><PlusIcon aria-hidden="true" />{t('Add student')}</button>
				</form>
			{/if}
		</Card>
	{:else if data.staff}
		<Card
			title={t('Teaching staff')}
			description={t('Administrators and tutors of the course (set in the course settings).')}
			>{@render memberTable(data.staff, false)}</Card
		>
	{:else if data.audiences}
		{@const list = data.audiences}
		<Card
			title={t('Audiences (class groups)')}
			description={t(
				'Audiences are named sets of students with their tutors, used to filter submissions and statistics.'
			)}
		>
			{#snippet actions()}
				<a class="btn preset-tonal" href={`${base}/submissions?audiences=${list.ids.join(',')}`}
					><ListIcon aria-hidden="true" />{t('Submissions of all audiences')}</a
				>
				<MoreMenu label={t('Import / export')} class="w-80 space-y-3 p-3">
					<a class="menu-item" href={`${base}/students/audiences.csv`} download
						><DownloadIcon aria-hidden="true" />{t('Download CSV')}</a
					>
					<form method="GET" action={`${base}/students/audiences-structure.csv`} class="space-y-2 px-1">
						<p class="eyebrow">{t('Structure')}</p>
						<div class="flex gap-2">
							<select class="select field-sm" name="preferred_field" aria-label={t('Identify users by')}
								><option value="username">{t('Username')}</option><option value="email">{t('Email address')}</option
								></select
							>
							<button class="btn preset-tonal btn-sm"
								><DownloadIcon aria-hidden="true" />{t('Download structure')}</button
							>
						</div>
					</form>
					{#if data.admin}<div class="space-y-2 border-t border-surface-200-800 px-1 pt-3">
							{@render upload(
								'?tab=audiences&/audiences',
								t('Upload audiences (CSV: user, username|email, student|tutor, audience)'),
								'.csv,text/csv',
								t('Upload (will erase current repartition)')
							)}
						</div>{/if}
				</MoreMenu>
			{/snippet}
			<SearchForm
				q={data.q}
				matching={list.matching}
				hidden={{ tab: 'audiences' }}
				placeholder={t('Search an audience')}
			/>
			<Table
				columns={audienceColumns}
				rows={list.rows}
				searchable={false}
				empty={data.q ? t('Nothing matches your search.') : t('No audience yet: create one below.')}
			>
				{#snippet custom(r)}
					<span class="flex items-center gap-2"
						><a
							class="font-medium text-surface-950-50 hover:text-primary-700-300 hover:underline"
							href={`${base}/edit/audience/${r.id}`}>{r.description}</a
						>{#if r.mine}<span title={t('You tutor this audience')}
								><StarIcon
									class="size-3.5 fill-current text-warning-500"
									aria-label={t('You tutor this audience')}
								/></span
							>{/if}</span
					>
				{/snippet}
				{#snippet actions(r)}
					<a
						class={icon}
						href={`${base}/edit/audience/${r.id}`}
						title={t('Edit audience')}
						aria-label={t('Edit audience')}><PencilIcon /></a
					>
					<a
						class={icon}
						href={`${base}/submissions?audiences=${r.id}`}
						title={t('View submissions')}
						aria-label={t('View submissions')}><ListIcon /></a
					>
				{/snippet}
			</Table>
			<div class="mt-3"><Pager page={list.page} pages={list.pages} href={pageHref} /></div>
			<form
				method="POST"
				action="?tab=audiences&/audience"
				use:enhance={toastEnhance()}
				class="mt-5 flex flex-col gap-2 border-t border-surface-200-800 pt-5 sm:flex-row"
			>
				<input
					class="input"
					name="description"
					required
					aria-label={t('New audience description')}
					placeholder={t('New audience description')}
				/>
				<button class="btn preset-filled-primary-500"><PlusIcon aria-hidden="true" />{t('New audience')}</button>
			</form>
		</Card>
	{:else if data.groups}
		<Card
			title={t('Groups')}
			description={t('Groups submit group tasks together; a student belongs to at most one group.')}
		>
			{#snippet actions()}
				<MoreMenu label={t('Import / export')} class="w-80 space-y-3 p-3">
					<a class="menu-item" href={`${base}/students/groups.yaml`} download
						><DownloadIcon aria-hidden="true" />{t('Download structure')}</a
					>
					<div class="border-t border-surface-200-800 px-1 pt-3">
						{@render upload(
							'?tab=groups&/uploadGroups',
							t('Groups YAML file'),
							'.yaml,.yml',
							t('Upload (will erase current settings)')
						)}
					</div>
				</MoreMenu>
			{/snippet}
			<SearchForm
				q={data.q}
				matching={data.groups.matching}
				hidden={{ tab: 'groups' }}
				placeholder={t('Search a group or a member')}
			/>
			<GroupsEditor
				groups={data.groups.groups}
				audiences={data.groups.audiences}
				ungrouped={data.groups.ungrouped}
				action={(name) => `?tab=groups&/${name}`}
				pickerUrl={`${base}/students/students.json`}
			/>
			<div class="mt-4"><Pager page={data.groups.page} pages={data.groups.pages} href={pageHref} /></div>
		</Card>
	{/if}
</div>
