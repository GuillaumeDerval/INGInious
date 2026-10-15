/**
 * Task dispensers (docs/reference/course-model.md §5-6, NAV-10/11/13/14,
 * CADM-07/08/09): port of legacy `task_dispensers/{toc,combinatory_test,util}.py`
 * and of the `contest` dispenser of the contests plugin.
 *
 * `dispenser_data` of course.yaml holds a table of contents (nested sections
 * of task ids) and per-task settings (weight, accessibility, categories,
 * evaluation mode, stored submissions, submission limit, group submission).
 * The dispenser decides, per user, which tasks are accessible and computes
 * the course grade.
 */
import { accessibleTime, afterStart, NEVER, type AccessibleTime } from './accessible.js';
import { TASK_CONFIG_DEFAULTS } from '#lib/utils/task-config.js';
import { idChecker } from './files.js';
import { PyRandom } from './pyrandom.js';

/** Built-in dispenser ids (an unknown id falls back to `toc`, like legacy). */
export type DispenserKind = 'toc' | 'combinatory_test' | 'contest';

/** A section of the table of contents. */
export interface TocSection {
	title: string;
	/** Section options: `closed`, `hidden_if_empty` (toc), `amount` (combinatory test). */
	config: Record<string, unknown>;
	/** Sub-sections of a non-terminal section, null for a terminal one. */
	sections: TocSection[] | null;
	/** Task ids of a terminal section (empty for non-terminal ones). */
	tasks: string[];
}

/** Submission limit: `amount` submissions per `period` hours (-1 = unlimited / never refilled). */
export interface SubmissionLimit {
	amount: number;
	period: number;
}

/** Validated per-task settings (`dispenser_data.config.<taskid>`). */
export interface TaskConfig {
	weight: number;
	accessibility: AccessibleTime;
	categories: string[];
	evaluationMode: 'best' | 'last';
	/** Maximum number of stored submissions, 0 = unlimited. */
	noStoredSubmissions: number;
	submissionLimit: SubmissionLimit;
	groupSubmission: boolean;
}

/** Contest settings (contests plugin, `dispenser_data.contest_settings`). */
export interface ContestSettings {
	enabled: boolean;
	start: string;
	end: string;
	/** Scoreboard blackout, in hours. */
	blackout: number;
	/** Penalty per failed submission, in minutes. */
	penalty: number;
}

/** A parsed task dispenser. */
export interface Dispenser {
	kind: DispenserKind;
	toc: TocSection[];
	/** Validated settings of the tasks listed in `dispenser_data.config`. */
	config: Record<string, TaskConfig>;
	/** Normalised toc-level data `{toc, config, imported?, ...}` (deep copy of the file content). */
	data: Record<string, unknown>;
	contest?: ContestSettings;
}

/** Error of the dispenser structure or settings (legacy `InvalidTocException`). */
export class InvalidTocError extends Error {}

/** Python `int()` on a YAML/JSON/form value (truncates floats, parses decimal strings). */
export function pyInt(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === 'boolean') return Number(value);
	if (typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value)) return Number(value);
	throw new Error(`invalid literal for int() with base 10: '${String(value)}'`);
}

const fail = (message: string): never => {
	throw new InvalidTocError(message);
};
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Validates one task config entry with the legacy messages (CADM-08).
 * @param groups false for the combinatory test (no group submission item).
 */
