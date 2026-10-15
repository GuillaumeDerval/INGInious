<!--
@component
A student group of /group/<courseid> (NAV-16): description, free seats,
members (initials, real name, e-mail button) and the join / quit buttons,
which POST to the `?/join` and `?/leave` actions of the page. The user's own
group is highlighted.

Props:
- `group` (GroupView): the group.
- `mine` (boolean, default false): the user's own group ("My group" title).
- `canJoin` (boolean, default false): shows the "Join in" button.
- `canLeave` (boolean, default false): shows the "Quit group" button.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import UsersIcon from '@lucide/svelte/icons/users-round';
	import MailIcon from '@lucide/svelte/icons/mail';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import { t } from '#lib/i18n/index.js';
	import type { GroupView } from './types.js';

	export interface Props {
		group: GroupView;
		mine?: boolean;
		canJoin?: boolean;
		canLeave?: boolean;
	}
	let { group, mine = false, canJoin = false, canLeave = false }: Props = $props();
</script>

<section class={['flex flex-col overflow-hidden panel', mine && 'ring-1 ring-primary-500/40']}>
	<header class="flex items-start gap-3 border-b border-surface-200-800 px-4 py-3 sm:px-5">
		<span class="grid size-9 shrink-0 place-items-center rounded-base bg-primary-500/10 text-primary-600-400">
			<UsersIcon class="size-[1.125rem]" aria-hidden="true" />
		</span>
		<div class="min-w-0 flex-1">
			<h3 class="font-semibold break-words">{mine ? t('My group : {}', group.description) : group.description}</h3>
			{#if canJoin}<p class="text-xs text-success-700-300">{t('(available : {})', group.available)}</p>{/if}
		</div>
		{#if canJoin || canLeave}
			<form method="POST" action={canJoin ? '?/join' : '?/leave'} use:enhance={toastEnhance()}>
				<input type="hidden" name="groupid" value={group.id} />
				<button class="btn btn-sm {canJoin ? 'preset-tonal-primary' : 'preset-tonal-error'}"
					>{canJoin ? t('Join in') : t('Quit group')}</button
				>
			</form>
		{/if}
	</header>
	<ul class="flex-1 divide-y divide-surface-200-800 text-sm">
		{#each group.members as m (m.username)}
			{@const name = m.realname || m.username}
			<li class="flex items-center gap-3 px-4 py-2 sm:px-5">
				<span
					class="grid size-7 shrink-0 place-items-center rounded-full bg-surface-500/15 text-xs font-semibold"
					aria-hidden="true">{name.charAt(0).toUpperCase()}</span
				>
				<span class="min-w-0 flex-1 truncate">{name}</span>
				{#if m.email}<a
						class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal"
						href={`mailto:${m.email}`}
						title={t('Send an email')}
						aria-label={t('Send an email')}><MailIcon class="size-4" aria-hidden="true" /></a
					>{/if}
			</li>
		{:else}
			<li class="px-4 py-3 text-surface-600-400 italic sm:px-5">{t('No registered member.')}</li>
		{/each}
	</ul>
</section>
