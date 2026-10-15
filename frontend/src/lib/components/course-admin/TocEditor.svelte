<!--
@component
Course structure editor of the toc / combinatory test / contest dispensers
(CADM-07/08/09), reference page of docs/design-system.md. Sections are cards
(nested; pools without sub-sections for the combinatory test) whose task rows
show a drag handle, the name, id and settings badges, and icon actions (settings,
edit, a "more" menu with view/submissions, and a delete menu); sections and tasks
are reordered by drag & drop or with the "Move up/down" icon buttons of their row (revealed on hover or keyboard
focus with a mouse, always shown on touch screens; always in the tab order); tasks are added (existing folders or new ids), removed from
the structure, deleted (folder) and optionally wiped (submissions); task
settings are edited in a side panel (summarised by badges), for one task or every selected task. Nothing
is written before "Save changes" (posted as JSON to `?/save`). Large structures (more than
`FOLDED_TASKS` tasks) start with the task rows of every section folded (shown on demand), so that
thousands of tasks do not all render at once. Very old task lists stored as `{taskid: rank}` mappings
are edited (and saved) as lists.

Props:
- `kind` (string): dispenser id.
- `structure` ({toc, config}): stored `dispenser_data` (copied, never mutated).
- `tasks` (Record<id, name>): loadable task folders; `errors` (Record<id, message>): broken ones.
- `courseid` (string).
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '#lib/i18n/index.js';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import GripIcon from '@lucide/svelte/icons/grip-vertical';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ListIcon from '@lucide/svelte/icons/list-tree';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { SvelteSet } from 'svelte/reactivity';
	import XIcon from '@lucide/svelte/icons/x';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import MoreMenu from '#lib/components/ui/MoreMenu.svelte';
	import { isValidId } from '#lib/utils/ids.js';
	import { TASK_CONFIG_DEFAULTS } from '#lib/utils/task-config.js';
	import SaveBar from './SaveBar.svelte';
	import SpecForm from './SpecForm.svelte';
	import { sectionSpec, taskConfigSpec, type Values } from './specs.js';

	/** A section, in the `dispenser_data.toc` format. */
	interface Section {
		title: string;
		config: Values;
		tasks_list?: string[];
		sections_list?: Section[];
	}

	/** Props of TocEditor. */
	export interface Props {
		kind: string;
		structure: { toc: unknown; config: unknown };
		tasks: Record<string, string>;
		errors: Record<string, string>;
		courseid: string;
	}

	let { kind, structure, tasks, errors, courseid }: Props = $props();
	// The editor owns its copy of the structure (the page remounts it after a save).
	// svelte-ignore state_referenced_locally
	const initial = structuredClone(structure) as { toc: Section[]; config: Record<string, Values> };
	const fix = (list: Section[]): unknown =>
		list.forEach((s) => {
			s.config ??= {};
			if (s.tasks_list && !Array.isArray(s.tasks_list)) s.tasks_list = Object.keys(s.tasks_list);
			fix(s.sections_list ?? []);
		});
	fix(initial.toc);
	let toc = $state(initial.toc);
	let config = $state(initial.config);
	// Task ids to create / delete (folder) / wipe (submissions) at save, and the checked tasks.
	const p = $state({
		created: [] as string[],
		deleted: [] as string[],
		wiped: [] as string[],
		selected: [] as string[]
	});
	let error = $state('');
	/** Settings dialog: edited values and the tasks they apply to. */
	let editing = $state<{ ids: string[]; values: Values } | null>(null);
	let dialog = $state<HTMLDialogElement>();
	let drag: { list: unknown[]; i: number; kind: string } | null = null;

	/** A new empty section. */
	const newSection = (): Section => ({ title: t('New section'), config: {}, tasks_list: [] });
	const all = (list: Section[]): string[] => list.flatMap((s) => s.tasks_list ?? all(s.sections_list!));
	const unplaced = $derived.by(() => {
		const placed = new Set(all(toc));
		return Object.keys(tasks).filter((id) => !placed.has(id));
	});
	/** Number of tasks above which the task rows start folded. */
	const FOLDED_TASKS = 200;
	/** Sections whose task rows are folded. */
	const folded = new SvelteSet<Section>();
	if (all(toc).length > FOLDED_TASKS) {
		const fold = (list: Section[]): unknown => list.forEach((s) => (folded.add(s), fold(s.sections_list ?? [])));
		fold(toc);
	}

	const inside = (s: Section, l: unknown[]): boolean =>
		s.sections_list === l || !!s.sections_list?.some((x) => inside(x, l));
	/** Moves an item of a list (drag & drop or arrows); sections never enter themselves. */
	function move(from: unknown[], i: number, to: unknown[], j: number) {
		const item = from[i] as Section;
		if (typeof item !== 'object' || !inside(item, to))
			to.splice(from === to && i < j ? j - 1 : j, 0, from.splice(i, 1)[0]);
	}
	/** Drag & drop attributes of an item `i` (or the end) of a list of tasks or sections. */
	const dnd = (list: unknown[], i: number, kind: 'task' | 'section') => ({
		draggable: true,
		ondragstart: (e: DragEvent) => (e.stopPropagation(), (drag = { list, i, kind })),
		ondragover: (e: DragEvent) => e.preventDefault(),
		ondrop: (e: DragEvent) => (
			e.preventDefault(),
			e.stopPropagation(),
			drag?.kind === kind && move(drag.list, drag.i, list, i),
			(drag = null)
		)
	});

	/** Adds the task id of the submitted form to a section (new ids are created on save). */
	function addTask(s: Section, e: SubmitEvent & { currentTarget: HTMLFormElement }) {
		e.preventDefault();
		const id = String(new FormData(e.currentTarget).get('id')).trim();
		if (!isValidId(id))
			return void (error = t('Task id should only contain alphanumeric characters (in addition to "_" and "-").'));
		if (!(id in tasks) && !(id in errors) && !p.created.includes(id)) p.created.push(id);
		s.tasks_list!.push(id);
		config[id] ??= {};
		e.currentTarget.reset();
		error = '';
	}
	/** Removes tasks from the structure; `mode` also deletes their folder and/or submissions. */
	function removeTasks(ids: string[], mode: 'keep' | 'delete' | 'wipe') {
		const strip = (list: Section[]): void =>
			list.forEach((s) =>
				s.tasks_list
					? s.tasks_list.splice(0, Infinity, ...s.tasks_list.filter((x) => !ids.includes(x)))
					: strip(s.sections_list!)
			);
		strip(toc);
		for (const id of ids) {
			delete config[id];
			if (mode !== 'keep' && !p.created.includes(id)) p.deleted.push(id);
			if (mode === 'wipe') p.wiped.push(id);
		}
		p.created = p.created.filter((x) => !ids.includes(x));
		p.selected = p.selected.filter((x) => !ids.includes(x));
	}
	/** Summary badges of a task's settings (a task without accessibility is hidden from students). */
	const badges = (c: Values = {}) =>
		[
			`${t('Weight')} ${c.weight ?? 1}`,
			!c.accessibility && t('Hidden'),
			Number((c.submission_limit as { amount?: number })?.amount) > 0 && t('Limited submissions'),
			c.group_submission && t('Group')
		].filter(Boolean);
	/** Opens the settings dialog for tasks (values of the first one, defaults included). */
	function editSettings(ids: string[]) {
		editing = {
			ids,
			values: { ...structuredClone(TASK_CONFIG_DEFAULTS), ...structuredClone($state.snapshot(config[ids[0]] ?? {})) }
		};
		dialog?.showModal();
	}
	/** Copies the edited settings to every edited task. */
	function applySettings() {
		for (const id of editing!.ids) config[id] = structuredClone($state.snapshot(editing!.values));
		dialog?.close();
	}
