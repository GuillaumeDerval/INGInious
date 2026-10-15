<!--
@component
Group editor (CSTU-07) for one page of the groups of a course: a toolbar (new
group, clean groups, delete all groups, both confirmed) with the number of
students in no group, then one card per group with its description, a
capacity meter (members / maximum size), the member chips and the audience
restriction, and edit / delete icon buttons. A group is edited in a side panel
(description, maximum size, members picked with a search among the registered
students, audience restriction as toggle chips); the size grows to fit the
members like legacy. Only the edited group is posted (JSON list in the `groups`
field), so the editor stays light with thousands of groups and students.

Props:
- `groups` (EditorGroup[]): groups of the page.
- `audiences` ({ id, description }[]): audiences of the course.
- `ungrouped` (number): registered students in no group.
- `action` ((name: string) => string): URL of a form action (`groups`, `deleteGroups`, `cleanGroups`).
- `pickerUrl` (string): member search endpoint (`GET ?q=` → `[{ value, label }]`).
-->
<script lang="ts" module>
	import type { Option } from '#lib/components/ui/SearchSelect.svelte';

	/** A group as edited (id null for new groups). */
	export interface EditorGroup {
		id: string | null;
		description: string;
		size: number;
		audiences: string[];
		members: Option[];
	}
</script>

<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import EraserIcon from '@lucide/svelte/icons/eraser';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import SaveIcon from '@lucide/svelte/icons/save';
	import GroupIcon from '@lucide/svelte/icons/boxes';
	import { t } from '#lib/i18n/index.js';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import ConfirmDialog from '#lib/components/ui/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import SearchSelect from '#lib/components/ui/SearchSelect.svelte';

	/** Props of GroupsEditor. */
	export interface Props {
		groups: EditorGroup[];
		audiences: { id: string; description: string }[];
		ungrouped: number;
		action: (name: string) => string;
		pickerUrl: string;
	}

	let { groups, audiences, ungrouped, action, pickerUrl }: Props = $props();
	/** Group of the side panel (a copy), null when closed. */
	let editing = $state<EditorGroup | null>(null);
	let dialog = $state<HTMLDialogElement>();
	/** Confirmation waiting in the shared dialog (form action + fields). */
	let confirm = $state<{ title: string; description: string; action: string; fields: Record<string, string> }>();
	let confirmOpen = $state(false);
	const audienceName = $derived(new Map(audiences.map((a) => [a.id, a.description])));

	/** Opens the side panel on a copy of `g`. */
	function edit(g: EditorGroup) {
		editing = { ...g, audiences: [...g.audiences], members: [...g.members] };
		dialog?.showModal();
	}
	/** Sets the members of the edited group, growing its size to fit them (legacy). */
	function resize(g: EditorGroup, members: Option[]) {
		g.members = members;
		g.size = Math.max(g.size, members.length);
	}
	/**
	 * Saves the edited group with a toast; the page is reloaded even when some students
	 * were rejected (failure result), since the rest of the group was saved.
	 */
	const save: SubmitFunction = async (input) => {
		const done = await toastEnhance()(input);
		return async (result) => {
			await done?.(result);
			await invalidateAll();
		};
	};
	/** Asks for the confirmation of a destructive action. */
	function ask(title: string, description: string, name: string, fields: Record<string, string> = {}) {
		confirm = { title, description, action: action(name), fields };
		confirmOpen = true;
	}
	/** Colour of the capacity meter: full groups are green, over-full ones amber. */
	const meter = (n: number, size: number) => (n > size ? 'warning' : n === size ? 'success' : 'primary');
	/** Text colour of the capacity count per meter colour (static class names for Tailwind). */
	const COUNT = { primary: 'text-primary-700-300', success: 'text-success-700-300', warning: 'text-warning-700-300' };
	const icon = 'btn-icon btn-icon-sm text-surface-600-400';
</script>