export function parseTaskConfig(raw: Record<string, unknown>, groups = true): TaskConfig {
	const { weight = 1, no_stored_submissions: stored = 0, evaluation_mode: mode = 'best', categories = [] } = raw;
	if (typeof weight !== 'number' || Number.isNaN(weight)) fail('The weight value must be a numeric >= 0 ');
	if ((weight as number) < 0) fail('The weight value must be a numeric >= 0');
	if (!isInt(stored)) fail('The store submission must be an integer > 1 ');
	if ((stored as number) < 0) fail('The store submission must be an integer > 1');
	if (mode !== 'best' && mode !== 'last')
		fail(`The evaluation mode must be either best or last but is ${String(mode)}`);
	if (!Array.isArray(categories) || categories.includes(''))
		fail(`All categories must have a name but are :${JSON.stringify(categories)}`);
	const limit = (raw.submission_limit ?? { amount: -1, period: -1 }) as Record<string, unknown>;
	if (!isInt(limit.amount) || !isInt(limit.period)) fail('Invalid submission limit');
	if (limit.amount === -1 && limit.period !== -1)
		fail('You have given a period but no amount for the submission limit');
	if ((limit.amount as number) < -1 || (limit.period as number) < -1)
		fail('Submission limit values must be higher than or equal to -1');
	const group = groups ? (raw.group_submission ?? false) : false;
	if (typeof group !== 'boolean') fail('Invalid submission mode');
	let accessibility: AccessibleTime;
	try {
		accessibility = accessibleTime(raw.accessibility ?? false);
	} catch (e) {
		throw new InvalidTocError(`Invalid task accessibility : ${(e as Error).message}`);
	}
	return {
		weight: weight as number,
		accessibility,
		categories: (categories as unknown[]).map(String),
		evaluationMode: mode as 'best' | 'last',
		noStoredSubmissions: stored as number,
		submissionLimit: { amount: limit.amount as number, period: limit.period as number },
		groupSubmission: group as boolean
	};
}

/** Default settings of a task without config entry: note that it is **never accessible**. */
export const DEFAULT_TASK_CONFIG: TaskConfig = Object.freeze(parseTaskConfig(TASK_CONFIG_DEFAULTS));

/**
 * Validates config entries (CADM-08) with the task id in the messages
 * ("In taskid <id> : <message>").
 * @param groups false for the combinatory test (no group submission item).
 */
function validateConfigs(entries: [string, Record<string, unknown>][], groups: boolean): Record<string, TaskConfig> {
	return Object.fromEntries(
		entries.map(([taskid, entry]) => {
			try {
				return [taskid, parseTaskConfig(entry ?? {}, groups)];
			} catch (e) {
				throw new InvalidTocError(`In taskid ${taskid} : ${(e as Error).message}`);
			}
		})
	);
}

/** Parses a list of sections (legacy `SectionsList`), validating titles and task ids. */
export function parseSections(list: unknown): TocSection[] {
	if (!Array.isArray(list)) {
		// Legacy iterates an empty dict as an empty list.
		if (list && typeof list === 'object' && !Object.keys(list).length) return [];
		fail('Invalid dispenser data structure');
	}
	return (list as Record<string, unknown>[]).map((s) => {
		const terminal = s && typeof s === 'object' && 'tasks_list' in s;
		if (!s || typeof s !== 'object' || (!('sections_list' in s) && !terminal))
			fail("One section don't contain a sections list nor a tasks list");
		if (typeof s.title !== 'string' || s.title === '') fail('No title for one section');
		const config = s.config && typeof s.config === 'object' ? (s.config as Record<string, unknown>) : {};
		if ('sections_list' in s)
			return {
				title: s.title as string,
				config,
				sections: parseSections(s.sections_list),
				tasks: []
			};
		// Very old courses store tasks_list as a {taskid: rank} mapping.
		const raw = s.tasks_list;
		const tasks: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.keys(raw) : [];
		if (!tasks.every(idChecker)) fail('One task id contains non alphanumerical characters');
		return { title: s.title as string, config, sections: null, tasks: tasks as string[] };
	});
}

/** All task ids of a list of sections, in toc order (legacy `get_tasks`). */
export function sectionTasks(sections: TocSection[]): string[] {
	return sections.flatMap((s) => (s.sections ? sectionTasks(s.sections) : s.tasks));
}

/** Normalises the toc-level data: list -> `{toc: list}`, null/{} -> empty, `config` defaulted. */
function normalizeTocData(raw: unknown): Record<string, unknown> {
	const data = structuredClone(raw ?? {}) as Record<string, unknown>;
	if (Array.isArray(data)) return { toc: data, config: {} };
	if (typeof data !== 'object' || (Object.keys(data).length && !('toc' in data)))
		fail('Invalid dispenser data structure');
	return { toc: [], ...data, config: data.config ?? {} };
}

/**
 * Parses the dispenser of a course (`task_dispenser`, `dispenser_data`).
 * Every config entry is validated ("In taskid <id> : <message>").
 * @throws InvalidTocError for an invalid structure or setting.
 */
