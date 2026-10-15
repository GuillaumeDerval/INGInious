/**
 * Data-driven form descriptions of the course administration (CADM-03..12),
 * shared by the browser (`SpecForm.svelte` renders them) and the server
 * (`#lib/server/course-admin/task-editor.ts` normalises the posted values with
 * them). Labels are legacy English msgids, translated at display time.
 */

/** Kind of control of a field. */
type FieldKind =
	'text' | 'textarea' | 'code' | 'int' | 'number' | 'bool' | 'select' | 'csv' | 'list' | 'access' | 'users' | 'rich';
// `rich`: rich text (RST, or Markdown with the `#MD` marker) edited with RichTextInput.

/** Values edited by a form (nested objects addressed by dotted keys). */
export type Values = Record<string, unknown>;

/** One field of a data-driven form. */
export interface FieldSpec {
	/** Dotted path of the value (e.g. `environment_parameters.limits.time`). */
	key: string;
	/** Label msgid. */
	label: string;
	kind: FieldKind;
	/** Placeholder msgid (every `csv` field has one). */
	placeholder?: string;
	/** `select`: `[value, label msgid]` pairs, possibly computed from the values. */
	options?: [string, string][] | ((values: Values) => [string, string][]);
	/** `list`: fields of one item. */
	fields?: FieldSpec[];
	/** `int`/`number`: minimal value (every number field of the editors has one). */
	min?: number;
	/** Empty values remove the key instead of storing "" (server side). */
	optional?: boolean;
	/** Empty values are refused (server side). */
	required?: boolean;
	/** `access`: 2 (start/end) or 3 (start/soft end/end) dates. */
	parts?: 2 | 3;
	/** `code`: key of the value holding the editor language. */
	lang?: string;
	/** `users`: suggestion endpoint (the value is always a list of options). */
	url?: string;
	/** Shows the field only when this returns true. */
	when?: (values: Values) => boolean;
	/** Display: the field takes half of the form width on wide screens (pairs of short fields). */
	half?: boolean;
	/** `list`: label msgid of one item (e.g. "Choice"), numbered in the editor. */
	item?: string;
}

/** Reads a dotted path. */
export function getPath(values: Values, key: string): unknown {
	return key.split('.').reduce<unknown>((o, k) => (o as Values | undefined)?.[k], values);
}

/** Writes a dotted path, creating missing objects; `undefined` deletes the key. */
export function setPath(values: Values, key: string, value: unknown): void {
	const keys = key.split('.');
	const last = keys.pop()!;
	let o = values;
	for (const k of keys) o = (o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {})) as Values;
	if (value === undefined) delete o[last];
	else o[last] = value;
}

/** Options of a select field for the given values. */
export const optionsOf = (f: FieldSpec, v: Values) => (typeof f.options === 'function' ? f.options(v) : f.options!);

/**
 * Error of a field after a failed save (shown in place by SpecForm): the server message
 * (`normalize` in task-editor.ts) names the field label, and the current value is still invalid.
 */
export function fieldError(
	f: FieldSpec,
	values: Values,
	message: string | null | undefined,
	tr: (s: string) => string
) {
	const v = getPath(values, f.key);
	const empty = v === undefined || v === null || v === '';
	const bad =
		(f.required && empty) ||
		((f.kind === 'int' || f.kind === 'number') &&
			!empty &&
			(Number(v) < f.min! || (f.kind === 'int' && !Number.isInteger(Number(v)))));
	return bad && message?.startsWith(tr(f.label)) ? message : null;
}

/** Shorthand constructor of a field. */
const F = (key: string, label: string, kind: FieldKind = 'text', more: Partial<FieldSpec> = {}): FieldSpec => ({
	key,
	label,
	kind,
	...more
});
const name = F('name', 'Name', 'text', { placeholder: 'A title for this question' });
const header = F('header', 'Context', 'rich');
const optional = F('optional', 'Optional?', 'bool', { half: true });
const centralize = F('centralize', 'Count error only at top of the page?', 'bool');
const opt = { optional: true };

