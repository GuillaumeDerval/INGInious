<!--
@component
/group/<courseid> (NAV-16): the student's group (with "Quit group"), the
groups open to him as a card grid (with "Join in" when seats are free and the
course lets students choose) and the side column (course grade, last tried
exercises and unregistration).
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import UsersIcon from '@lucide/svelte/icons/users-round';
	import GroupCard from '#lib/components/nav/GroupCard.svelte';
	import StudentSide from '#lib/components/nav/StudentSide.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PageHeader
	title={t('Groups')}
	subtitle={data.course.name}
	breadcrumbs={[
		{ label: data.course.name, href: `/course/${data.course.id}` },
		{ label: data.mine ? t('Groups') : t('Register for a group') }
	]}
/>
<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
	<div class="min-w-0 space-y-6">
		{#if data.mine}
			<GroupCard group={data.mine} mine canLeave={data.choice} />
		{:else if !data.hasGroups}
			<EmptyState
				icon={UsersIcon}
				title={t(
					'No set group in this course. If you think this is a mistake, please contact the course administrator.'
				)}
			/>
		{:else if !data.groups.length}
			<Alert
				>{t(
					"Groups have been set up but you're not allowed to register in anyone. Please contact the course administrator."
				)}</Alert
			>
		{:else if data.choice}
			<Alert kind="warning"
				>{t(
					"You're not registered to a group. Please consider registration in one of the group below to take part in all course activities. If no more group is available, please contact the course administrator."
				)}</Alert
			>
		{:else}
			<Alert kind="warning"
				>{t(
					"You're not yet registered to a group. Please contact the course administrator for more information."
				)}</Alert
			>
		{/if}
		{#if data.groups.length}
			<div class="space-y-3">
				<h2 class="flex items-center gap-2 text-lg font-semibold">
					{t('All groups')}<Badge>{data.groups.length}</Badge>
				</h2>
				<div class="grid gap-4 md:grid-cols-2">
					{#each data.groups as group (group.id)}<GroupCard
							{group}
							canJoin={!data.mine && data.choice && group.available > 0}
						/>{/each}
				</div>
			</div>
		{/if}
	</div>
	<StudentSide course={data.course} lastTried={data.lastTried} canUnregister={data.canUnregister} grade={data.grade} />
</div>
