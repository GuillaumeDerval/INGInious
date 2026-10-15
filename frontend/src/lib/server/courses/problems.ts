/**
 * Problem types of task.yaml (docs/reference/task-model.md §4, TASK-02..06):
 * definition checks, student input parsing/validation and the data the task
 * page needs to render each problem. Port of legacy
 * `common/tasks_problems.py` + `frontend/task_problems.py` (grading itself is
 * done by the backend/mcq agent).
 *
 * Input values follow the legacy submission format (db-schema.md §3.1):
 * `str` problems give a string, `list` problems an array of strings and
 * `dict` (file) problems `{filename, value: Uint8Array}` (`{}` when absent).
 */
import type { AppConfig } from '../config.js';
import { PyRandom } from './pyrandom.js';
import { idChecker, type Translate } from './files.js';

/** Raw problem description (`problems.<pid>` of task.yaml). */
export type ProblemContent = Record<string, unknown>;

/** An uploaded file as stored in the submission input. */
export interface FileInput {
	filename: string;
	value: Uint8Array;
}

/** Value of a problem in the submission input. */
export type InputValue = string | string[] | FileInput | Record<string, never>;

/** Upload limits from the configuration (`allowed_file_extensions`, `max_file_size`). */
export type UploadDefaults = Pick<AppConfig, 'allowedFileExtensions' | 'maxFileSize'>;

/** A problem of a task. */
export interface Problem {
	id: string;
	type: string;
	content: ProblemContent;
}

/** Data needed by the UI to render a problem (texts translated, not rendered). */
export interface ProblemView {
	id: string;
	type: string;
	name: string;
	/** Header source (rst/markdown). */
	header: string;
	/** code: editor language (`plain` by default). */
	language?: string;
	/** code/code_single_line: initial content. */
	default?: string;
	optional?: boolean;
	/** code: first line number. */
	offset?: number;
	/** file: maximum size in bytes. */
	maxSize?: number;
	/** file: accepted file name suffixes. */
	allowedExts?: string[];
	/** multiple_choice: checkboxes (true) or radios. */
	multiple?: boolean;
	/** multiple_choice: displayed choices (index = form value, text = source). */
	choices?: { index: number; text: string }[];
}

/** Behaviour of a problem type. */
export interface ProblemType {
	/** How the value is read from the form (legacy `input_type`). */
	inputKind(content: ProblemContent): 'str' | 'list' | 'dict';
	/** Validates the definition; throws an Error describing the problem. */
	check(id: string, content: ProblemContent): void;
	/** Legacy `input_is_consistent`; returns the value to store, or undefined when invalid. */
	accept(value: InputValue | undefined, content: ProblemContent, defaults: UploadDefaults): InputValue | undefined;
	/** Type specific view data. */
	view(problem: Problem, ctx: ViewContext): Partial<ProblemView>;
}

/** Context of `problemView`. */
export interface ViewContext {
	language: string;
	/** Username of the viewer (`null` for anonymous previews, seeded as "None"). */
	username: string | null;
	tr: Translate;
	defaults: UploadDefaults;
}

/** Generic type for plugin problems: string input, only checks that it is present. */
export const genericProblemType: ProblemType = {
	inputKind: () => 'str',
	check: () => {},
	accept: (value) => (typeof value === 'string' ? value : undefined),
	view: () => ({})
};

const code: ProblemType = {
	inputKind: () => 'str',
	check(id, c) {
		if (c.language && !/^[a-z0-9\-_.]+$/i.test(String(c.language)))
			throw new Error(`Invalid language ${String(c.language)}`);
	},
	accept: (value, c) => (typeof value !== 'string' ? undefined : value.length || c.optional ? value : undefined),
	view: (p) => ({
		language: String(p.content.language || 'plain'),
		default: String(p.content.default ?? ''),
		optional: Boolean(p.content.optional),
		offset: Number(p.content.offset ?? 1)
	})
};

/** Normalised choices of a multiple choice problem: valid ones first (legacy `_choices`). */
function mcqChoices(id: string, c: ProblemContent): { index: number; text: string; valid: boolean }[] {
	if (!Array.isArray(c.choices))
		throw new Error(`Multiple choice problem ${id} does not have choices or choices are not an array`);
	const all = c.choices.map((ch: Record<string, unknown>, index) => {
		if (!ch || typeof ch !== 'object' || !('text' in ch)) throw new Error(`A choice in ${id} does not have text`);
		return { index, text: String(ch.text), valid: Boolean(ch.valid) };
	});
	return [...all.filter((x) => x.valid), ...all.filter((x) => !x.valid)];
}

/** Legacy `_filter_choices`: applies `limit` keeping the valid answers reachable. */
function filterChoices<T extends { valid: boolean }>(choices: T[], limit: number, multiple: boolean): T[] {
	const max = limit || choices.length;
	const valid = choices.filter((x) => x.valid);
	const invalid = choices.filter((x) => !x.valid);
	if (multiple) return [...valid, ...invalid.slice(0, Math.max(max - valid.length, 0))];
	const kept = invalid.slice(0, Math.max(max - 1, 0));
	return [...kept, ...valid.slice(0, Math.max(max - kept.length, 0))];
}

/** Python int() of a form value, NaN when invalid. */
const toIndex = (v: string) => (/^\s*[+-]?\d+\s*$/.test(v) ? Number(v) : NaN);

