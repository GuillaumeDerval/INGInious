<!--
@component
Single file input with a drag & drop zone. The native `<input type="file">` keeps
the selection, so the file is sent with the enclosing form as usual.
The selected file is checked on the client against `accept` (extensions or exact
MIME types) and `maxSize`; a rejected selection is cleared and explained (the
server re-checks everything).

Props:
- `name` (string): form field name.
- `label` (string): accessible label / call to action.
- `accept` (string, optional): e.g. ".zip,.tgz" or ".csv,text/csv".
- `maxSize` (number, optional): maximum size of the file, in bytes.
- `required` (boolean, optional).
- `onchange` ((files: File[]) => void, optional): called with the accepted file (empty list when rejected).
-->
<script lang="ts">
	import UploadIcon from '@lucide/svelte/icons/upload';
	import { t } from '#lib/i18n/index.js';

	/** Props of FileDrop. */
	export interface Props {
		/** Form field name. */
		name: string;
		/** Visible label. */
		label: string;
		/** Accepted extensions / MIME types. */
		accept?: string;
		/** Maximum size of a file in bytes. */
		maxSize?: number;
		/** Makes the field required. */
		required?: boolean;
		/** Called with the accepted files. */
		onchange?: (files: File[]) => void;
	}

	let { name, label, accept, maxSize, required = false, onchange }: Props = $props();

	const uid = $props.id();
	let input: HTMLInputElement;
	let files = $state<File[]>([]);
	let error = $state('');
	let dragging = $state(false);

	/** Human-readable size. */
	function size(bytes: number): string {
		return bytes < 1024
			? `${bytes} B`
			: bytes < 1048576
				? `${(bytes / 1024).toFixed(1)} KB`
				: `${(bytes / 1048576).toFixed(1)} MB`;
	}

	/** True when `file` matches the `accept` list (same rules as the browser). */
	function accepted(file: File): boolean {
		if (!accept) return true;
		return accept.split(',').some((rule) => {
			const r = rule.trim().toLowerCase();
			return r.startsWith('.') ? file.name.toLowerCase().endsWith(r) : file.type === r;
		});
	}

	/** Validates the current selection of the input. */
	function check() {
		const list = Array.from(input.files!);
		const bad = list.find((f) => !accepted(f) || (maxSize !== undefined && f.size > maxSize));
		if (bad) {
			error = !accepted(bad)
				? t('File "{}" has an unsupported type.', bad.name)
				: t('File "{}" is too large (maximum {}).', bad.name, size(maxSize!));
			input.value = '';
			files = [];
		} else {
			error = '';
			files = list;
		}
		onchange?.(files);
	}

	/** Puts the first dropped file into the input (unless disabled, e.g. by a disabled fieldset), then validates it. */
	function drop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		const dropped = event.dataTransfer?.files;
		if (!dropped?.length || input.matches(':disabled')) return;
		const transfer = new DataTransfer();
		transfer.items.add(dropped[0]);
		input.files = transfer.files;
		check();
	}
</script>

<div class="space-y-1">
	<label
		for={uid}
		class={[
			'flex cursor-pointer flex-col items-center gap-1 rounded-container border-2 border-dashed px-4 py-6 text-center transition-colors focus-within:ring-2 focus-within:ring-primary-500',
			dragging ? 'border-primary-500 preset-tonal-primary' : 'border-surface-300-700 hover:bg-surface-100-900'
		]}
		ondragover={(e) => {
			e.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={drop}
	>
		<UploadIcon class="size-6 text-surface-500" aria-hidden="true" />
		<span class="font-medium">{label}</span>
		<span class="text-xs text-surface-600-400">
			{t('Drop files here or click to browse.')}
			{#if maxSize}{t('Maximum size: {}.', size(maxSize))}{/if}
		</span>
		<input
			bind:this={input}
			id={uid}
			class="sr-only"
			type="file"
			{name}
			{accept}
			{required}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? `${uid}-error` : undefined}
			onchange={check}
		/>
	</label>
	{#if files.length}
		<ul class="text-sm">
			{#each files as file, i (i)}<li>
					<span>{file.name}</span>
					<span class="text-surface-600-400">{`(${size(file.size)})`}</span>
				</li>{/each}
		</ul>
	{/if}
	{#if error}<p id={`${uid}-error`} class="text-xs text-error-600-400" role="alert">{error}</p>{/if}
</div>