export function parseDispenser(kindId: unknown, rawData: unknown): Dispenser {
	const kind: DispenserKind = kindId === 'combinatory_test' || kindId === 'contest' ? kindId : 'toc';
	let contest: ContestSettings | undefined;
	let tocData = rawData;
	if (kind === 'contest') {
		const d = (rawData ?? {}) as Record<string, unknown>;
		tocData = d.toc_data;
		const now = new Date();
		contest = {
			enabled: false,
			start: now.toISOString(),
			end: new Date(now.getTime() + 3600_000).toISOString(),
			blackout: 0,
			penalty: 20,
			...(d.contest_settings as Partial<ContestSettings>)
		};
	}
	const data = normalizeTocData(tocData);
	const toc = parseSections(data.toc);
	const config = validateConfigs(Object.entries(data.config as object), kind !== 'combinatory_test');
	if (kind === 'combinatory_test') toc.forEach((s) => pyInt(s.config.amount ?? 0));
	if (contest?.enabled) accessibleTime(`${contest.start}/`);
	return { kind, toc, config, data, contest };
}

/** Settings of a task (defaults when it has no config entry). */
export function taskConfig(d: Dispenser, taskid: string): TaskConfig {
	return Object.hasOwn(d.config, taskid) ? d.config[taskid] : DEFAULT_TASK_CONFIG;
}

/** True when the task is submitted by groups (always false for combinatory tests). */
export function groupSubmission(d: Dispenser, taskid: string): boolean {
	return d.kind !== 'combinatory_test' && taskConfig(d, taskid).groupSubmission;
}

/**
 * Accessibility of tasks for a user (legacy `get_accessibilities`).
 * - toc: the configured accessibility;
 * - combinatory test: per top-level section `i` titled `T`, the started tasks
 *   are shuffled with `Random("<username>#<i>#<T>")` (CPython-exact, anonymous
 *   users are `None`) and only the first `amount` keep their accessibility;
 * - contest (enabled): every toc task opens at the contest start.
 */
export function accessibilities(
	d: Dispenser,
	taskids: string[],
	username: string | null
): Record<string, AccessibleTime> {
	const result: Record<string, AccessibleTime> = {};
	const inToc = new Set(sectionTasks(d.toc));
	const contestStart = d.contest?.enabled ? accessibleTime(`${d.contest.start}/`) : null;
	for (const id of taskids) {
		if (contestStart) result[id] = inToc.has(id) ? contestStart : NEVER;
		else result[id] = d.kind === 'combinatory_test' ? NEVER : taskConfig(d, id).accessibility;
	}
	if (d.kind === 'combinatory_test') {
		d.toc.forEach((section, index) => {
			const candidates = sectionTasks([section]).filter((t) => afterStart(taskConfig(d, t).accessibility));
			const drawn = new PyRandom(`${username ?? 'None'}#${index}#${section.title}`).shuffle(candidates);
			for (const t of drawn.slice(0, pyInt(section.config.amount ?? 0))) result[t] = taskConfig(d, t).accessibility;
		});
	}
	return result;
}

/** Accessibility of one task for a user. */
export function accessibility(d: Dispenser, taskid: string, username: string | null): AccessibleTime {
	return accessibilities(d, [taskid], username)[taskid];
}

/** Tasks (among `taskids`, all task folders) that started for the user: listed and graded ones. */
export function userTaskList(d: Dispenser, taskids: string[], username: string | null, now = Date.now()): string[] {
	const acc = accessibilities(d, taskids, username);
	return taskids.filter((t) => afterStart(acc[t], now));
}

/** Python `round()` (half to even) of a float. */
export function roundHalfEven(x: number): number {
	const f = Math.floor(x);
	const diff = x - f;
	return diff > 0.5 || (diff === 0.5 && f % 2 !== 0) ? f + 1 : f;
}

/**
 * Course grade of a user (NAV-11): weighted average over every started task
 * folder of the course (not only those of the toc), rounded half to even, 0
 * without any started task.
 * @param started the tasks started for the user (`userTaskList`).
 * @param userTasks his `user_tasks` documents (taskid, grade).
 */
