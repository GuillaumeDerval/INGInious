/**
 * Client-side notifications (toasts) of the application shell.
 *
 * `toaster` is the single Skeleton toaster rendered by `Toaster.svelte` (in
 * the shell). Server-side flash messages (#lib/server/flash.ts) and enhanced
 * form submissions both end up here.
 *
 * Form action convention: return `{ message }` on success and
 * `fail(status, { message })` on failure; `toastEnhance()` shows the message.
 * Every enhanced form uses `toastEnhance()` or `busyEnhance()` so that a pending
 * submission is visible (busy button, loading bar).
 */
import { createToaster } from '@skeletonlabs/skeleton-svelte';
import type { ActionResult, SubmitFunction } from '$app/forms';
import { t } from '#lib/i18n/index.js';
import { start } from './loading.svelte.js';

/** Kinds of messages, also used for flash messages. */
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

/** The application-wide toaster (rendered once by Toaster.svelte). */
export const toaster = createToaster({ placement: 'top-end' });

/** Shows a toast; errors stay until dismissed, others close after 5 s. */
export function notify(kind: ToastKind, message: string): void {
	toaster.create({
		type: kind,
		description: message,
		duration: kind === 'error' ? Infinity : 5000
	});
}

/** Reads the `message` field of an action result payload, if any. */
function messageOf(data: unknown): string | undefined {
	const message = (data as { message?: unknown } | undefined)?.message;
	return typeof message === 'string' && message ? message : undefined;
}

/**
 * Marks a submitted form as busy until its result is applied: `aria-busy` on the
 * form and on the clicked button (styled as a spinner that cannot be clicked
 * again, lib/styles/components.css), and the shell's loading bar.
 * @returns the function ending the busy state.
 */
function markBusy(form: HTMLFormElement, submitter: HTMLElement | null): () => void {
	const end = start();
	for (const element of [form, submitter]) element?.setAttribute('aria-busy', 'true');
	return () => {
		for (const element of [form, submitter]) element?.removeAttribute('aria-busy');
		end();
	};
}

/**
 * `use:enhance` callback applying the result like SvelteKit's default `update()`,
 * with a busy state while the request is pending (see markBusy; a second
 * submission is ignored). The form is NOT reset unless `reset` is set: an edit
 * form must keep showing the saved values (a reset would restore the inputs'
 * initial default values, empty for pages rendered in the browser); creation
 * forms pass `{ reset: true }` to clear.
 * @param onResult called with the action result before it is applied.
 * @example <form method="POST" use:enhance={busyEnhance()}>
 */
export function busyEnhance({
	reset = false,
	onResult
}: { reset?: boolean; onResult?: (result: ActionResult) => void } = {}): SubmitFunction {
	return ({ formElement, submitter, cancel }) => {
		if (formElement.getAttribute('aria-busy') === 'true') return cancel();
		const done = markBusy(formElement, submitter);
		return async ({ result, update }) => {
			try {
				onResult?.(result);
				await update({ reset });
			} finally {
				done();
			}
		};
	};
}

/**
 * busyEnhance showing the result of a form action as a toast.
 * @param success message shown on success when the action returns none.
 * @example <form method="POST" use:enhance={toastEnhance(t('Saved.'))}>
 */
export function toastEnhance(success?: string, { reset = false } = {}): SubmitFunction {
	return busyEnhance({
		reset,
		onResult: (result) => {
			if (result.type === 'success') {
				const message = messageOf(result.data) ?? success;
				if (message) notify('success', message);
			} else if (result.type === 'failure') {
				notify('error', messageOf(result.data) ?? t('An error occurred.'));
			} else if (result.type === 'error') {
				notify('error', result.error?.message ?? t('An error occurred.'));
			}
		}
	});
}
