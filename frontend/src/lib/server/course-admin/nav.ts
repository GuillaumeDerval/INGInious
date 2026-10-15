/**
 * Course administration menu (CADM-02), shared by the `/admin/<courseid>` layout
 * and the staff submission page (`/submission/<id>`, which lives outside that
 * layout but belongs to the course administration).
 */
import { t } from '#lib/i18n/index.js';
import { plugins } from '../plugins/index.js';
import type { Course } from '../courses/course.js';
import type { NavItem, NavSection } from '#lib/components/layout/nav.js';

/**
 * Builds the administration sidebar of a course. Admin-only entries are hidden
 * from tutors (pages and actions still check their own rights).
 * @param active path (relative to `/admin/<courseid>/`) of an entry to force as active.
 */
export async function adminNav(course: Course, admin: boolean, lang: string, active?: string): Promise<NavSection[]> {
	const base = `/admin/${course.id}`;
	// Menu groups (docs/ux-design.md): [title, [path, label, shown]...].
	const groups: [string, [string, string, boolean][]][] = [
		[
			t('Course'),
			[
				['settings', t('Course settings'), admin],
				['tasks', t('Task list'), admin],
				['danger', t('Danger zone'), admin]
			]
		],
		[
			t('People'),
			[
				['students', t('Students'), true],
				['students?tab=audiences', t('Audiences'), true],
				['students?tab=groups', t('Groups'), true]
			]
		],
		[
			t('Results'),
			[
				['submissions', t('Submissions'), true],
				['stats', t('Statistics'), true]
			]
		]
	];
	const nav: NavSection[] = groups.map(([title, entries]) => ({
		title,
		items: entries
			.filter((e) => e[2])
			.map(([path, label]) => ({ label, href: `${base}/${path}`, ...(path === active ? { active: true } : {}) }))
	}));
	nav[0].items.push(...(await plugins().callHook<object, NavItem>('course_admin_menu', { course })));
	// Context header (docs/design-system.md): the administered course, linking to its student page.
	const name = course.tr(lang, course.name);
	nav.unshift({ title: name, context: t('Course administration'), contextHref: `/course/${course.id}`, items: [] });
	nav.push({
		title: t('Documentation'),
		items: [
			{ label: t('How to create a task?'), href: 'https://docs.inginious.org/en/latest/teacher_doc/task_tuto.html' },
			{ label: t('Documentation'), href: 'https://docs.inginious.org/en/latest/teacher_documentation.html' }
		]
	});
	return nav;
}
