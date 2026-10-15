/**
 * User management page (CSTU-01..08): student & staff lists, audiences and
 * groups. Permissions (CSTU-18): everything is visible to the staff; manual
 * (un)registration and the destructive audience upload are admin-only,
 * audiences and groups can be edited
 * by the staff but only within this course; groups are unavailable for LTI courses.
 *
 * Scale: only the data of the shown tab is loaded, one page at a time
 * (`?tab=&q=&page=`, search and pagination on the server).
 */
import { error, fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { registerUser, requireCourseAdmin, requireCourseStaff } from '#lib/server/courses/access.js';
import { audiencePage, createAudience, importStructure } from '#lib/server/course-students/audiences.js';
import { cleanGroups, deleteGroups, groupPage, parseGroups, saveGroups } from '#lib/server/course-students/groups.js';
import {
	matchingStudents,
	memberCounts,
	staffList,
	studentPage,
	unregister
} from '#lib/server/course-students/people.js';
import { formText, uploadText } from '#lib/server/forms.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** Tabs of the page (the first one is the default). */
const TABS = ['students', 'staff', 'audiences', 'groups'] as const;

export const load: PageServerLoad = async (event) => {
	const { course, user } = await requireCourseStaff(event, event.params.courseid);
	const params = event.url.searchParams;
	const counts = await memberCounts(course);
	const wished = params.get('tab') as (typeof TABS)[number];
	const tab = TABS.includes(wished) && (wished !== 'groups' || counts.groups !== null) ? wished : 'students';
	const [q, page] = [params.get('q') ?? '', params.get('page')];
	return {
		tab,
		q,
		counts,
		students: tab === 'students' ? await studentPage(course, q, page) : null,
		staff: tab === 'staff' ? await staffList(course) : null,
		audiences: tab === 'audiences' ? await audiencePage(course, user.username, q, page) : null,
		groups: tab === 'groups' ? await groupPage(course, q, page) : null
	};
};

/** Result of an action: `fail(400)` with the error message, or the success message. */
const reply = (error: string | null, success: string) => (error ? fail(400, { message: error }) : { message: success });

/** Guard of the group actions: staff of a non-LTI course. */
async function groupCourse(event: RequestEvent) {
	const { course } = await requireCourseStaff(event, event.params.courseid);
	if (course.isLti) error(403, t('You are not allowed to do that.'));
	return course;
}

/** Saves groups (`text` = JSON or YAML): edited groups, or the whole structure with `replace`. */
async function groups(event: RequestEvent, get: (form: FormData) => Promise<string | null>, replace: boolean) {
	const course = await groupCourse(event);
	const list = parseGroups((await get(await event.request.formData())) ?? '-', !replace);
	return reply(
		list ? await saveGroups(course, list, replace) : t('An error occurred while parsing the data.'),
		t('Groups updated.')
	);
}

export const actions: Actions = {
	/** CSTU-02: registers a user (admins). */
	register: async (event) => {
		const { course } = await requireCourseAdmin(event, event.params.courseid);
		const ok = await registerUser(course, formText(await event.request.formData(), 'username').trim(), null, true);
		return ok ? { message: t('User registered.') } : fail(400, { message: t('Unknown or already registered user.') });
	},
	/**
	 * CSTU-02: unregisters the `selected` students, or with `all` every student
	 * (only those matching the search `q` when given) (admins).
	 */
	unregister: async (event) => {
		const { course } = await requireCourseAdmin(event, event.params.courseid);
		const form = await event.request.formData();
		const q = formText(form, 'q');
		const users = form.has('all')
			? q
				? await matchingStudents(course, q)
				: null
			: form.getAll('selected').map(String);
		await unregister(course, users);
		return { message: t('Users unregistered.') };
	},
	/** CSTU-04: creates an audience (staff). */
	audience: async (event) => {
		const { course } = await requireCourseStaff(event, event.params.courseid);
		await createAudience(course.id, formText(await event.request.formData(), 'description').trim());
		return { message: t('New audience created.') };
	},
	/** CSTU-06: replaces the audiences from a CSV file (admins). */
	audiences: async (event) => {
		const { course } = await requireCourseAdmin(event, event.params.courseid);
		const text = await uploadText(await event.request.formData(), 'file');
		const message =
			text === null ? t('An error occurred while parsing the data.') : await importStructure(course, text);
		return reply(message, t('Audiences updated.'));
	},
	/** CSTU-07: saves the groups edited in the editor (JSON list; other groups unchanged). */
	groups: (event) => groups(event, async (form) => formText(form, 'groups'), false),
	/** CSTU-08: replaces the groups from a YAML file. */
	uploadGroups: (event) => groups(event, (form) => uploadText(form, 'file'), true),
	/** CSTU-07: deletes the group `id`, or every group without `id`. */
	deleteGroups: async (event) => {
		const course = await groupCourse(event);
		const form = await event.request.formData();
		await deleteGroups(course.id, form.has('id') ? formText(form, 'id') : null);
		return { message: t('Groups updated.') };
	},
	/** CSTU-07: removes every student from the groups. */
	cleanGroups: async (event) => {
		await cleanGroups((await groupCourse(event)).id);
		return { message: t('Groups updated.') };
	}
};
