/**
 * Browser helpers of the task page (TASK-01/02..06/08/09): the JSON action
 * protocol of the page URL, client-side validation of the answers, mapping of
 * results to alert kinds and the local "save/load my work" storage.
 */
import { t } from '#lib/i18n/index.js';
import { track } from '#lib/components/layout/loading.svelte.js';
import type { ProblemData } from './types.js';

/** Answer of a problem in the page state: text, choice index(es). */
export type Answer = string | string[];

/**
 * Posts an action to the task page URL; network/server failures become `{status: "error"}`.
 * The shell's loading bar is shown during the request, except for `background` ones
 * (result polling, which has its own progress display).
 */
export async function postAction(url: string, form: FormData, background = false): Promise<Record<string, unknown>> {
	const request = (async () => {
		try {
			const res = await fetch(url, { method: 'POST', body: form, headers: { accept: 'application/json' } });
			return (await res.json()) as Record<string, unknown>;
		} catch {
			return { status: 'error', text: t('Internal error') };
		}
	})();
	return background ? request : track(request);
}

/** Builds the form data of an action. */
export function actionForm(action: string, fields: Record<string, string>, base = new FormData()): FormData {
	base.set('@action', action);
	for (const [k, v] of Object.entries(fields)) base.set(k, v);
	return base;
}

/** Alert kinds of the result codes that are not errors (legacy colours). */
const ALERT_KINDS: Record<string, 'success' | 'warning' | 'info'> = {
	success: 'success',
	waiting: 'info',
	timeout: 'warning',
	overflow: 'warning',
	killed: 'warning'
};

/** Alert kind of a result (legacy colours): success, info (waiting), warning (timeout/overflow/killed) or error. */
export function alertKind(result: string): 'success' | 'warning' | 'error' | 'info' {
	return ALERT_KINDS[result] ?? 'error';
}

/**
 * Client-side checks before submitting (legacy `taskFormValid`): every
 * non-optional answer is filled, a file is selected for file problems.
 * @returns the error message, or null.
 */
export function validateAnswers(
	problems: ProblemData[],
	answers: Record<string, Answer>,
	form: HTMLFormElement
): string | null {
	for (const p of problems) {
		if (p.type === 'file') {
			const input = form.querySelector<HTMLInputElement>(`input[type=file][name="${CSS.escape(p.id)}"]`);
			if (!input?.files?.length) return t('Please answer to all the questions.');
		} else if (!p.optional && !answers[p.id]?.length) return t('Please answer to all the questions.');
	}
	return null;
}

/** Key of the saved answers of a task in localStorage. */
const storageKey = (courseid: string, taskid: string) => `${courseid}/${taskid}`;

/** Saves the answers in the browser (files excluded). */
export function saveAnswers(courseid: string, taskid: string, answers: Record<string, Answer>): void {
	localStorage.setItem(storageKey(courseid, taskid), JSON.stringify(answers));
}

/** Returns the saved answers, null when nothing (valid) was saved. */
export function loadAnswers(courseid: string, taskid: string): Record<string, Answer> | null {
	try {
		const value = JSON.parse(localStorage.getItem(storageKey(courseid, taskid)) ?? 'null');
		return value && typeof value === 'object' ? value : null;
	} catch {
		return null;
	}
}

/**
 * Converts a stored input value to a page answer (TASK-10 reload): strings and
 * lists are kept, anything else (files, missing values) becomes "".
 */
export function inputToAnswer(value: unknown): Answer {
	return typeof value === 'string' || Array.isArray(value) ? (value as Answer) : '';
}
