/**
 * Downloads of the user management page (staff): `students.csv` (CSTU-01),
 * `audiences.csv` (CSTU-04), `audiences-structure.csv?preferred_field=username|email`
 * (CSTU-06), `groups.yaml` (CSTU-08), `student.csv?username=` (CSTU-09) and
 * `progress.csv` (CSTU-16); plus `students.json?q=`, the registered students
 * matching `q` (member picker of the group editor, CSTU-07). Unknown files, and
 * `student.csv` of a user unrelated to the course (`isCourseUser`), are 404.
 */
import { error, json } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { requireCourseStaff } from '#lib/server/courses/access.js';
import { isCourseUser } from '#lib/server/courses/members.js';
import { audiencesCsv, structureCsv } from '#lib/server/course-students/audiences.js';
import { csvDownload, dictCsv } from '#lib/server/course-students/csv.js';
import { groupsYaml, studentOptions } from '#lib/server/course-students/groups.js';
import { download } from '#lib/server/forms.js';
import { membersCsv, progress, studentTasksCsv } from '#lib/server/course-students/people.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { course, user } = await requireCourseStaff(event, event.params.courseid);
	const params = event.url.searchParams;
	const field = params.get('preferred_field') === 'email' ? 'email' : 'username';
	const username = params.get('username') ?? '';
	const lang = event.locals.lang;
	const files: Record<string, () => Promise<Response>> = {
		'students.csv': async () => csvDownload(await membersCsv(course)),
		'audiences.csv': async () => csvDownload(await audiencesCsv(course, user.username)),
		'audiences-structure.csv': async () => csvDownload(await structureCsv(course.id, field), 'audiences.csv'),
		'groups.yaml': async () => download(await groupsYaml(course.id), 'groups.yaml', 'text/x-yaml'),
		'student.csv': async () =>
			(await isCourseUser(course, username))
				? csvDownload(await studentTasksCsv(course, username, lang))
				: error(404, t('User not found')),
		'progress.csv': async () =>
			csvDownload(dictCsv(Object.fromEntries((await progress(course, lang)).rows.map(({ id, ...row }) => [id, row])))),
		'students.json': async () => json(await studentOptions(course, params.get('q') ?? ''))
	};
	if (!Object.hasOwn(files, event.params.file)) error(404, t('Not found'));
	return files[event.params.file]();
};
