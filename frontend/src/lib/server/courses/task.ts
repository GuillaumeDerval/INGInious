/**
 * Task descriptors (`<tasks_directory>/<courseid>/<taskid>/task.yaml`):
 * loading with legacy migrations and environment checks, mtime cache,
 * translations, saving, creation/deletion, and the import of legacy
 * per-task dispenser settings (docs/reference/task-model.md, CADM-06).
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import type { Course } from './course.js';
import { courseTaskIds, NotFoundError } from './course.js';
import { pyInt } from './dispenser.js';
import {
	cachedLoad,
	checkedPath,
	coursePath,
	dumpYaml,
	parseYaml,
	removeTree,
	translator,
	writeFileAtomic,
	type Translate
} from './files.js';
import { createProblem, type Problem } from './problems.js';

/** A loaded task. Strings are untranslated sources: use `tr(lang, text)`. */
export interface Task {
	courseId: string;
	id: string;
	/** Raw descriptor after the in-memory v0.6 migration (shared by the cache: do not mutate). */
	content: Record<string, unknown>;
	name: string;
	/** Statement source (reStructuredText, or Markdown when it starts with `#MD`). */
	context: string;
	author: string;
	/** `str.format` template with `{course_id}`, `{task_id}`, `{username}`. */
	contactUrl: string;
	environmentType: string;
	environmentId: string;
	/** Normalised parameters sent to the backend. */
	environmentParameters: Record<string, unknown>;
	/** Number of random inputs generated per user. */
	inputRandom: number;
	regenerateInputRandom: boolean;
	problems: Problem[];
	/** Translates a task string (first existing `$i18n` folder, i18n.md §3). */
	tr: Translate;
}

/** Environment types known to the frontend (legacy `register_base_env_types`). */
export const ENVIRONMENT_TYPES = ['docker', 'docker-ssh', 'nvidia', 'nvidia-ssh', 'mcq'];

/** Normalises docker-like environment parameters (legacy `check_task_environment_parameters`). */
export function checkEnvironmentParameters(type: string, data: Record<string, unknown>): Record<string, unknown> {
	if (type === 'mcq') return {};
	const limits: Record<string, number> = { time: 20, memory: 1024, disk: 1024 };
	if ('limits' in data) {
		const l = (data.limits ?? {}) as Record<string, unknown>;
		try {
			limits.time = pyInt(l.time ?? 20);
			limits.hard_time = String(l.hard_time ?? '').trim() === '' ? 3 * limits.time : pyInt(l.hard_time);
			limits.memory = pyInt(l.memory ?? 1024);
			limits.disk = pyInt(l.disk ?? 1024);
		} catch {
			throw new Error('Invalid limit');
		}
		if (Object.values(limits).some((v) => v <= 0)) throw new Error('Invalid limit');
	}
	return {
		run_cmd: data.run_cmd ? data.run_cmd : null,
		network_grading: data.network_grading ?? false,
		limits
	};
}

/** Legacy `_migrate_from_v_0_6` (+ v0.8.5 `ssh_allowed`), applied to a copy. */
export function migrateTaskContent(raw: Record<string, unknown>): Record<string, unknown> {
	const content = { ...raw };
	if ('environment' in content) {
		content.environment_id = content.environment;
		content.environment_type = content.environment === 'mcq' ? 'mcq' : 'docker';
		delete content.environment;
		content.environment_parameters = {
			limits: content.limits ?? {},
			run_cmd: content.run_cmd ?? '',
			network_grading: content.network_grading ?? false
		};
	}
	if ((content.environment_parameters as Record<string, unknown> | undefined)?.ssh_allowed)
		content.environment_type = `${String(content.environment_type)}-ssh`;
	return content;
}

/**
 * Builds a task from its descriptor (legacy `Task.__init__`).
 * @throws Error for missing problems, invalid problems, unknown environment types or limits.
 */
export function buildTask(course: Course, taskid: string, raw: Record<string, unknown>): Task {
	if (!raw || typeof raw !== 'object') throw new Error('Invalid task descriptor');
	const content = migrateTaskContent(raw);
	if (!content.problems || typeof content.problems !== 'object')
		throw new Error('Tasks must have some problems descriptions');
	const problems = Object.entries(content.problems).map(([id, p]) => createProblem(id, p));
	const environmentType = String(content.environment_type ?? 'unknown');
	if (!ENVIRONMENT_TYPES.includes(environmentType)) throw new Error(`Environment type ${environmentType} is unknown`);
	const i18n = [
		[taskid, '$i18n'],
		[taskid, 'student', '$i18n'],
		['$common', '$i18n'],
		['$common', 'student', '$i18n']
	];
	return {
		courseId: course.id,
		id: taskid,
		content,
		name: String(content.name ?? `Task ${taskid}`),
		context: String(content.context ?? ''),
		author: typeof content.author === 'string' ? content.author : '',
		contactUrl: typeof content.contact_url === 'string' ? content.contact_url : '',
		environmentType,
		environmentId: String(content.environment_id ?? 'default'),
		environmentParameters: checkEnvironmentParameters(
			environmentType,
			(content.environment_parameters ?? {}) as Record<string, unknown>
		),
		inputRandom: pyInt(content.input_random ?? 0),
		// Legacy bool(): any non-empty string (even "off") is true.
		regenerateInputRandom: Boolean(content.regenerate_input_random),
		problems,
		tr: translator(i18n.map((p) => coursePath(course.id, ...p)))
	};
}