export function courseGrade(d: Dispenser, started: string[], userTasks: { taskid: string; grade: number }[]): number {
	const set = new Set(started);
	const den = started.reduce((sum, t) => sum + taskConfig(d, t).weight, 0);
	const num = userTasks.reduce(
		(sum, ut) => sum + (set.has(ut.taskid) ? ut.grade * taskConfig(d, ut.taskid).weight : 0),
		0
	);
	return den > 0 ? roundHalfEven(num / den) : 0;
}

/** Sorted set of the categories of the toc tasks (category filter, NAV-12). */
export function allCategories(d: Dispenser): string[] {
	return [...new Set(sectionTasks(d.toc).flatMap((t) => taskConfig(d, t).categories))].sort();
}

/** Toc task ids that exist as task folders, in toc order (legacy `get_ordered_tasks`). */
export function orderedTasks(d: Dispenser, existing: string[]): string[] {
	const set = new Set(existing);
	return sectionTasks(d.toc).filter((t) => set.has(t));
}

/** Section options stored in `config`: `closed`, `hidden_if_empty` (toc, contest) and `amount` (combinatory test). */
const SECTION_OPTIONS = ['closed', 'hidden_if_empty', 'amount'];
/** Per-task settings stored in `dispenser_data.config.<taskid>` (legacy config item ids). */
const TASK_SETTINGS = [
	'weight',
	'no_stored_submissions',
	'evaluation_mode',
	'group_submission',
	'categories',
	'submission_limit',
	'accessibility'
];

/** The entries of `keys` present in `value` (an empty object when it is not an object). */
const pick = (value: unknown, keys: string[]): Record<string, unknown> =>
	value && typeof value === 'object'
		? Object.fromEntries(keys.filter((k) => Object.hasOwn(value, k)).map((k) => [k, (value as never)[k]]))
		: {};

/** Stored form of a parsed section (legacy `to_structure` plus its options): other posted keys are dropped. */
function storedSection(s: TocSection): Record<string, unknown> {
	const config = pick(s.config, SECTION_OPTIONS);
	return s.sections
		? { title: s.title, config, sections_list: s.sections.map(storedSection) }
		: { title: s.title, config, tasks_list: s.tasks };
}

/** Stored form of the settings of a task: only the known settings (and limit fields) are kept. */
function storedTaskConfig(raw: unknown): Record<string, unknown> {
	const entry = pick(raw, TASK_SETTINGS);
	if (entry.submission_limit && typeof entry.submission_limit === 'object')
		entry.submission_limit = pick(entry.submission_limit, ['amount', 'period']);
	return entry;
}

/**
 * Validates dispenser data posted by the admin structure editor (legacy
 * `check_dispenser_data`, CADM-07/09): structure, settings of the toc tasks
 * (entries of tasks outside the toc are dropped, missing ones set to `{}`),
 * `imported` flag kept, combinatory `amount`s cast to int, contest settings
 * wrapped back. Only the keys of the course.yaml format are stored (sections:
 * `title`, `config`, `tasks_list`/`sections_list`; toc level: `toc`, `config`,
 * `imported`; known section options and task settings).
 * @returns the data to store in `dispenser_data`, or the error message.
 */
export function checkDispenserData(
	current: Dispenser,
	posted: Record<string, unknown>
): { data: Record<string, unknown> } | { error: string } {
	try {
		const toc = parseSections(posted.toc ?? {});
		const raw = (posted.config ?? {}) as Record<string, unknown>;
		const config = Object.fromEntries(
			sectionTasks(toc).map((t) => [t, storedTaskConfig(Object.hasOwn(raw, t) ? raw[t] : {})])
		);
		validateConfigs(Object.entries(config), current.kind !== 'combinatory_test');
		// A structure without toc is stored with an empty one (a toc-less descriptor would be unloadable).
		const data: Record<string, unknown> = {
			toc: toc.map(storedSection),
			config,
			imported: Boolean(posted.imported) || Boolean(current.data.imported)
		};
		if (current.kind === 'combinatory_test')
			for (const section of data.toc as Record<string, Record<string, unknown>>[]) {
				section.config = { ...section.config, amount: pyInt(section.config.amount ?? 0) };
			}
		return {
			data: current.kind === 'contest' ? { toc_data: data, contest_settings: current.contest } : data
		};
	} catch (e) {
		return { error: (e as Error).message };
	}
}