<div class="space-y-5">
	<div class="flex flex-wrap items-center gap-2">
		<button
			type="button"
			class="btn preset-tonal"
			onclick={() => edit({ id: null, description: t('New group'), size: 2, members: [], audiences: [] })}
			><PlusIcon aria-hidden="true" />{t('New group')}</button
		>
		<button
			type="button"
			class="btn hover:preset-tonal"
			onclick={() => ask(t('Clean groups'), t('Every student will be removed from his group.'), 'cleanGroups')}
			><EraserIcon aria-hidden="true" />{t('Clean groups')}</button
		>
		<button
			type="button"
			class="btn text-error-600-400 hover:preset-tonal-error"
			onclick={() => ask(t('Delete all groups'), t('Every group of the course will be deleted.'), 'deleteGroups')}
			><TrashIcon aria-hidden="true" />{t('Delete all groups')}</button
		>
		<span class="flex flex-1 items-center justify-end gap-2 text-sm text-surface-600-400"
			>{t('Ungrouped students')}<Badge>{ungrouped}</Badge></span
		>
	</div>

	{#if groups.length}
		<div class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
			{#each groups as g (g.id)}
				{@const tone = meter(g.members.length, g.size)}
				<article class="flex flex-col overflow-hidden panel" aria-label={g.description}>
					<header class="flex items-center gap-2 border-b border-surface-200-800 bg-surface-100-900 px-3 py-2">
						<h3 class="min-w-0 flex-1 truncate font-medium">{g.description}</h3>
						<button
							type="button"
							class="{icon} hover:preset-tonal"
							aria-label={t('Edit group')}
							title={t('Edit group')}
							onclick={() => edit(g)}><PencilIcon /></button
						>
						<button
							type="button"
							class="{icon} hover:preset-tonal-error"
							aria-label={t('Delete group')}
							title={t('Delete group')}
							onclick={() => ask(t('Delete group'), g.description, 'deleteGroups', { id: g.id! })}><TrashIcon /></button
						>
					</header>
					<div class="flex flex-1 flex-col gap-3 p-4">
						<!-- Capacity meter: members / maximum size. -->
						<div class="flex items-center gap-3">
							<div class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-200-800">
								<div
									class="h-full rounded-full bg-(--meter)"
									style:--meter={`var(--color-${tone}-500)`}
									style:width={`${Math.min(100, (100 * g.members.length) / Math.max(1, g.size))}%`}
								></div>
							</div>
							<span class={['text-sm font-semibold tabular-nums', COUNT[tone]]}>{`${g.members.length}/${g.size}`}</span>
						</div>
						<ul class="flex flex-wrap gap-1.5" aria-label={t('Members')}>
							{#each g.members as m (m.value)}
								<li class="chip bg-primary-500/10 text-primary-700-300 ring-1 ring-primary-500/25">{m.label}</li>
							{:else}<li class="text-sm text-surface-600-400">{t('No member yet.')}</li>{/each}
						</ul>
						{#if g.audiences.length}
							<p class="mt-auto flex flex-wrap items-center gap-1.5 border-t border-surface-200-800 pt-3">
								<span class="eyebrow">{t('Restrict to audiences')}</span>
								{#each g.audiences as a (a)}<Badge>{audienceName.get(a) ?? a}</Badge>{/each}
							</p>
						{/if}
					</div>
				</article>
			{/each}
		</div>
	{:else}
		<EmptyState
			icon={GroupIcon}
			title={t('No group yet: click "New group" to create one.')}
			description={t('Students can also create or join groups themselves when the course allows it.')}
		/>
	{/if}
</div>

<!-- Side panel editing one group; only that group is posted. -->
<dialog
	bind:this={dialog}
	class="ms-auto me-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-s border-surface-200-800 bg-surface-50-950 text-inherit shadow-2xl backdrop:bg-surface-950/40 backdrop:backdrop-blur-[2px]"
	aria-label={t('Edit group')}
	onclose={() => (editing = null)}
>
	{#if editing}
		{@const g = editing}
		<form
			method="POST"
			action={action('groups')}
			use:enhance={save}
			onsubmit={() => dialog?.close()}
			class="flex min-h-full flex-col"
		>
			<input
				type="hidden"
				name="groups"
				value={JSON.stringify([
					{
						id: g.id,
						description: g.description,
						size: g.size,
						audiences: g.audiences,
						students: g.members.map((m) => m.value)
					}
				])}
			/>
			<header
				class="sticky top-0 z-10 flex items-center gap-2 border-b border-surface-200-800 bg-surface-50-950 px-5 py-4"
			>
				<h2 class="min-w-0 flex-1 truncate text-base font-semibold">{t('Edit group')}</h2>
				<button type="button" class="{icon} hover:preset-tonal" aria-label={t('Close')} onclick={() => dialog?.close()}
					><XIcon /></button
				>
			</header>
			<div class="flex-1 space-y-5 p-5">
				<label class="label"
					><span class="label-text">{t('Description')}</span><input
						class="input"
						required
						bind:value={g.description}
					/></label
				>
				<label class="label"
					><span class="label-text">{t('Max group size :')}</span><input
						class="input w-24 text-end tabular-nums"
						type="number"
						min="0"
						bind:value={g.size}
					/></label
				>
				<div class="space-y-1.5">
					<p class="label-text">{t('Members')}</p>
					<SearchSelect
						name="members"
						label={t('Add student')}
						url={pickerUrl}
						placeholder={t('Search a student by name or username')}
						bind:selected={() => g.members, (m) => resize(g, m)}
					/>
				</div>
				{#if audiences.length}
					<fieldset class="space-y-1.5">
						<legend class="mb-1.5 eyebrow">{t('Restrict to audiences')}</legend>
						<div class="flex max-h-72 flex-wrap gap-1.5 overflow-y-auto">
							{#each audiences as a (a.id)}
								<label
									class={[
										'chip cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-primary-500',
										g.audiences.includes(a.id) ? 'preset-filled-primary-500' : 'preset-tonal'
									]}
									><input type="checkbox" class="sr-only" value={a.id} bind:group={g.audiences} />{a.description}</label
								>
							{/each}
						</div>
					</fieldset>
				{/if}
			</div>
			<footer
				class="sticky bottom-0 flex justify-end gap-2 border-t border-surface-200-800 bg-surface-50-950 px-5 py-3"
			>
				<button type="button" class="btn preset-tonal" onclick={() => dialog?.close()}>{t('Cancel')}</button>
				<button class="btn preset-filled-primary-500"><SaveIcon aria-hidden="true" />{t('Update')}</button>
			</footer>
		</form>
	{/if}
</dialog>

{#if confirm}
	<ConfirmDialog
		bind:open={confirmOpen}
		title={confirm.title}
		description={confirm.description}
		action={confirm.action}
		fields={confirm.fields}
	/>
{/if}
