<!--
@component
Course settings page (CADM-03/04/05): one card per group of the data-driven
course form (General, Access & registration, LTI only for LTI courses, Tags)
with an anchor list on wide screens, the LTI 1.3 clients in the LTI card and a
sticky save bar posting every value as JSON.
-->
<script lang="ts">
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import DoorIcon from '@lucide/svelte/icons/door-open';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import TagsIcon from '@lucide/svelte/icons/tags';
	import {
		adminCrumbs,
		Card,
		LtiClients,
		PageHeader,
		SaveBar,
		SpecForm,
		courseSpec,
		enhance,
		page,
		t,
		toastEnhance
	} from '#lib/components/course-admin/kit.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const course = $derived(data.adminCourse);
	// The form state starts from the stored values and survives saves.
	// svelte-ignore state_referenced_locally
	let values = $state(structuredClone(data.values));
	const spec = $derived(courseSpec(`/admin/${course.id}/search_user`));
	/** Message of the last failed save (shown in place by SpecForm). */
	const error = $derived(page.status >= 400 ? (page.form as { message?: string } | null)?.message : null);
	/** Cards: spec group, anchor, icon and plain-language description; LTI only for LTI courses. */
	const SECTIONS = [
		['General', 'general', SettingsIcon, 'Name, description and staff of the course.'],
		['LTI', 'lti', PlugIcon, 'Use this course from an external learning platform (Moodle, Canvas...) through LTI.'],
		['Access & registration', 'access', DoorIcon, 'When students can see the course and how they register.'],
		['Tags', 'tags', TagsIcon, 'Skills, misconceptions and categories that grading scripts attach to submissions.']
	] as const;
	const sections = $derived(SECTIONS.filter(([title]) => title !== 'LTI' || values.is_lti));
</script>

<PageHeader
	title={t('Course settings')}
	subtitle={t('Describe the course, choose its staff and decide who can register.')}
	breadcrumbs={adminCrumbs(course, t('Course settings'))}
/>

<div class="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_12rem]">
	<form method="POST" class="min-w-0 space-y-6" use:enhance={toastEnhance()}>
		<input type="hidden" name="settings" value={JSON.stringify(values)} />
		{#each sections as [title, id, , description] (id)}
			{@const fields = spec[title]}
			<div {id} class="scroll-mt-20">
				<Card title={t(title)} description={t(description)}>
					{#if fields.some((f) => !f.when || f.when(values))}
						<SpecForm {fields} {values} {error} previewUrl={`/admin/${course.id}/preview`} />
					{:else}
						<p class="text-sm text-surface-600-400">
							{t('Access and registration are managed by the LTI platform.')}
						</p>
					{/if}
					{#if title === 'LTI'}
						<div class="mt-6 border-t border-surface-200-800 pt-6">
							<LtiClients
								clients={data.clients}
								courseid={course.id}
								origin={page.url.origin}
								secrets={values.lti_secrets as Record<string, string>}
							/>
						</div>
					{/if}
				</Card>
			</div>
		{/each}
		<SaveBar {values} version={data.values} />
	</form>
	<nav aria-label={t('On this page')} class="sticky top-20 hidden self-start xl:block">
		<p class="mb-2 px-3 eyebrow">{t('On this page')}</p>
		<ul class="space-y-0.5">
			{#each sections as [title, id, Icon] (id)}
				<li>
					<a
						class="flex items-center gap-2.5 rounded-base px-3 py-1.5 text-sm text-surface-700-300 hover:bg-surface-50-950 hover:text-primary-700-300"
						href={`#${id}`}><Icon class="size-4 text-surface-500" aria-hidden="true" />{t(title)}</a
					>
				</li>
			{/each}
		</ul>
	</nav>
</div>
