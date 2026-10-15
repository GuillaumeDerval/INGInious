/**
 * Task list administration (CADM-06..09): dispenser switch, legacy task
 * migration, structure save (with task creation/deletion/data wipe) and the
 * WebDAV credentials box (API key from #lib/server/auth/accounts.ts).
 */
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import { saveCourse, type Course } from '../courses/course.js';
import { checkDispenserData } from '../courses/dispenser.js';
import { coursePath } from '../courses/files.js';
import { wipeSubmissions } from './danger.js';
import { createTask, deleteTask, dropLegacyFields, importLegacyTasks } from '../courses/task.js';
import { isValidId } from '../security/paths.js';

/** Dispensers that can be chosen (contest only with the contests plugin). */
export const DISPENSERS = ['toc', 'combinatory_test', 'contest'];

const ids = z.array(z.string().refine(isValidId));
/** Posted structure of the toc editor (JSON field `data`): dispenser data and the task ids to create/delete/wipe. */
export const structurePost = z.object({
	structure: z.record(z.string(), z.unknown()),
	created: ids,
	deleted: ids,
	wiped: ids
});

/** Saves validated dispenser data; returns the error message on failure. */
function saveDispenser(course: Course, posted: Record<string, unknown>): string | null {
	const checked = checkDispenserData(course.dispenser, posted);
	if ('error' in checked) return t('Something wrong happened: {}', t('Invalid course structure: {}', checked.error));
	saveCourse(course.id, { ...course.content, task_dispenser: course.dispenser.kind, dispenser_data: checked.data });
	return null;
}

/** Switches the dispenser: the structure is wiped (`dispenser_data: {}`), like legacy. */
export function switchDispenser(course: Course, kind: string, allowed: string[]): string | null {
	if (!allowed.includes(kind)) return t('Invalid task dispenser');
	saveCourse(course.id, { ...course.content, task_dispenser: kind, dispenser_data: {} });
	return null;
}

/** Imports the legacy task.yaml dispenser fields into the course, then removes them from the tasks. */
export function migrateTasks(course: Course): string | null {
	const error = saveDispenser(course, importLegacyTasks(course));
	if (!error) dropLegacyFields(course);
	return error;
}

/** Structure save of the toc editor. Steps are independent (legacy): every error is reported. */
export async function saveStructure(course: Course, s: z.output<typeof structurePost>): Promise<string[]> {
	const errors = [saveDispenser(course, s.structure)];
	for (const id of s.created) {
		try {
			if (existsSync(coursePath(course.id, id, 'task.yaml'))) throw new Error(t('Task with id {} already exists.', id));
			createTask(course.id, id, { environment_type: 'mcq', name: id, problems: {} });
		} catch (e) {
			errors.push(t("Couldn't create task {} : {}", id, (e as Error).message));
		}
	}
	for (const id of s.deleted) deleteTask(course.id, id);
	for (const id of s.wiped) await wipeSubmissions({ courseid: course.id, taskid: id });
	return errors.filter((e): e is string => !!e);
}