/**
 * Parsed task.yaml of an existing task (raw, not migrated nor cached).
 * @throws NotFoundError for invalid ids or missing tasks.
 */
export function readTaskYaml(courseid: string, taskid: string): Record<string, unknown> {
	const path = `${checkedPath(courseid, taskid)}/task.yaml`;
	if (!existsSync(path)) throw new NotFoundError(`Task ${courseid}/${taskid} not found`);
	return parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/**
 * Returns a task of a course (cached until task.yaml changes).
 * @throws NotFoundError for invalid ids or missing tasks; Error for invalid descriptors.
 */
export function getTask(course: Course, taskid: string): Task {
	return loadTask(course, taskid, checkedPath(course.id, taskid));
}

/** Loads the task `taskid` of a course from its (checked) folder `path`, cached until task.yaml changes. */
function loadTask(course: Course, taskid: string, path: string): Task {
	const file = `${path}/task.yaml`;
	if (!existsSync(file)) throw new NotFoundError(`Task ${course.id}/${taskid} not found`);
	return cachedLoad(file, (raw) =>
		buildTask(course, taskid, parseYaml(raw.toString('utf8')) as Record<string, unknown>)
	);
}

/**
 * Every task folder of a course with its task, or the error that prevents loading it.
 * Scale: the folders come from `courseTaskIds` (real sub-directories with valid ids), so
 * their paths need no `safeJoin` check (thousands of tasks).
 */
export function loadTasks(course: Course): Map<string, Task | Error> {
	const dir = coursePath(course.id);
	const out = new Map<string, Task | Error>();
	for (const id of courseTaskIds(course))
		try {
			out.set(id, loadTask(course, id, `${dir}/${id}`));
		} catch (e) {
			out.set(id, e as Error);
		}
	return out;
}

/**
 * Loads a task, null when it is missing or its descriptor is broken (the
 * error is then logged, like the legacy "Couldn't load task" warning).
 */
export function findTask(course: Course, taskid: string): Task | null {
	try {
		return getTask(course, taskid);
	} catch (e) {
		if (!(e instanceof NotFoundError)) console.error(`Task ${course.id}/${taskid} cannot be loaded:`, e);
		return null;
	}
}

/** Every loadable task of a course; broken tasks are skipped (legacy `get_tasks`). */
export function listTasks(course: Course): Map<string, Task> {
	return new Map([...loadTasks(course)].filter((e): e is [string, Task] => !(e[1] instanceof Error)));
}

/** Writes task.yaml (whole descriptor; legacy `save`), creating the folder if needed. */
export function saveTask(courseid: string, taskid: string, content: Record<string, unknown>): void {
	writeFileAtomic(`${checkedPath(courseid, taskid)}/task.yaml`, dumpYaml(content));
}

/**
 * Creates a new task folder with its descriptor; refuses existing folders.
 * @throws Error for invalid ids or existing tasks.
 */
export function createTask(courseid: string, taskid: string, content: Record<string, unknown>): void {
	mkdirSync(checkedPath(courseid, taskid)); // throws EEXIST
	saveTask(courseid, taskid, content);
}

/** Deletes a task folder and everything in it. */
export function deleteTask(courseid: string, taskid: string): void {
	removeTree(checkedPath(courseid, taskid));
}

/** Legacy task.yaml dispenser fields -> `dispenser_data.config` keys (toc). */
export const LEGACY_FIELDS: Record<string, string> = {
	weight: 'weight',
	submission_limit: 'submission_limit',
	stored_submissions: 'no_stored_submissions',
	groups: 'group_submission',
	evaluate: 'evaluation_mode',
	accessible: 'accessibility',
	categories: 'categories'
};

/** Legacy fields handled by the dispenser of a course (combinatory tests have no groups). */
function legacyFields(course: Course): [string, string][] {
	return Object.entries(LEGACY_FIELDS).filter(([k]) => k !== 'groups' || course.dispenser.kind !== 'combinatory_test');
}

/** True when some task.yaml still holds legacy dispenser settings (CADM-06 banner). */
export function hasLegacyTasks(course: Course): boolean {
	return [...listTasks(course).values()].some((t) => legacyFields(course).some(([k]) => k in t.content));
}

/**
 * Returns new toc-level dispenser data where the legacy task.yaml settings of
 * every task overwrite its config entry (legacy `import_legacy_tasks`); the
 * result must still go through `checkDispenserData` before saving.
 */
export function importLegacyTasks(course: Course): Record<string, unknown> {
	const data = structuredClone(course.dispenser.data);
	const config = data.config as Record<string, Record<string, unknown>>;
	for (const [id, task] of listTasks(course)) {
		const imported = legacyFields(course)
			.filter(([k]) => k in task.content)
			.map(([k, v]) => [v, task.content[k]]);
		config[id] = { ...config[id], ...Object.fromEntries(imported) };
	}
	return data;
}

/** Rewrites every task.yaml of a course without its legacy dispenser fields (legacy `clean_task_files`). */
export function dropLegacyFields(course: Course): void {
	for (const id of listTasks(course).keys()) {
		const raw = readTaskYaml(course.id, id);
		if (!legacyFields(course).some(([k]) => k in raw)) continue;
		for (const [k] of legacyFields(course)) delete raw[k];
		saveTask(course.id, id, raw);
	}
}