/** Editors of the subproblem types (CADM-12), keyed by problem type. */
export const PROBLEM_SPECS: Record<string, FieldSpec[]> = {
	code: [
		name,
		header,
		F('language', 'Language', 'text', {
			placeholder: 'Language used in this question (c/cpp/java/python/oz/...)',
			half: true
		}),
		optional,
		F('default', 'Default value', 'code', { lang: 'language' }),
		F('offset', 'Code line offset', 'int', { min: 1, ...opt })
	],
	code_single_line: [name, header, optional, F('default', 'Default value')],
	file: [
		name,
		header,
		F('allowed_exts', 'Allowed file extensions (including the dot, separated by commas)', 'csv', {
			placeholder: '.txt,.zip,.gz',
			half: true,
			...opt
		}),
		F('max_size', 'Maximum file size (in bytes)', 'int', { min: 0, half: true, ...opt })
	],
	match: [name, header, F('answer', 'Answer'), centralize],
	multiple_choice: [
		name,
		header,
		F('multiple', 'Can select multiple answers', 'bool'),
		F('unshuffle', 'Unshuffle answers', 'bool'),
		centralize,
		F('limit', 'Number of choices to display (0 = all choices)', 'int', { min: 0, ...opt }),
		F('success_message', 'An optional success message', 'rich', opt),
		F('error_message', 'An optional error message', 'rich', opt),
		F('choices', 'Choices', 'list', {
			item: 'Choice',
			fields: [
				F('text', 'Content', 'rich'),
				F('feedback', 'Feedback message (displayed when selected)', 'rich', opt),
				F('valid', 'Valid answer', 'bool')
			]
		})
	]
};

/** Problem type -> label msgid (legacy `get_type_name`). */
export const PROBLEM_TYPES: [string, string][] = [
	['code', 'code'],
	['code_single_line', 'single-line code'],
	['file', 'file upload'],
	['match', 'match'],
	['multiple_choice', 'multiple choice']
];

/** The last save failed because of this problem (invalid id, or a field named by the message). */
export const problemError = (
	p: { id: string; type: string } & Values,
	message: string | null | undefined,
	tr: (s: string, ...a: string[]) => string
) =>
	!!message &&
	(message === tr('Invalid problem: {}', p.id) || !!PROBLEM_SPECS[p.type]?.some((f) => fieldError(f, p, message, tr)));

/** Basic settings of the task editor (CADM-10). */
export const BASIC_SPEC: FieldSpec[] = [
	F('name', 'Name', 'text', { placeholder: 'title for this task' }),
	F('context', 'Context', 'rich'),
	F('author', 'Author', 'text', { placeholder: 'Your name', half: true }),
	F('contact_url', 'Contact URL', 'text', { placeholder: 'Contact link', half: true }),
	F('input_random', 'Random inputs', 'int', { min: 0, half: true }),
	F('regenerate_input_random', 'Regenerate input random', 'bool', { half: true })
];

/** Grading environment types (SITE-24), in registration order. */
const ENV_TYPES: [string, string][] = [
	['docker', 'Standard container'],
	['docker-ssh', 'Standard container + SSH'],
	['nvidia', 'Container with GPUs (NVIDIA)'],
	['nvidia-ssh', 'Container with GPUs (NVIDIA) + SSH'],
	['mcq', 'Multiple Choice Question solver']
];

/**
 * Environment tab of the task editor (CADM-11): the environment ids offered
 * are the ones announced by the backend for the selected type (plus the
 * current one, so that it is never silently lost).
 */
export function envSpec(available: Record<string, string[]>, current: string): FieldSpec[] {
	const when = (v: Values) => v.environment_type !== 'mcq';
	const limit = (k: string, label: string, optional = false) =>
		F(`environment_parameters.limits.${k}`, label, 'int', { min: 1, optional, when, half: true });
	const ids = (v: Values): [string, string][] =>
		[...new Set([...(available[String(v.environment_type)] ?? []), current].filter(Boolean))].sort().map((e) => [e, e]);
	return [
		F('environment_type', 'Grading environment type', 'select', { required: true, options: ENV_TYPES, half: true }),
		F('environment_id', 'Grading environment', 'select', { required: true, options: ids, half: true }),
		limit('time', 'Timeout limit (in seconds)'),
		limit('hard_time', 'Hard timeout limit (in seconds)', true),
		limit('memory', 'Memory limit (in megabytes)'),
		F('environment_parameters.network_grading', 'Allow internet access inside the grading container?', 'bool', {
			when,
			half: true
		}),
		F('environment_parameters.run_cmd', 'Custom command to be run in container', 'text', {
			placeholder: 'Optional',
			...opt,
			when
		})
	];
}

