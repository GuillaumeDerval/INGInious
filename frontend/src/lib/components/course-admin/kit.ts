/**
 * Single import point of the course administration pages (CADM-02..16,
 * CSTU-01..17): the UI kit components, the area components and the helpers
 * they all use (one import line per page).
 */
import { t } from '#lib/i18n/index.js';

export { enhance } from '$app/forms';
export { page } from '$app/state';
export { t };
export { formatGrade } from '#lib/utils/grade.js';
export { toastEnhance } from '../layout/toaster.js';
export { default as RichText } from '../common/RichText.svelte';
export { default as Alert } from '../ui/Alert.svelte';
export { default as Badge } from '../ui/Badge.svelte';
export { default as Card } from '../ui/Card.svelte';
export { default as ConfirmDialog } from '../ui/ConfirmDialog.svelte';
export { default as CopyField } from '../ui/CopyField.svelte';
export { default as DateTime } from '../ui/DateTime.svelte';
export { default as FileDrop } from '../ui/FileDrop.svelte';
export { default as GradeBar } from '../ui/GradeBar.svelte';
export { default as MoreMenu } from '../ui/MoreMenu.svelte';
export { default as PageHeader } from '../ui/PageHeader.svelte';
export { default as ResultBadge } from '../ui/ResultBadge.svelte';
export { default as SearchSelect } from '../ui/SearchSelect.svelte';
export { default as LtiClients } from './LtiClients.svelte';
export { default as SaveBar } from './SaveBar.svelte';
export { default as SpecForm } from './SpecForm.svelte';
export { default as SubproblemsEditor } from './SubproblemsEditor.svelte';
export { default as TaskFiles } from './TaskFiles.svelte';
export { default as TocEditor } from './TocEditor.svelte';
export { BASIC_SPEC, courseSpec, envSpec } from './specs.js';
export { default as GroupsEditor } from '../course-students/GroupsEditor.svelte';
export { default as QueryForm } from '../course-students/QueryForm.svelte';
export { default as StatsChart } from '../course-students/StatsChart.svelte';
export { default as SubmissionTable } from '../course-students/SubmissionTable.svelte';
export { default as Table } from '../course-students/Table.svelte';

/** A breadcrumb (PageHeader). */
type Crumb = { label: string; href?: string };

/**
 * Breadcrumbs of a course administration page, always `Course › Administration › ...`
 * (D9); plain strings are entries without link (the current page last).
 */
export const adminCrumbs = (course: { id: string; name: string }, ...items: (string | Crumb)[]): Crumb[] => [
	{ label: course.name, href: `/course/${course.id}` },
	{ label: t('Administration'), href: `/admin/${course.id}` },
	...items.map((i) => (typeof i === 'string' ? { label: i } : i))
];
