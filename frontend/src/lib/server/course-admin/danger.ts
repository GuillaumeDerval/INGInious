/**
 * Danger zone (CADM-15/16): archive the course data into a new archive course,
 * or delete the course with all its data, with the legacy data semantics.
 */
import { cpSync, existsSync } from 'node:fs';
import { pyIsoformat } from '../db/index.js';
import { services } from '../app.js';
import { deleteSubmissions } from '../submissions/manager.js';
import { deleteCourse, saveCourse, type Course } from '../courses/course.js';
import { coursePath } from '../courses/files.js';

const COLLECTIONS = ['submissions', 'userTasks', 'groups', 'audiences'] as const;

/**
 * Copies the course folder to `<id>_archive_<UTC date>` (with `archived: true`
 * and `archive_date`), moves its submissions, user tasks, groups, audiences
 * and registered students to the archive and returns the archive id.
 * @throws Error for archive courses or an existing archive id.
 */
export async function archiveCourse(course: Course, now = new Date()): Promise<string> {
	if (course.archived) throw new Error('This course is already an archive course. You cannot archive it again.');
	const stamp = now.toISOString().slice(0, 19).replace(/[-T:]/g, '_');
	const archive = `${course.id}_archive_${stamp}`;
	if (existsSync(coursePath(archive))) throw new Error(`${archive} already exists`);
	cpSync(coursePath(course.id), coursePath(archive), { recursive: true, verbatimSymlinks: true });
	saveCourse(archive, { ...course.content, archived: true, archive_date: pyIsoformat(now) });
	const { db } = services();
	for (const name of COLLECTIONS) await db.c[name].updateMany({ courseid: course.id }, { $set: { courseid: archive } });
	const doc = await db.c.courses.findOneAndDelete({ _id: course.id });
	if (doc) await db.c.courses.insertOne({ ...doc, _id: archive });
	return archive;
}

/** Deletes the submissions (and their GridFS input/archive) and user tasks matching a filter (CADM-07 wipe). */
export async function wipeSubmissions(filter: { courseid: string; taskid?: string }): Promise<void> {
	await deleteSubmissions(filter);
	await services().db.c.userTasks.deleteMany(filter);
}

/** Deletes the course data (the `courses` document is emptied, like legacy) and its folder. */
export async function wipeAndDeleteCourse(course: Course): Promise<void> {
	const { db } = services();
	await wipeSubmissions({ courseid: course.id });
	await db.c.courses.updateOne({ _id: course.id }, { $set: { students: [] } });
	for (const name of ['groups', 'audiences'] as const) await db.c[name].deleteMany({ courseid: course.id });
	deleteCourse(course.id);
}
