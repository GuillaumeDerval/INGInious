/**
 * Exports of the submissions page (course staff), same query parameters as the page:
 * `submissions.csv` (CSTU-12) and `submissions.tgz` (CSTU-13; `download_type`,
 * `eval_dl`, `simplify`; `submission`/`selected` ids restrict it to done submissions of this
 * course, one id = files at the archive root).
 */
import { error } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { requireCourseStaff } from '#lib/server/courses/access.js';
import { audiencesPerStudent } from '#lib/server/courses/members.js';
import { archiveStream, LAYOUTS } from '#lib/server/course-students/archive.js';
import { csvDownload } from '#lib/server/course-students/csv.js';
import { parseQuery, pickSubmissions, selectedSubmissions, submissionsCsv } from '#lib/server/course-students/query.js';
import { download } from '#lib/server/forms.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { course } = await requireCourseStaff(event, event.params.courseid);
	const params = event.url.searchParams;
	const q = parseQuery(params);
	if (event.params.file === 'submissions.csv') return csvDownload(await submissionsCsv(course, q));
	if (event.params.file !== 'submissions.tgz') error(404, t('Not found'));
	const ids = [...params.getAll('submission'), ...params.getAll('selected')];
	const chosen = await pickSubmissions(course, ids);
	if (ids.length && !chosen.length) error(404, t('No submission selected.'));
	let folders: string[] = [];
	if (chosen.length !== 1) {
		q.eval ||= params.has('eval_dl');
		const type = params.get('download_type') ?? '';
		folders = (LAYOUTS.find((l) => l === type) ?? LAYOUTS[0]).split('/');
		if (!q.eval || !params.has('simplify')) folders.push('submissiondateid');
	}
	const docs = ids.length ? chosen : (await selectedSubmissions(course, q)).docs;
	return download(
		archiveStream(docs, folders, params.has('simplify'), await audiencesPerStudent(course.id)),
		'submissions.tgz',
		'application/x-gzip'
	);
};
