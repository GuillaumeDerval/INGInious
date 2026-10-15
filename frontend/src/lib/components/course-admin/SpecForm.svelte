<!--
@component
Generic data-driven form (CADM-03..12): renders a list of `FieldSpec`s
(see specs.ts) bound to a values object, which it edits in place (dotted keys
create nested objects). One component serves the course settings, the tags,
the task basic/environment settings, every subproblem type, the plugin tabs,
the section settings and the per-task dispenser settings.

Layout: a two-column grid on wide screens where fields take the full width
unless marked `half` (pairs of short fields); list items (tags, choices) are
numbered sub-cards. The error of the last failed save is shown under the field
it names (`fieldError`), with `aria-invalid`.

Props:
- `fields` (FieldSpec[]): fields to render (hidden when `when(values)` is false).
- `values` (Values): edited object (a `$state` proxy, mutated in place).
- `previewUrl` (string, optional): preview endpoint of the rich text fields.
- `error` (string | null, optional): message of the last failed save.

@example <SpecForm fields={PROBLEM_SPECS.code} values={problem} />
-->
<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { t } from '#lib/i18n/index.js';
	import CodeEditor from '#lib/components/ui/CodeEditor.svelte';
	import FormField from '#lib/components/ui/FormField.svelte';
	import RichTextInput from '#lib/components/ui/RichTextInput.svelte';
	import SearchSelect, { type Option } from '#lib/components/ui/SearchSelect.svelte';
	import SpecForm from './SpecForm.svelte';
	import { fieldError, getPath, optionsOf, setPath, type FieldSpec, type Values } from './specs.js';

	/** Props (documented in the component comment above). */
	export interface Props {
		fields: FieldSpec[];
		values: Values;
		previewUrl?: string;
		error?: string | null;
	}

	let { fields, values, previewUrl, error = null }: Props = $props();
	const uid = $props.id();

	const get = (f: FieldSpec) => getPath(values, f.key);
	const set = (f: FieldSpec, v: unknown) => setPath(values, f.key, v);
	/** Number inputs: empty -> null (removed or refused by the server). */
	const num = (f: FieldSpec, raw: string) => set(f, raw === '' ? null : Number(raw));
	/** Access values: `false`, `true` or "start/[soft end/]end". */
	const parts = (f: FieldSpec) => String(get(f)).split('/').concat('', '', '').slice(0, f.parts);
	const setPart = (f: FieldSpec, i: number, v: string) =>
		set(
			f,
			parts(f)
				.map((p, j) => (i === j ? v : p))
				.join('/')
		);
	const PART_LABELS = { 2: ['Start', 'End'], 3: ['Start', 'Soft deadline', 'End'] };
	const visible = $derived(fields.filter((f) => !f.when || f.when(values)));
</script>