/** Per-task dispenser settings (CADM-08); `groups` is false for combinatory tests. */
export const taskConfigSpec = (groups: boolean): FieldSpec[] => [
	F('weight', 'Grade weight (in comparison to other tasks)', 'number', { min: 0 }),
	F('no_stored_submissions', 'Number of stored submissions (0 = all)', 'int', { min: 0 }),
	F('evaluation_mode', 'Evaluation submission', 'select', {
		options: [
			['best', 'Best submission'],
			['last', 'Last submission']
		]
	}),
	F('group_submission', 'Per group', 'bool', { when: () => groups }),
	F('categories', 'Categories', 'csv', { placeholder: 'Tag name, separated by commas' }),
	F('submission_limit.amount', 'Submission limit (-1 = no limitation)', 'int', { min: -1 }),
	F('submission_limit.period', 'Every ... hour(s) (-1 = never refilled)', 'int', { min: -1 }),
	F('accessibility', 'Accessibility', 'access', { parts: 3 })
];

/** Settings of a toc section, or of a combinatory test pool (CADM-07/09). */
export const sectionSpec = (kind: string): FieldSpec[] =>
	kind === 'combinatory_test'
		? [F('amount', 'Amount of tasks to be displayed', 'int', { min: 0 })]
		: [F('closed', 'Closed by default', 'bool'), F('hidden_if_empty', 'Hidden if empty', 'bool')];

/** Course settings form (CADM-03/04/05) by group (title msgid); values are prepared by the settings page load. */
export function courseSpec(url: string): Record<string, FieldSpec[]> {
	const when = (v: Values) => !v.is_lti;
	const acl = (v: Values) => when(v) && !!v.registration_ac;
	return {
		General: [
			F('name', 'Name'),
			F('description', 'Description', 'rich'),
			F('admins', 'Administrators', 'users', { url, half: true }),
			F('tutors', 'Tutors', 'users', { url, half: true }),
			F('groups_student_choice', 'Students can choose their group', 'bool', { when }),
			F('allow_preview', 'Allow preview for non-registered users', 'bool'),
			F('is_lti', 'Enable LTI', 'bool')
		],
		'Access & registration': [
			F('accessible', 'Course accessibility', 'access', { parts: 2, when }),
			F('registration', 'Registration', 'access', { parts: 2, when }),
			F('allow_unregister', 'Allow auto-unregistration', 'bool', { when }),
			F('registration_password', 'Registration password', 'text', {
				when,
				placeholder: "Password needed for registration. Leave blank if you don't want to set a password."
			}),
			F('registration_ac', 'Access control method', 'select', {
				when,
				options: [
					['', 'No access control (everyone can register)'],
					['username', 'Check by username'],
					['binding', 'Check by authentication binding'],
					['email', 'Check by email']
				]
			}),
			F('registration_ac_accept', 'Accept the users of the list (deny them otherwise)', 'bool', { when: acl }),
			F('registration_ac_list', 'Access control list', 'textarea', {
				when: acl,
				placeholder: 'Only used if access control is activated. Separate users by new lines.'
			})
		],
		LTI: [
			F('lti_url', 'External platform URL'),
			F('lti_send_back_grade', 'Send back grades', 'bool'),
			F('lti_keys', 'Consumer keys and secrets', 'textarea', {
				placeholder:
					'LTI consumer keys and secrets in the form key:secret, separated by newlines. Please ensure keys are long enough and random.'
			}),
			F('lti_config', 'Additional raw configuration', 'textarea', {
				placeholder: 'LTI 1.3 Tool configuration in JSON form, refer to INGInious teachers documentation.'
			})
		],
		Tags: [
			F('tags', 'Tags', 'list', {
				item: 'Tag',
				fields: [
					F('id', 'Id', 'text', { half: true }),
					F('name', 'Name', 'text', { half: true }),
					F('description', 'Description', 'textarea'),
					F('visible', 'Show to students', 'bool', { half: true }),
					F('type', 'Type', 'select', {
						half: true,
						options: [
							['0', 'Skill'],
							['1', 'Misconception'],
							['2', 'Category']
						]
					})
				]
			})
		]
	};
}
