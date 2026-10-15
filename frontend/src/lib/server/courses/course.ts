/**
 * Course descriptors (`<tasks_directory>/<courseid>/course.yaml`): loading
 * with legacy defaults and LTI forced values, mtime cache, listing, creation,
 * saving and deletion (docs/reference/course-model.md §1-2, NAV-04).
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { get } from '../config.js';
import { accessibleTime, parseDate, NEVER, type AccessibleTime } from './accessible.js';
import { parseDispenser, type Dispenser } from './dispenser.js';
import {
	cachedLoad,
	checkedPath,
	coursePath,
	dumpYaml,
	idChecker,
	NotFoundError,
	parseYaml,
	removeTree,
	tasksDir,
	translator,
	writeFileAtomic,
	type Translate
} from './files.js';

export { NotFoundError };

/** A course tag (`tags.<id>`): type 0 = skill, 1 = misconception, 2 = category. */
export interface Tag {
	id: string;
	name: string;
	description: string;
	visible: boolean;
	type: number;
}

/** Access-control method of the registration. */
export type AclMethod = null | 'username' | 'email' | 'binding';

/** A loaded course. Strings are untranslated sources: use `tr(lang, text)`. */
export interface Course {
	id: string;
	/** Raw descriptor as read from course.yaml (do not mutate: shared by the cache). */
	content: Record<string, unknown>;
	name: string;
	/** Description source (reStructuredText, or Markdown when it starts with `#MD`). */
	description: string;
	admins: string[];
	tutors: string[];
	/** Effective accessibility (never when archived, always when LTI). */
	accessible: AccessibleTime;
	registration: AccessibleTime;
	registrationPassword: string | null;
	registrationAc: AclMethod;
	registrationAcAccept: boolean;
	registrationAcList: string[];
	/** Compiled ACL (`*` = wildcard, full case-sensitive match). */
	registrationAcRegex: RegExp;
	groupsStudentChoice: boolean;
	allowUnregister: boolean;
	allowPreview: boolean;
	isLti: boolean;
	ltiUrl: string;
	ltiKeys: Record<string, string>;
	ltiConfig: Record<string, unknown>;
	ltiSecrets: Record<string, string>;
	ltiSendBackGrade: boolean;
	archived: boolean;
	archiveDate: Date | null;
	tags: Record<string, Tag>;
	dispenser: Dispenser;
	/** Translates a course string through `$i18n/<lang>.mo`. */
	tr: Translate;
}

/** Builds the ACL regex like legacy `_build_ac_regex`. */
function aclRegex(list: string[]): RegExp {
	const parts = list.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\*', '.*'));
	return new RegExp(`^(?:${parts.join('|')})$`);
}

const strList = (v: unknown, key: string): string[] => {
	if (!Array.isArray(v)) throw new Error(`Course has an invalid value for ${key}`);
	return v.map(String);
};

/**
 * Builds a course from its descriptor (legacy `Course.__init__`).
 * @throws Error when the descriptor is invalid (the course is then unloadable).
 */
export function buildCourse(id: string, content: Record<string, unknown>): Course {
	if (!content || typeof content !== 'object' || typeof content.name !== 'string')
		throw new Error(`Course has an invalid name: ${id}`);
	if (content.nofrontend) throw new Error('That course is not allowed to be displayed directly in the webapp');
	const registrationAc = (content.registration_ac ?? null) as AclMethod;
	if (![null, 'username', 'email', 'binding'].includes(registrationAc))
		throw new Error(`Course has an invalid value for registration_ac: ${id}`);
	const isLti = Boolean(content.is_lti);
	const archived = Boolean(content.archived);
	const tags: Record<string, Tag> = {};
	for (const [tagId, t] of Object.entries(get<Record<string, Record<string, unknown>>>(content, 'tags', {}))) {
		if (typeof t?.name !== 'string') throw new Error(`Tag ${tagId} has no name: ${id}`);
		tags[tagId] = {
			id: tagId,
			name: t.name,
			description: String(t.description ?? ''),
			visible: Boolean(t.visible),
			type: Number(t.type ?? 0)
		};
	}
	const acList = isLti ? [] : strList(get(content, 'registration_ac_list', []), 'registration_ac_list');
	return {
		id,
		content,
		name: content.name,
		description: String(content.description ?? ''),
		admins: strList(get(content, 'admins', []), 'admins'),
		tutors: strList(get(content, 'tutors', []), 'tutors'),
		// LTI courses are always accessible and never open to self-registration.
		accessible: archived ? NEVER : isLti ? accessibleTime(true) : accessibleTime(content.accessible),
		registration: isLti ? NEVER : accessibleTime(content.registration),
		registrationPassword: isLti || content.registration_password == null ? null : String(content.registration_password),
		registrationAc: isLti ? null : registrationAc,
		registrationAcAccept: Boolean(get(content, 'registration_ac_accept', true)),
		registrationAcList: acList,
		registrationAcRegex: aclRegex(acList),
		groupsStudentChoice: !isLti && Boolean(content.groups_student_choice),
		allowUnregister: !isLti && Boolean(get(content, 'allow_unregister', true)),
		allowPreview: Boolean(content.allow_preview),
		isLti,
		ltiUrl: isLti ? String(content.lti_url ?? '') : '',
		ltiKeys: isLti ? get(content, 'lti_keys', {}) : {},
		ltiConfig: isLti ? get(content, 'lti_config', {}) : {},
		ltiSecrets: isLti ? get(content, 'lti_secrets', {}) : {},
		ltiSendBackGrade: isLti && Boolean(content.lti_send_back_grade),
		archived,
		archiveDate: content.archive_date == null ? null : new Date(parseDate(String(content.archive_date))),
		tags,
		dispenser: parseDispenser(content.task_dispenser ?? 'toc', content.dispenser_data),
		tr: translator([coursePath(id, '$i18n')])
	};
}