<div class="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
	{#each visible as f (f.key)}
		{@const err = fieldError(f, values, error, t)}
		<div
			class={[!f.half && 'sm:col-span-2', f.half && f.kind === 'bool' && 'flex items-center sm:min-h-9 sm:self-end']}
		>
			{#if f.kind === 'bool'}
				<label class="flex items-center gap-2.5 text-sm"
					><input
						type="checkbox"
						class="checkbox"
						checked={!!get(f)}
						onchange={(e) => set(f, e.currentTarget.checked)}
					/>{t(f.label)}</label
				>
			{:else if f.kind === 'rich'}
				<RichTextInput
					label={t(f.label)}
					{previewUrl}
					minLines={3}
					bind:value={() => String(get(f) ?? ''), (v) => set(f, v)}
				/>
			{:else if f.kind === 'list'}
				<fieldset class="space-y-3">
					<!-- A list alone in its card (tags) is titled by the card: its legend is only announced. -->
					<legend class={visible.length === 1 ? 'sr-only' : 'mb-2 label-text'}>{t(f.label)}</legend>
					{#each (get(f) ?? []) as Values[] as item, i (item)}
						<div class="rounded-container border border-surface-200-800 bg-surface-100-900/40">
							<div class="flex items-center justify-between border-b border-surface-200-800 py-1.5 ps-4 pe-2">
								<span class="eyebrow">{`${t(f.item!)} ${i + 1}`}</span>
								<button
									type="button"
									class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal-error"
									aria-label={t('Delete')}
									title={t('Delete')}
									onclick={() => (get(f) as Values[]).splice(i, 1)}><TrashIcon /></button
								>
							</div>
							<div class="p-3 sm:p-4"><SpecForm fields={f.fields!} values={item} {previewUrl} {error} /></div>
						</div>
					{/each}
					<button
						type="button"
						class="btn preset-tonal btn-sm"
						onclick={() => set(f, [...((get(f) ?? []) as Values[]), {}])}><PlusIcon />{t('Add')}</button
					>
				</fieldset>
			{:else}
				<FormField label={t(f.label)} id={`${uid}-${f.key}`} error={err}>
					{#snippet children(attrs)}
						{#if f.kind === 'textarea'}
							<textarea
								{...attrs}
								class="textarea"
								rows="4"
								placeholder={t(f.placeholder ?? '')}
								value={String(get(f) ?? '')}
								oninput={(e) => set(f, e.currentTarget.value)}></textarea>
						{:else if f.kind === 'code'}
							<CodeEditor
								label={t(f.label)}
								language={String(values[f.lang ?? ''] ?? '')}
								bind:value={() => String(get(f) ?? ''), (v) => set(f, v)}
							/>
						{:else if f.kind === 'int' || f.kind === 'number'}
							<input
								{...attrs}
								class="input"
								type="number"
								min={f.min}
								step={f.kind === 'int' ? 1 : 'any'}
								value={get(f) ?? ''}
								oninput={(e) => num(f, e.currentTarget.value)}
							/>
						{:else if f.kind === 'select'}
							<select
								{...attrs}
								class="select"
								value={String(get(f) ?? '')}
								onchange={(e) => set(f, e.currentTarget.value)}
							>
								{#each optionsOf(f, values) as [value, label] (value)}<option {value}>{t(label)}</option>{/each}
							</select>
						{:else if f.kind === 'csv'}
							<input
								{...attrs}
								class="input"
								placeholder={t(f.placeholder!)}
								value={((get(f) ?? []) as string[]).join(',')}
								onchange={(e) =>
									set(
										f,
										e.currentTarget.value
											.split(',')
											.map((s) => s.trim())
											.filter(Boolean)
									)}
							/>
						{:else if f.kind === 'users'}
							<SearchSelect
								name={f.key}
								label={t(f.label)}
								url={f.url!}
								bind:selected={() => get(f) as Option[], (v) => set(f, v)}
							/>
						{:else if f.kind === 'access'}
							{@const mode = typeof get(f) === 'string' ? 'custom' : String(!!get(f))}
							<select
								{...attrs}
								class="select"
								value={mode}
								onchange={(e) =>
									set(
										f,
										e.currentTarget.value === 'custom' ? '/'.repeat(f.parts! - 1) : e.currentTarget.value === 'true'
									)}
							>
								<option value="false">{t('Never')}</option><option value="true">{t('Always')}</option><option
									value="custom">{t('Custom')}</option
								>
							</select>
							{#if mode === 'custom'}
								<div
									class={[
										'mt-2 grid gap-3 rounded-base bg-surface-100-900 p-3',
										f.parts === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
									]}
								>
									{#each parts(f) as part, i (i)}
										<label class="space-y-1">
											<span class="block text-xs font-medium text-surface-600-400">{t(PART_LABELS[f.parts!][i])}</span>
											<input
												class="input font-mono"
												placeholder="YYYY-MM-DD HH:MM:SS"
												value={part}
												onchange={(e) => setPart(f, i, e.currentTarget.value.trim())}
											/>
										</label>
									{/each}
								</div>
							{/if}
						{:else}
							<input
								{...attrs}
								class="input"
								placeholder={t(f.placeholder ?? '')}
								value={String(get(f) ?? '')}
								oninput={(e) => set(f, e.currentTarget.value)}
							/>
						{/if}
					{/snippet}
				</FormField>
			{/if}
		</div>
	{/each}
</div>
