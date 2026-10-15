<!--
@component
Task files page (CADM-14): the files manager of one task, with a link back to its editor.
-->
<script lang="ts">
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import { adminCrumbs, PageHeader, TaskFiles, page, t } from '#lib/components/course-admin/kit.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const course = $derived(data.adminCourse);
	const editor = $derived(`/admin/${course.id}/edit/task/${data.taskid}`);
</script>

<PageHeader
	title={t('Task files')}
	breadcrumbs={adminCrumbs(
		course,
		{ label: t('Task list'), href: `/admin/${course.id}/tasks` },
		{ label: t('Edit task "{}"', data.taskid), href: editor },
		t('Task files')
	)}
	subtitle={t('Grading scripts, templates and public files of the task "{}".', data.taskid)}
>
	{#snippet actions()}<a class="btn preset-tonal" href={editor}><PencilIcon />{t('Edit task')}</a>{/snippet}
</PageHeader>
<TaskFiles files={data.files} opened={data.opened} base={page.url.pathname} />
