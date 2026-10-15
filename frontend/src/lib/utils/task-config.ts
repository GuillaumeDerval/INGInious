/**
 * Default per-task dispenser settings in the stored `dispenser_data.config`
 * format (CADM-08), shared by the server dispenser (`DEFAULT_TASK_CONFIG` is
 * parsed from it) and the task settings panel of the toc editor.
 */

/** Settings of a task without config entry: note that it is **never accessible**. */
export const TASK_CONFIG_DEFAULTS = Object.freeze({
	weight: 1,
	no_stored_submissions: 0,
	evaluation_mode: 'best',
	categories: [] as string[],
	submission_limit: { amount: -1, period: -1 },
	accessibility: false
});
