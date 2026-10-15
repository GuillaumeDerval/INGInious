<!--
@component
/administrator/users (SITE-01..05): toolbar with the search form and the
"Add user" menu, then the paginated user table: member (name and username),
e-mail, external bindings (each revocable with a small icon button) and the
activate/delete icon buttons. Every action is confirmed by one shared dialog
and posted as a form action (`?/activate`, `?/delete`, `?/revoke`). The
current user's row has no activate/delete action.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import PlusIcon from '@lucide/svelte/icons/user-plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import CheckIcon from '@lucide/svelte/icons/user-check';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { t } from '#lib/i18n/index.js';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import FormField from '#lib/components/ui/FormField.svelte';
	import MoreMenu from '#lib/components/ui/MoreMenu.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import ConfirmDialog from '#lib/components/ui/ConfirmDialog.svelte';
	import DataTable from '#lib/components/ui/DataTable.svelte';
	import Pager from '#lib/components/ui/Pager.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const pageUrl = (p: number) => `?q=${encodeURIComponent(data.q)}&page=${p}`;
	const fields = [
		['username', 'Username (min. 4 alphanumerical characters) :', 'text'],
		['realname', 'Complete name :', 'text'],
		['email', 'Email address :', 'email'],
		['password', 'Password (min. 6 characters) :', 'password']
	];
	const labels = { realname: t('member'), email: t('email address'), bindings: t('Available bindings'), actions: '' };
	const columns = Object.entries(labels).map(([key, label]) => ({ key, label, class: 'first-letter:uppercase' }));

	/** Action waiting for confirmation in the shared dialog. */
	interface Pending {
		title: string;
		description: string;
		confirmLabel?: string;
		tone?: 'error' | 'primary';
		action: string;
		fields: Record<string, string>;
	}
	let pending = $state<Pending | null>(null);
	let open = $state(false);
	/** Opens the confirmation dialog for `p`. */
	const confirm = (p: Pending) => ((pending = p), (open = true));
</script>

<PageHeader
	title={t('Users Administration')}
	subtitle={t('Search, create, activate and delete the accounts of this platform.')}
	breadcrumbs={[{ label: t('Users Admin') }]}
/>
<div class="space-y-4">
	{#if form?.message}<Alert kind={page.status >= 400 ? 'error' : 'success'}>{form.message}</Alert>{/if}
	<div class="flex flex-wrap items-center justify-between gap-3">
		<form class="flex w-full gap-2 sm:w-auto" role="search">
			<label class="relative flex-1 sm:w-72">
				<SearchIcon class="absolute start-3 top-2.5 size-4 text-surface-500" aria-hidden="true" />
				<input class="input ps-9!" name="q" value={data.q} aria-label={t('Search')} placeholder={t('Search')} />
			</label>
			<button class="btn preset-tonal">{t('Search')}</button>
		</form>
		<div class="ms-auto">
			<MoreMenu label={t('Add user')} icon={PlusIcon} class="w-80 max-w-[calc(100vw-2rem)] p-4">
				<form method="POST" action="?/add" use:enhance={toastEnhance()} class="space-y-3">
					{#each fields as [name, label, type] (name)}
						<FormField label={t(label)}>
							{#snippet children(a)}<input {...a} class="input" {name} {type} required autocomplete="off" />{/snippet}
						</FormField>
					{/each}
					<button class="btn w-full preset-filled-primary-500">{t('Add')}</button>
				</form>
			</MoreMenu>
		</div>
	</div>
	<DataTable {columns} rows={data.rows} empty={t('No user found.')}>
		{#snippet row(u)}
			<tr>
				<td>
					<p class="font-medium">{u.realname || u.username}</p>
					<p class="text-xs text-surface-600-400">{u.username}</p>
				</td>
				<td><a class="anchor" href={`mailto:${u.email}`}>{u.email}</a></td>
				<td>
					<div class="flex flex-wrap gap-1.5">
						{#each Object.entries(u.bindings) as [id, ident] (id)}
							<span class="inline-flex items-center gap-1">
								<Badge>{`${id} · ${ident}`}</Badge>
								<button
									type="button"
									class="btn-icon size-6! text-surface-500 btn-icon-sm hover:preset-tonal-error"
									title={t('Revoke access')}
									aria-label={t('Revoke access')}
									onclick={() =>
										confirm({
											title: t('Revoke access'),
											description: `${u.username} — ${id}`,
											action: '?/revoke',
											fields: { username: u.username, binding_id: id }
										})}><XIcon class="size-3.5" aria-hidden="true" /></button
								>
							</span>
						{/each}
					</div>
				</td>
				<td class="text-end whitespace-nowrap">
					{#if u.username !== data.me}
						{#if u.pending}
							<button
								type="button"
								class="btn-icon text-primary-600-400 btn-icon-sm hover:preset-tonal-primary"
								title={t('Activate')}
								aria-label={t('Activate')}
								onclick={() =>
									confirm({
										title: t('Activate {}', u.username),
										description: t('This will activate {}.', u.username),
										confirmLabel: t('Activate'),
										tone: 'primary',
										action: '?/activate',
										fields: { username: u.username }
									})}><CheckIcon class="size-4" aria-hidden="true" /></button
							>
						{/if}
						<button
							type="button"
							class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal-error"
							title={t('Delete')}
							aria-label={t('Delete')}
							onclick={() =>
								confirm({
									title: t('Delete {}', u.username),
									description: t('This will delete {}. Are you sure ?', u.username),
									confirmLabel: t('Remove'),
									action: '?/delete',
									fields: { username: u.username }
								})}><TrashIcon class="size-4" aria-hidden="true" /></button
						>
					{/if}
				</td>
			</tr>
		{/snippet}
	</DataTable>
	<Pager page={data.page} pages={data.pages} href={pageUrl} />
</div>
{#if pending}
	<ConfirmDialog
		bind:open
		title={pending.title}
		description={pending.description}
		confirmLabel={pending.confirmLabel}
		tone={pending.tone}
		action={pending.action}
		fields={pending.fields}
	/>
{/if}