const multipleChoice: ProblemType = {
	inputKind: (c) => (c.multiple ? 'list' : 'str'),
	check(id, c) {
		const choices = mcqChoices(id, c);
		const nbValid = choices.filter((x) => x.valid).length;
		if (!nbValid) throw new Error(`Problem ${id} does not have any valid answer`);
		const limit = c.limit;
		if (
			limit !== undefined &&
			!(
				Number.isInteger(limit) &&
				(limit as number) >= 0 &&
				(!c.multiple || limit === 0 || (limit as number) >= nbValid)
			)
		)
			throw new Error(`Invalid limit in problem ${id}`);
	},
	accept(value, c) {
		const count = (c.choices as unknown[]).length;
		const ok = (v: unknown) => typeof v === 'string' && toIndex(v) >= 0 && toIndex(v) < count;
		if (c.multiple) return Array.isArray(value) && value.every(ok) ? value : undefined;
		return ok(value) ? value : undefined;
	},
	view(p, ctx) {
		// Same seed and algorithm as legacy show_input: stable order per (problem, language, user).
		const rand = new PyRandom(`${p.id}#${ctx.language}#${ctx.username ?? 'None'}`);
		const unshuffle = Boolean(p.content.unshuffle);
		const order = mcqChoices(p.id, p.content);
		if (!unshuffle) rand.shuffle(order);
		const shown = filterChoices(order, Number(p.content.limit ?? 0), Boolean(p.content.multiple));
		if (unshuffle) shown.sort((a, b) => a.index - b.index);
		else rand.shuffle(shown);
		return {
			multiple: Boolean(p.content.multiple),
			choices: shown.map((x) => ({ index: x.index, text: ctx.tr(ctx.language, x.text) }))
		};
	}
};

const file: ProblemType = {
	inputKind: () => 'dict',
	check: () => {},
	accept(value, c, d) {
		// buildInput gives {} when no file was posted.
		if (!value || typeof value !== 'object' || !('filename' in value)) return undefined;
		const exts = (c.allowed_exts as string[] | undefined) || d.allowedFileExtensions;
		// Legacy compared sys.getsizeof(bytes) (= length + 33): the real length is used here.
		const okExt = exts.some((e) => value.filename.endsWith(e));
		return okExt && value.value.length <= (Number(c.max_size) || d.maxFileSize) ? value : undefined;
	},
	view: (p, ctx) => ({
		maxSize: Number(p.content.max_size) || ctx.defaults.maxFileSize,
		allowedExts: (p.content.allowed_exts as string[] | undefined) || ctx.defaults.allowedFileExtensions
	})
};

const match: ProblemType = {
	inputKind: () => 'str',
	check(id, c) {
		if (!('answer' in c)) throw new Error('There is no answer in this problem with type==match');
	},
	accept: (value) => (typeof value === 'string' ? value : undefined),
	view: () => ({})
};

/** Registered problem types (plugins may add theirs with `registerProblemType`). */
const problemTypes: Record<string, ProblemType> = {
	code,
	code_single_line: {
		...code,
		view: (p, ctx) => ({ ...code.view(p, ctx), language: undefined, offset: undefined })
	},
	file,
	multiple_choice: multipleChoice,
	match
};

/** Registers (or replaces) a problem type. */
export function registerProblemType(type: string, definition: ProblemType = genericProblemType): void {
	problemTypes[type] = definition;
}

/**
 * Builds and validates a problem of task.yaml.
 * @throws Error("Invalid problem _id" / "Invalid type for problem ..." / type specific message).
 */
export function createProblem(id: string, content: unknown): Problem {
	if (!idChecker(id)) throw new Error(`Invalid problem _id: ${id}`);
	const c = (content && typeof content === 'object' ? content : {}) as ProblemContent;
	const type = String(c.type ?? '');
	if (!Object.hasOwn(problemTypes, type)) throw new Error(`Invalid type for problem ${id}`);
	problemTypes[type].check(id, c);
	return { id, type, content: c };
}

/** View data of a problem for the task page. */
export function problemView(p: Problem, ctx: ViewContext): ProblemView {
	return {
		id: p.id,
		type: p.type,
		name: ctx.tr(ctx.language, String(p.content.name ?? '')),
		header: ctx.tr(ctx.language, String(p.content.header ?? '')),
		...problemTypes[p.type].view(p, ctx)
	};
}

/**
 * Builds the submission input from a posted form (TASK-08): every posted text
 * field (first value) except `@action` and `@debug-mode`, then each problem
 * replaced by its typed value.
 * @returns the input, or null when an answer is missing or invalid (legacy
 *          "Please answer to all the questions..." error).
 */
export async function buildInput(
	problems: Problem[],
	form: FormData,
	defaults: UploadDefaults
): Promise<Record<string, unknown> | null> {
	const input: Record<string, unknown> = {};
	for (const [key, value] of form) if (typeof value === 'string' && !Object.hasOwn(input, key)) input[key] = value;
	delete input['@action'];
	delete input['@debug-mode'];
	for (const p of problems) {
		const type = problemTypes[p.type];
		const kind = type.inputKind(p.content);
		const raw = form.get(p.id);
		let value: InputValue | undefined;
		if (kind === 'list') value = form.getAll(p.id).filter((v): v is string => typeof v === 'string');
		else if (kind === 'dict')
			value = raw instanceof File ? { filename: raw.name, value: new Uint8Array(await raw.arrayBuffer()) } : {};
		else value = typeof raw === 'string' ? raw : undefined;
		const accepted = type.accept(value, p.content, defaults);
		if (accepted === undefined) return null;
		input[p.id] = accepted;
	}
	return input;
}
