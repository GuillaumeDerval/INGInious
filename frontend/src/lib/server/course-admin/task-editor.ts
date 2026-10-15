/**
 * Task editor (CADM-10..13, SITE-17): prepares the editable values of a
 * task.yaml and saves the posted values. The descriptor is *merged* (unknown
 * keys are kept), only the fields described by the specs (and by plugin tabs)
 * can be written, values are typed
 * (ints, `true`), and a missing task is never created.
 */
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import { attempt } from '../attempt.js';
import { services } from '../app.js';
import { requireCourseAdmin } from '../courses/access.js';
import type { GuardEvent } from '../security/guards.js';
import type { Course } from '../courses/course.js';
import { idChecker } from '../courses/files.js';
import { buildTask, migrateTaskContent, readTaskYaml, saveTask } from '../courses/task.js';
import { plugins } from '../plugins/index.js';
import {
	BASIC_SPEC,
	envSpec,
	getPath,
	PROBLEM_SPECS,
	setPath,
	type FieldSpec,
	type Values
} from '#lib/components/course-admin/specs.js';

/** A plugin tab of the editor (hook `task_editor_tab`): text plus fields stored as top-level task keys. */
export interface EditorTab {
	id: string;
	label: string;
	text?: string;
	fields: FieldSpec[];
}

/** Posted editor state (JSON field `task`): top-level values and the ordered problems. */
export const editorPost = z.object({
	values: z.record(z.string(), z.unknown()),
	problems: z.array(z.looseObject({ id: z.string(), type: z.string() }))
});

/** Reads the raw (v0.6-migrated) descriptor of an existing task. */
export function readTask(course: Course, taskid: string): Values {
	return migrateTaskContent(readTaskYaml(course.id, taskid));
}

/** Requires a course admin and an existing task (404 otherwise); returns the course and the raw descriptor. */
export async function requireTaskAdmin(
	event: GuardEvent & { params: Partial<Record<string, string>> }
): Promise<{ course: Course; raw: Values }> {
	const { course } = await requireCourseAdmin(event, event.params.courseid!);
	return {
		course,
		raw: attempt(
			() => readTask(course, event.params.taskid!),
			() => error(404, t('Task not found.'))
		)
	};
}

/** Plugin tabs for a task (hook `task_editor_tab`). */
export function editorTabs(course: Course, taskid: string, data: Values): Promise<EditorTab[]> {
	return plugins().callHook<object, EditorTab>('task_editor_tab', { course, taskid, task_data: data });
}

/** Environments announced by the backend (empty while it is unreachable). */
export const environments = (): Record<string, string[]> => services().backend.environments;

/**
 * Normalises posted values with field specs into a copy of `base` (keys of
 * the specs only): bools are `true` or removed, numbers checked, csv split,
 * empty optional values removed.
 * @throws Error with a translated message for invalid values.
 */
export function normalize(fields: FieldSpec[], values: Values, base: Values = {}): Values {
	const out = structuredClone(base);
	for (const f of fields) {
		let v = getPath(values, f.key);
		const empty = v === undefined || v === null || v === '';
		if (f.kind === 'bool') v = v === true || undefined;
		else if (f.kind === 'csv')
			v = (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);
		else if (f.kind === 'list') v = ((v ?? []) as Values[]).map((item) => normalize(f.fields!, item));
		else if (f.kind === 'int' || f.kind === 'number') {
			if (
				!empty &&
				(!Number.isFinite(Number(v)) || (f.kind === 'int' && !Number.isInteger(Number(v))) || Number(v) < f.min!)
			)
				throw new Error(t('{}: a number >= {} is expected.', t(f.label), f.min!));
			v = empty ? (f.optional ? undefined : 0) : Number(v);
		} else v = String(v ?? '');
		if (f.required && (v === '' || v === undefined)) throw new Error(t('{} is required.', t(f.label)));
		setPath(out, f.key, f.optional && (v === '' || (Array.isArray(v) && !v.length)) ? undefined : v);
	}
	return out;
}

/**
 * Saves the editor state into task.yaml (merged with the existing descriptor).
 * @returns null when saved, or the error message.
 */
export async function saveEditor(
	course: Course,
	taskid: string,
	post: z.output<typeof editorPost>
): Promise<string | null> {
	const raw = readTask(course, taskid);
	let data: Values;
	try {
		const tabs = await editorTabs(course, taskid, raw);
		const fields = [...BASIC_SPEC, ...envSpec({}, ''), ...tabs.flatMap((tab) => tab.fields)];
		data = normalize(fields, post.values, raw);
		if (data.environment_type === 'mcq') data.environment_parameters = {};
		const old = (raw.problems ?? {}) as Record<string, Values>;
		data.problems = {};
		for (const p of post.problems) {
			const spec = PROBLEM_SPECS[p.type];
			if (!idChecker(p.id) || !spec || p.id in (data.problems as Values))
				throw new Error(t('Invalid problem: {}', p.id));
			const base = old[p.id]?.type === p.type ? old[p.id] : { type: p.type };
			(data.problems as Values)[p.id] = normalize(spec, p, base);
		}
	} catch (e) {
		return (e as Error).message;
	}
	// CADM-13: plugins may modify the data or refuse it (first message wins).
	const [refused] = await plugins().callHook<object, string>('task_editor_submit', { course, taskid, task_data: data });
	if (refused) return refused;
	const invalid = attempt(
		() => void buildTask(course, taskid, data),
		(e) => t('Invalid data: {}', e.message)
	);
	if (!invalid) saveTask(course.id, taskid, data);
	return invalid ?? null;
}