/**
 * Returns a course (cached until course.yaml changes).
 * @throws NotFoundError for invalid ids, missing or unloadable courses.
 */
export function getCourse(courseid: string): Course {
	return loadCourse(courseid, checkedPath(courseid));
}

/** Loads the course `courseid` from its (checked) folder `path`, cached until course.yaml changes. */
function loadCourse(courseid: string, path: string): Course {
	try {
		return cachedLoad(`${path}/course.yaml`, (raw) =>
			buildCourse(courseid, parseYaml(raw.toString('utf8')) as Record<string, unknown>)
		);
	} catch (e) {
		throw new NotFoundError(`Course ${courseid} cannot be loaded: ${(e as Error).message}`);
	}
}

/** Loads a course, null when it does not exist or cannot be loaded. */
export function findCourse(courseid: string): Course | null {
	try {
		return getCourse(courseid);
	} catch {
		return null;
	}
}

/**
 * Every loadable course, sorted by id; broken courses are skipped (legacy `get_all`).
 * Scale: the folders come from the listing of `tasks_directory` itself (real
 * directories, no symlink, valid ids), so their paths need no `safeJoin` check.
 */
export function listCourses(): Map<string, Course> {
	const out = new Map<string, Course>();
	const dir = tasksDir();
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isDirectory() || !idChecker(entry.name)) continue;
		try {
			out.set(entry.name, loadCourse(entry.name, `${dir}/${entry.name}`));
		} catch {
			// Legacy: "Cannot open course" warning, course hidden.
		}
	}
	return out;
}

/**
 * Task ids of a course: sub-folders with a valid id containing task.yaml, sorted.
 * A course folder deleted since the course was loaded (concurrent deletion) has none.
 */
export function courseTaskIds(course: Course): string[] {
	const dir = coursePath(course.id);
	if (!existsSync(dir)) return [];
	// Real sub-directories with valid ids of a checked folder: plain paths (thousands of tasks).
	return readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && idChecker(e.name) && existsSync(`${dir}/${e.name}/task.yaml`))
		.map((e) => e.name)
		.sort();
}

/**
 * Writes course.yaml (the whole descriptor, keys in order; legacy `save`).
 * The descriptor is validated first so that a broken file is never written.
 */
export function saveCourse(courseid: string, content: Record<string, unknown>): void {
	const path = checkedPath(courseid);
	buildCourse(courseid, content);
	writeFileAtomic(`${path}/course.yaml`, dumpYaml(content));
}

/**
 * Creates a new course folder with `{name: <id>, accessible: false}` (NAV-04).
 * The id is validated and an existing course (or folder) is never
 * overwritten.
 * @throws Error for invalid ids or existing folders.
 */
export function createCourse(
	courseid: string,
	content: Record<string, unknown> = { name: courseid, accessible: false }
): Course {
	const dir = checkedPath(courseid);
	mkdirSync(tasksDir(), { recursive: true });
	mkdirSync(dir); // throws EEXIST for existing courses
	saveCourse(courseid, content);
	return getCourse(courseid);
}

/** Deletes a course folder and everything in it (danger zone). */
export function deleteCourse(courseid: string): void {
	removeTree(checkedPath(courseid));
}
