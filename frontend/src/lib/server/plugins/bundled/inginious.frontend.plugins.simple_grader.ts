/**
 * Port of the legacy "simple_grader" plugin (SITE-18): grading of an input
 * against a task of a dedicated course without account nor storage, through
 * POST /external (routes/external). Options: `courseid` (default "external"),
 * `return_fields` (regex, default "^(result|text|problems)$") and the NEW
 * mandatory `api_key` shared secret.
 *
 * Behaviour: the endpoint is disabled (404) unless `api_key` is set and
 * every request must carry it (field `api_key`, compared in constant time);
 * the jobs use the current backend protocol (legacy: always "internal error"
 * or 500); `result` is split into `result` and `text`; the archive is never
 * returned; results of asynchronous jobs are forgotten after one hour. Only
 * the `/external` path is served (`page_pattern` is ignored). Cross-site posts
 * are accepted (the endpoint is exempt from the origin check: the key authenticates).
 */
import { randomUUID } from 'node:crypto';
import type { PluginConfig } from '../../config.js';
import type { JobResult } from '../../backend/client.js';
import type { PluginRegistry } from '../index.js';
import { services } from '../../app.js';
import { safeEqual } from '../../courses/access.js';
import { getCourse } from '../../courses/course.js';
import { buildInput } from '../../courses/problems.js';
import { getTask } from '../../courses/task.js';
import { attempt } from '../../attempt.js';

let options: PluginConfig | null = null;
/** Asynchronous jobs: job id -> result (null while running). */
const jobs = new Map<string, JobResult | null>();

/** Keeps the plugin options. */
export function init(_registry: PluginRegistry, opts: PluginConfig): void {
	options = opts;
	if (!opts.api_key) console.warn('simple_grader: no api_key configured, the plugin is disabled');
}

/** True when the plugin is usable (enabled with an `api_key`). */
export const graderEnabled = () => !!options?.api_key;

/** True when `key` is the configured shared secret. */
export const validKey = (key: unknown) =>
	typeof key === 'string' && graderEnabled() && safeEqual(key, String(options!.api_key));

const error = (status_message: string) => ({ status: 'error', status_message });

/** Fields of a job result returned to the caller (filtered by `return_fields`). */
function fields(r: JobResult): Record<string, unknown> {
	const re = new RegExp(String(options?.return_fields ?? '^(result|text|problems)$'));
	const all = {
		result: r.result[0],
		text: r.result[1],
		grade: r.grade,
		problems: r.problems,
		tests: r.tests,
		custom: r.custom,
		state: r.state,
		stdout: r.stdout,
		stderr: r.stderr
	};
	return Object.fromEntries(Object.entries(all).filter(([k]) => re.test(k)));
}

/** SITE-18: handles a (key-checked) request: new sync/async job or poll of an async job. */
export async function handleGrader(form: FormData): Promise<Record<string, unknown>> {
	const jobid = form.get('jobid');
	if (typeof jobid === 'string') {
		const result = jobs.get(jobid);
		if (result === undefined) return error(`There is no job with jobid ${jobid}`);
		if (result === null) return { status: 'waiting' };
		jobs.delete(jobid);
		return { status: 'done', ...fields(result) };
	}
	const [taskid, raw] = [form.get('taskid'), form.get('input')];
	if (typeof taskid !== 'string' || typeof raw !== 'string') return error('Unknown request type');
	const posted = attempt(
		() => JSON.parse(raw) as Record<string, unknown> | null,
		() => undefined
	);
	if (posted === undefined) return error('Cannot decode input');
	const task = attempt(
		() => getTask(getCourse(String(options!.courseid ?? 'external')), taskid),
		() => null
	);
	if (!task) return error('Cannot open task');
	const answers = new FormData();
	for (const [k, v] of Object.entries(posted ?? {})) for (const item of [v].flat()) answers.append(k, String(item));
	const { config, backend } = services();
	// The key holder sets the whole input, `@`-fields included (no server-set field here).
	const input = await buildInput(task.problems, answers, config, true);
	if (!input) return error('Input is not consistent with the task');
	const job = new Promise<JobResult>((onDone) =>
		backend.newJob(
			{
				priority: 0,
				courseId: task.courseId,
				taskId: task.id,
				problems: task.content.problems as Record<string, unknown>,
				input,
				environmentType: task.environmentType,
				environment: task.environmentId,
				environmentParameters: task.environmentParameters,
				debug: false,
				launcher: 'Plugin - Simple Grader'
			},
			{ onDone }
		)
	);
	if (!form.has('async')) return { status: 'done', ...fields(await job) };
	const id = randomUUID();
	jobs.set(id, null);
	void job.then((r) => {
		jobs.set(id, r);
		// Results never polled are forgotten after an hour.
		setTimeout(jobs.delete.bind(jobs), 3_600_000, id).unref();
	});
	return { status: 'done', jobid: id };
}
