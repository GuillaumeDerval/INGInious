<!--
@component
Label + hint + error wrapper for one form control. The control is rendered by
the `children` snippet, which receives the attributes to spread on it
(`id`, `aria-describedby`, `aria-invalid`) so that the label and messages are
correctly associated for assistive technologies.

Props:
- `label` (string): visible label.
- `hint` (string, optional): help text under the control.
- `error` (string | null, optional): validation error (shown in red).
- `required` (boolean, optional): adds a "required" marker.
- `id` (string, optional): id of the control (generated when omitted).
- `children` (Snippet<[attrs]>): the control.

@example
<FormField label={t('Email')} error={form?.errors?.email}>
	{#snippet children(attrs)}<input class="input" name="email" type="email" {...attrs} />{/snippet}
</FormField>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Attributes to spread on the control. */
	export interface FieldAttrs {
		id: string;
		'aria-describedby'?: string;
		'aria-invalid'?: 'true';
	}

	/** Props of FormField. */
	export interface Props {
		/** Visible label. */
		label: string;
		/** Help text. */
		hint?: string;
		/** Validation error. */
		error?: string | null;
		/** Marks the field as required. */
		required?: boolean;
		/** Id of the control. */
		id?: string;
		/** The control. */
		children: Snippet<[FieldAttrs]>;
	}

	const uid = $props.id();
	let { label, hint, error = null, required = false, id = uid, children }: Props = $props();

	const attrs = $derived<FieldAttrs>({
		id,
		'aria-describedby': [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined,
		'aria-invalid': error ? 'true' : undefined
	});
</script>

<div class="space-y-1.5">
	<label for={id} class="block text-sm font-medium text-surface-800-200">
		{label}{#if required}<span class="text-error-600-400" aria-hidden="true">&nbsp;*</span>{/if}
	</label>
	{@render children(attrs)}
	{#if hint}<p id={`${id}-hint`} class="text-xs text-surface-600-400">{hint}</p>{/if}
	{#if error}<p id={`${id}-error`} class="text-xs text-error-600-400">{error}</p>{/if}
</div>
