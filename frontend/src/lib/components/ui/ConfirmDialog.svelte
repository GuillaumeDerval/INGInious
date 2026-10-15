<!--
@component
Confirmation dialog for destructive actions (Skeleton Dialog, `alertdialog`
role). Opened by its own trigger button or by binding `open`. On confirmation
it either POSTs a form (`action` + hidden `fields`) or calls `onconfirm`.
With `confirmText`, the user must type that text (e.g. the course id) before
the confirm button is enabled.

Props:
- `title` (string), `description` (string, optional): dialog texts.
- `triggerLabel` (string, optional): label of the opening button (none when omitted; always error-toned,
  primary-toned dialogs are opened by binding `open`).
- `confirmLabel` (string, default "Confirm"), `tone` ('error' | 'primary', default 'error').
- `confirmText` (string, optional): text to type to confirm.
- `action` (string, optional), `fields` (Record<string, string>, optional): form submitted on confirm.
- `onconfirm` (() => void, optional): called on confirm when there is no `action`.
- `open` (boolean, bindable).

@example
<ConfirmDialog title={t('Delete course')} triggerLabel={t('Delete')} action="?/delete" confirmText={course.id} />
-->
<script lang="ts">
	import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte';
	import AlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { t } from '#lib/i18n/index.js';

	/** Props of ConfirmDialog. */
	export interface Props {
		/** Dialog title. */
		title: string;
		/** Explanation of the consequences. */
		description?: string;
		/** Label of the trigger button; no trigger when omitted. */
		triggerLabel?: string;
		/** Label of the confirm button. */
		confirmLabel?: string;
		/** Color of the confirm button. */
		tone?: 'error' | 'primary';
		/** Text the user must type to enable confirmation. */
		confirmText?: string;
		/** URL of the form action posted on confirm. */
		action?: string;
		/** Hidden fields of that form. */
		fields?: Record<string, string>;
		/** Callback used when there is no `action`. */
		onconfirm?: () => void;
		/** Open state. */
		open?: boolean;
	}

	let {
		title,
		description,
		triggerLabel,
		confirmLabel = t('Confirm'),
		tone = 'error',
		confirmText,
		action,
		fields = {},
		onconfirm,
		open = $bindable(false)
	}: Props = $props();

	const uid = $props.id();
	let typed = $state('');
	const allowed = $derived(!confirmText || typed === confirmText);

	/** Without form action, confirmation calls `onconfirm` instead of submitting. */
	function submit(event: SubmitEvent) {
		if (action) return;
		event.preventDefault();
		open = false;
		typed = '';
		onconfirm?.();
	}
</script>

<Dialog
	role="alertdialog"
	{open}
	onOpenChange={(d) => {
		open = d.open;
		typed = '';
	}}
>
	{#if triggerLabel}
		<Dialog.Trigger class="btn preset-tonal-error">{triggerLabel}</Dialog.Trigger>
	{/if}
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-950/40 backdrop-blur-[2px]" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="w-full max-w-md space-y-4 panel p-6 shadow-2xl">
				<div class="flex items-start gap-4">
					<span
						class={[
							'grid size-10 shrink-0 place-items-center rounded-full',
							tone === 'error' ? 'bg-error-500/12 text-error-600-400' : 'bg-primary-500/12 text-primary-600-400'
						]}
						aria-hidden="true"><AlertIcon class="size-5" /></span
					>
					<div class="min-w-0 space-y-1.5">
						<Dialog.Title class="text-lg font-semibold">{title}</Dialog.Title>
						{#if description}<Dialog.Description class="text-sm text-surface-600-400">{description}</Dialog.Description
							>{/if}
					</div>
				</div>
				<form method="POST" {action} class="space-y-4" onsubmit={submit}>
					{#each Object.entries(fields) as [name, value] (name)}<input type="hidden" {name} {value} />{/each}
					{#if confirmText}
						<label class="label text-sm" for="{uid}-confirm">
							{t('Type "{}" to confirm.', confirmText)}
						</label>
						<input id="{uid}-confirm" class="input" autocomplete="off" bind:value={typed} />
					{/if}
					<footer class="flex justify-end gap-2">
						<Dialog.CloseTrigger type="button" class="btn preset-tonal">{t('Cancel')}</Dialog.CloseTrigger>
						<button
							type="submit"
							class="btn {tone === 'error' ? 'preset-filled-error-500' : 'preset-filled-primary-500'}"
							disabled={!allowed}
						>
							{confirmLabel}
						</button>
					</footer>
				</form>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
