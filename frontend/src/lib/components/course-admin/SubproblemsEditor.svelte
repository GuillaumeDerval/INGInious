<!--
@component
Subproblems editor of the task editor (CADM-12): one collapsible card per
problem (type icon, name, id and type, reorder by drag & drop or arrows,
delete), the data-driven fields of its type (`PROBLEM_SPECS`) inside, and a
card to add a problem (id checked like legacy: letters, digits, ".", "_" and
"-", unique). A card whose fields are named by the last save error is outlined
in red.

Props:
- `problems` (Array<{id, type, ...}>): ordered problems, mutated in place.
- `previewUrl` (string, optional): preview endpoint of the rich texts.
- `error` (string | null, optional): message of the last failed save.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import CodeIcon from '@lucide/svelte/icons/code';
	import LineIcon from '@lucide/svelte/icons/text-cursor-input';
	import FileUpIcon from '@lucide/svelte/icons/file-up';
	import EqualIcon from '@lucide/svelte/icons/equal';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import PuzzleIcon from '@lucide/svelte/icons/puzzle';
	import GripIcon from '@lucide/svelte/icons/grip-vertical';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { t } from '#lib/i18n/index.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { isValidId } from '#lib/utils/ids.js';
	import SpecForm from './SpecForm.svelte';
	import { problemError, PROBLEM_SPECS, PROBLEM_TYPES, type Values } from './specs.js';

	/** Props (documented in the component comment above). */
	export interface Props {
		problems: ({ id: string; type: string } & Values)[];
		previewUrl?: string;
		error?: string | null;
	}

	let { problems, previewUrl, error = null }: Props = $props();
	let newId = $state('');
	let newType = $state('code');
	let idError = $state('');
	/** Id of the problem added last (its card opens). */
	let added = '';
	/** Index of the dragged card. */
	let dragged = -1;
	const ICONS: Record<string, typeof CodeIcon> = {
		code: CodeIcon,
		code_single_line: LineIcon,
		file: FileUpIcon,
		match: EqualIcon,
		multiple_choice: ListChecksIcon
	};

	function add() {
		if (!isValidId(newId))
			idError = t('Problem id should only contain alphanumeric characters (in addition to "_" and "-").');
		else if (problems.some((p) => p.id === newId)) idError = t('This problem id is already used.');
		else {
			problems.push({ id: (added = newId), type: newType, name: '', header: '' });
			newId = idError = '';
		}
	}
	/** Moves the problem `i` to position `j`. */
	const move = (i: number, j: number) => problems.splice(j, 0, ...problems.splice(i, 1));
	const failed = (p: Props['problems'][number]) => problemError(p, error, t);
</script>

<div class="space-y-3">
	{#each problems as p, i (p)}
		{@const Icon = ICONS[p.type] ?? PuzzleIcon}
		<details
			class={['group panel', failed(p) && 'ring-2 ring-error-500/50']}
			data-problem={p.id}
			{@attach (el) =>
				untrack(() => (problems.length === 1 || p.id === added) && ((el as HTMLDetailsElement).open = true))}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => (e.preventDefault(), dragged >= 0 && move(dragged, i), (dragged = -1))}
		>
			<summary
				class="flex cursor-pointer list-none items-center gap-2 rounded-container py-2.5 ps-2 pe-3 hover:bg-surface-100-900/60 [&::-webkit-details-marker]:hidden"
				draggable="true"
				ondragstart={() => (dragged = i)}
			>
				<GripIcon class="hidden size-4 shrink-0 cursor-grab text-surface-400-600 sm:block" aria-hidden="true" />
				<span class="grid size-8 shrink-0 place-items-center rounded-base bg-primary-500/10 text-primary-600-400">
					<Icon class="size-4" aria-hidden="true" />
				</span>
				<span class="min-w-0 flex-1 ps-1">
					<span class="block truncate text-sm font-semibold">{String(p.name || p.id)}</span>
					<span class="flex flex-wrap items-center gap-x-2 text-xs text-surface-600-400">
						<code>{p.id}</code>{t(PROBLEM_TYPES.find(([k]) => k === p.type)?.[1] ?? p.type)}
					</span>
				</span>
				{#if failed(p)}<Badge tone="error">{t('Error')}</Badge>{/if}
				{#each [[-1, 'Move up', ChevronUpIcon], [1, 'Move down', ChevronDownIcon]] as const as [delta, label, Arrow] (label)}
					<button
						type="button"
						class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal disabled:invisible"
						aria-label={t(label)}
						title={t(label)}
						disabled={delta < 0 ? i === 0 : i === problems.length - 1}
						onclick={(e) => (e.preventDefault(), move(i, i + delta))}><Arrow /></button
					>
				{/each}
				<button
					type="button"
					class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal-error"
					aria-label={t('Delete')}
					title={t('Delete')}
					onclick={(e) => (e.preventDefault(), problems.splice(i, 1))}><TrashIcon /></button
				>
				<ChevronDownIcon
					class="ms-1 size-4 shrink-0 text-surface-500 transition-transform group-open:rotate-180"
					aria-hidden="true"
				/>
			</summary>
			<div class="border-t border-surface-200-800 p-4 sm:p-5">
				<SpecForm fields={PROBLEM_SPECS[p.type] ?? []} values={p} {previewUrl} {error} />
			</div>
		</details>
	{:else}
		<EmptyState
			icon={ListChecksIcon}
			title={t('No problem yet')}
			description={t('Add the questions students answer: code, file upload, multiple choice...')}
		/>
	{/each}
	<div class="rounded-container border border-dashed border-surface-300-700 p-4">
		<p class="mb-3 text-sm font-semibold">{t('Add a problem')}</p>
		<div class="flex flex-wrap items-end gap-3">
			<label class="min-w-48 flex-1 space-y-1.5"
				><span class="label-text block">{t('New problem id')}</span><input
					class="input font-mono"
					placeholder="new-problem-id"
					aria-invalid={idError ? 'true' : undefined}
					bind:value={newId}
				/></label
			>
			<label class="min-w-48 flex-1 space-y-1.5 sm:flex-none"
				><span class="label-text block">{t('Problem type')}</span>
				<select class="select" bind:value={newType}
					>{#each PROBLEM_TYPES as [k, label] (k)}<option value={k}>{t(label)}</option>{/each}</select
				>
			</label>
			<button type="button" class="btn preset-tonal" onclick={add}><PlusIcon />{t('Add')}</button>
		</div>
		{#if idError}<p class="mt-2 text-xs text-error-600-400" role="alert">{idError}</p>{/if}
	</div>
</div>