</script>

{#snippet removeMenu(ids: string[], label: string, iconOnly = false)}
	<MoreMenu
		{label}
		{iconOnly}
		icon={iconOnly ? TrashIcon : null}
		summaryClass={iconOnly ? 'btn-icon-sm text-surface-600-400 hover:preset-tonal-error' : 'preset-tonal-error'}
		class="flex w-72 flex-col p-1.5"
	>
		<p class="px-2.5 pt-1 pb-1.5 eyebrow">{t('Remove from the task list')}</p>
		{#each [['keep', 'Keep files'], ['delete', 'Delete task files'], ['wipe', 'Delete task files and all submissions']] as const as [mode, label] (mode)}
			<button
				type="button"
				class={['menu-item', mode !== 'keep' && 'text-error-600-400']}
				onclick={() => removeTasks(ids, mode)}>{t(label)}</button
			>
		{/each}
	</MoreMenu>
{/snippet}

<!-- Keyboard alternative to drag & drop: icon buttons of the row (`group/row`), hidden until the row is
     hovered or focused when a mouse is used; the first/last item keeps an invisible placeholder. -->
{#snippet arrows(list: unknown[], i: number)}
	{#each [[-1, 'Move up', ArrowUpIcon], [2, 'Move down', ArrowDownIcon]] as const as [delta, label, Icon] (label)}
		<button
			type="button"
			class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal disabled:invisible pointer-fine:not-group-focus-within/row:not-group-hover/row:opacity-0"
			aria-label={t(label)}
			title={t(label)}
			disabled={delta < 0 ? i === 0 : i === list.length - 1}
			onclick={() => move(list, i, list, i + delta)}><Icon /></button
		>
	{/each}
{/snippet}

{#snippet handle()}
	<GripIcon class="hidden size-4 shrink-0 cursor-grab text-surface-400-600 sm:block" aria-hidden="true" />
{/snippet}

{#snippet sections(list: Section[], depth: number)}
	{#each list as s, i (s)}
		<section class={['panel', depth && 'shadow-none']} {...dnd(list, i, 'section')}>
			<header
				class={[
					'group/row flex items-center gap-2 py-2 ps-2 pe-3',
					!folded.has(s) && 'border-b border-surface-200-800'
				]}
			>
				{@render handle()}
				<button
					type="button"
					class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal"
					aria-expanded={!folded.has(s)}
					aria-label={folded.has(s) ? t('Show') : t('Hide')}
					title={folded.has(s) ? t('Show') : t('Hide')}
					onclick={() => (folded.has(s) ? folded.delete(s) : folded.add(s))}
					><ChevronRightIcon class={['transition-transform', folded.has(s) ? 'rtl:rotate-180' : 'rotate-90']} /></button
				>
				<input
					class="input min-w-0 flex-1 bg-transparent font-semibold ring-transparent field-sm hover:ring-surface-300-700"
					aria-label={t('Section title')}
					bind:value={s.title}
				/>
				<Badge>{all([s]).length}</Badge>
				<span class="flex items-center">
					{@render arrows(list, i)}
				</span>
				<button
					type="button"
					class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal-error"
					aria-label={t('Delete section')}
					title={t('Delete section')}
					onclick={() => (removeTasks(all([s]), 'keep'), list.splice(i, 1))}><TrashIcon /></button
				>
			</header>
			{#if !folded.has(s)}
				<div
					class="border-b border-surface-200-800 bg-surface-100-900/50 px-4 py-2.5 text-sm *:flex *:flex-wrap *:items-center *:gap-x-6 *:gap-y-2"
				>
					<SpecForm fields={sectionSpec(kind)} values={s.config} />
				</div>
				{#if s.sections_list}
					<div class="space-y-3 p-3">
						{@render sections(s.sections_list, depth + 1)}
						<button type="button" class="btn preset-tonal btn-sm" onclick={() => s.sections_list!.push(newSection())}
							><PlusIcon />{t('Add subsection')}</button
						>
					</div>
				{:else}
					<ul
						class="divide-y divide-surface-200-800 empty:hidden"
						{...dnd(s.tasks_list!, s.tasks_list!.length, 'task')}
						draggable={false}
					>
						{#each s.tasks_list! as id, j (id + j)}
							{@const valid = id in tasks || p.created.includes(id)}
							<li
								class="group/row flex flex-wrap items-center gap-x-2 gap-y-1 py-2 ps-2 pe-3 hover:bg-surface-100-900/60"
								{...dnd(s.tasks_list!, j, 'task')}
							>
								{@render handle()}
								<input type="checkbox" class="checkbox" aria-label={t('Select')} bind:group={p.selected} value={id} />
								<div class="flex min-w-40 flex-1 flex-wrap items-center gap-x-2 gap-y-1 ps-1">
									<span class={['text-sm font-medium', !valid && 'text-error-600-400']}>
										{tasks[id] ??
											(p.created.includes(id)
												? t('New task with id: {}', id)
												: errors[id]
													? t('Error in task with id {} : {}', id, errors[id])
													: t('No valid task with id: {}', id))}
									</span>
									<code class="text-xs text-surface-500">{id}</code>
									{#each badges(config[id]) as b (b)}<Badge>{b}</Badge>{/each}
								</div>
								<!-- Actions wrap under the name on narrow screens. -->
								<div class="ms-auto flex items-center">
									{@render arrows(s.tasks_list!, j)}
									<button
										type="button"
										class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal"
										aria-label={t('Task settings')}
										title={t('Task settings')}
										onclick={() => editSettings([id])}><SettingsIcon /></button
									>
									<a
										class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal"
										href={`/admin/${courseid}/edit/task/${id}`}
										aria-label={t('Edit task')}
										title={t('Edit task')}><PencilIcon /></a
									>
									<MoreMenu
										label={t('More actions')}
										iconOnly
										summaryClass="btn-icon-sm text-surface-600-400 hover:preset-tonal"
										class="w-52 p-1.5"
									>
										<a class="menu-item" href={`/course/${courseid}/${id}`}><EyeIcon />{t('View task')}</a>
										<a class="menu-item" href={`/admin/${courseid}/submissions?tasks=${id}`}
											><InboxIcon />{t('View submissions')}</a
										>
									</MoreMenu>
									{@render removeMenu([id], t('Delete'), true)}
								</div>
							</li>
						{/each}
					</ul>
					<form class="flex flex-wrap items-center gap-2 px-3 py-2.5" onsubmit={(e) => addTask(s, e)}>
						<input
							class="input max-w-56 font-mono field-sm"
							name="id"
							list="unplaced-tasks"
							aria-label={t('Task id')}
							placeholder={t('Task id')}
						/>
						<button class="btn preset-tonal btn-sm"><PlusIcon />{t('Add task')}</button>
						{#if kind !== 'combinatory_test' && !s.tasks_list!.length}
							<button
								type="button"
								class="btn preset-tonal btn-sm"
								onclick={() => (delete s.tasks_list, (s.sections_list = [newSection()]))}>{t('Add subsection')}</button
							>
						{/if}
					</form>
				{/if}
			{/if}
		</section>
	{/each}
{/snippet}

<datalist id="unplaced-tasks"
	>{#each unplaced as id (id)}<option value={id}>{tasks[id]}</option>{/each}</datalist
>
{#if error}<p class="text-sm text-error-600-400" role="alert">{error}</p>{/if}
<div class="space-y-4">
	{#if !toc.length}
		<EmptyState
			icon={ListIcon}
			title={t('No section yet')}
			description={t('Create a section, then add existing task folders or new task ids to it.')}
		/>
	{/if}
	{@render sections(toc, 0)}
	<div class="flex flex-wrap items-center gap-2">
		<button type="button" class="btn preset-tonal" onclick={() => toc.push(newSection())}
			><PlusIcon />{t('Add section')}</button
		>
		<button
			type="button"
			class="btn preset-tonal"
			disabled={!p.selected.length}
			onclick={() => editSettings(p.selected)}><SettingsIcon />{t('Edit settings of the selected tasks')}</button
		>
		{#if p.selected.length}{@render removeMenu(p.selected, t('Delete selected tasks'))}{/if}
	</div>
	{#if p.created.length || p.deleted.length || p.wiped.length}
		<p class="text-sm text-warning-700-300" role="status">
			{t('Pending changes')}: {t('create')} [{p.created.join(', ')}], {t('delete')} [{p.deleted.join(', ')}], {t(
				'wipe submissions of'
			)} [{p.wiped.join(', ')}]
		</p>
	{/if}
	<!-- The JSON is added when the form data is built (not rendered in the page: large structures). -->
	<form
		method="POST"
		action="?/save"
		use:enhance={toastEnhance()}
		onformdata={(e) =>
			e.formData.set(
				'data',
				JSON.stringify({ structure: { toc, config }, created: p.created, deleted: p.deleted, wiped: p.wiped })
			)}
	>
		<SaveBar values={{ toc, config, p }} version={structure} />
	</form>
</div>

<dialog
	bind:this={dialog}
	class="ms-auto me-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-s border-surface-200-800 bg-surface-50-950 text-inherit shadow-2xl backdrop:bg-surface-950/40 backdrop:backdrop-blur-[2px]"
	aria-label={t('Task settings')}
>
	{#if editing}
		<header
			class="sticky top-0 z-10 flex items-center gap-2 border-b border-surface-200-800 bg-surface-50-950 px-5 py-4"
		>
			<h2 class="min-w-0 flex-1 truncate text-base font-semibold">{t('Edit task {}', editing.ids.join(', '))}</h2>
			<button
				type="button"
				class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal"
				aria-label={t('Close')}
				onclick={() => dialog?.close()}><XIcon /></button
			>
		</header>
		<div class="p-5"><SpecForm fields={taskConfigSpec(kind !== 'combinatory_test')} values={editing.values} /></div>
		<footer class="sticky bottom-0 flex justify-end gap-2 border-t border-surface-200-800 bg-surface-50-950 px-5 py-3">
			<button type="button" class="btn preset-tonal" onclick={() => dialog?.close()}>{t('Cancel')}</button>
			<button type="button" class="btn preset-filled-primary-500" onclick={applySettings}>{t('Apply')}</button>
		</footer>
	{/if}
</dialog>
