<!--
@component
Task files manager (CADM-14): a "Files" card with the tree of the task folder
(click a file to open it; download as an icon button; move/rename and delete
in a "more" menu; new file, upload and download of the whole folder in the
header) and, beside it, the editor of the opened text file. Every change is a
POST form action; paths are passed as form data, never inside scripts or HTML.

Props:
- `files` (FileEntry[]): folder listing (root task.yaml hidden).
- `opened` ({path, content, error?} | null): file opened in the editor (`content` null = not UTF-8).
- `base` (string): URL of the files page.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import FileIcon from '@lucide/svelte/icons/file';
	import FileCodeIcon from '@lucide/svelte/icons/file-code';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FilePlusIcon from '@lucide/svelte/icons/file-plus';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { t } from '#lib/i18n/index.js';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import CodeEditor from '#lib/components/ui/CodeEditor.svelte';
	import ConfirmDialog from '#lib/components/ui/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import FileDrop from '#lib/components/ui/FileDrop.svelte';
	import MoreMenu from '#lib/components/ui/MoreMenu.svelte';
	import type { FileEntry } from '#lib/server/course-admin/task-files.js';

	/** Props (documented in the component comment above). */
	export interface Props {
		files: FileEntry[];
		opened: { path: string; content: string | null; error?: string } | null;
		base: string;
	}

	let { files, opened, base }: Props = $props();
	let uploadPath = $state('');
	/** Path whose deletion is being confirmed. */
	let deleting = $state('');
	let confirmOpen = $state(false);
	/** Editor language: legacy `run` scripts are Python, otherwise the extension. */
	const language = $derived(opened?.path.replace(/^\//, '') === 'run' ? 'python' : opened?.path.split('.').pop());
	const dl = (path: string) => `${base}/download?path=${encodeURIComponent(path)}`;
	const iconBtn = 'btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal';
</script>

<div class="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
	<section class="panel" aria-labelledby="files-title">
		<header class="flex items-center gap-1 border-b border-surface-200-800 py-2.5 ps-4 pe-2.5">
			<h2 id="files-title" class="flex-1 text-base font-semibold">{t('Files')}</h2>
			<MoreMenu label={t('Create a new file')} icon={FilePlusIcon} iconOnly summaryClass={iconBtn} class="w-72 p-3">
				<form method="POST" action="?/create" class="space-y-2" use:enhance={toastEnhance()}>
					<input
						class="input font-mono"
						name="path"
						aria-label={t('Enter the path to the file')}
						placeholder="/folder/file.py"
						required
					/>
					<p class="text-xs text-surface-600-400">{t('End the path with / to create a folder.')}</p>
					<button class="btn w-full preset-tonal btn-sm"><FilePlusIcon />{t('Create a new file')}</button>
				</form>
			</MoreMenu>
			<MoreMenu label={t('Upload')} icon={UploadIcon} iconOnly summaryClass={iconBtn} class="w-80 p-3">
				<form
					method="POST"
					action="?/upload"
					enctype="multipart/form-data"
					class="space-y-2"
					use:enhance={toastEnhance()}
				>
					<FileDrop
						name="file"
						label={t('Upload a file')}
						required
						onchange={(f) => (uploadPath = f[0] ? `/${f[0].name}` : '')}
					/>
					<input class="input font-mono" name="path" aria-label={t('File path:')} bind:value={uploadPath} />
					<button class="btn w-full preset-tonal btn-sm"><UploadIcon />{t('Upload')}</button>
				</form>
			</MoreMenu>
			<a class={iconBtn} href={dl('/')} aria-label={t('Download all files')} title={t('Download all files')}
				><DownloadIcon /></a
			>
		</header>
		<ul class="py-1.5">
			{#each files as f (f.path)}
				{@const current = opened?.path === f.path}
				<li
					class={['flex items-center gap-1.5 pe-2', current ? 'bg-primary-500/10' : 'hover:bg-surface-100-900/60']}
					style:padding-inline-start={`${0.875 + f.depth * 1.125}rem`}
				>
					{#if f.dir}
						<FolderIcon class="size-4 shrink-0 text-primary-600-400" aria-hidden="true" />
						<span class="min-w-0 flex-1 truncate py-1.5 text-sm font-medium">{f.name}</span>
					{:else}
						<FileIcon class="size-4 shrink-0 text-surface-500" aria-hidden="true" />
						<a
							class={[
								'min-w-0 flex-1 truncate py-1.5 text-sm hover:underline',
								current && 'font-semibold text-primary-700-300'
							]}
							href={`?open=${encodeURIComponent(f.path)}`}
							aria-current={current ? 'true' : undefined}>{f.name}</a
						>
					{/if}
					<a class={iconBtn} href={dl(f.path)} aria-label={t('Download')} title={t('Download')}><DownloadIcon /></a>
					<MoreMenu label={t('More actions')} iconOnly summaryClass={iconBtn} class="w-72 p-1.5">
						<form method="POST" action="?/rename" class="space-y-2 p-2" use:enhance={toastEnhance()}>
							<input type="hidden" name="path" value={f.path} />
							<label class="block space-y-1">
								<span class="block text-xs font-medium text-surface-600-400">{t('Move or rename')}</span>
								<input
									class="input font-mono field-sm"
									name="new_path"
									aria-label={t('Enter the new path')}
									value={f.path}
								/>
							</label>
							<button class="btn w-full preset-tonal btn-sm">{t('Move')}</button>
						</form>
						<hr class="my-1 border-surface-200-800" />
						<button
							type="button"
							class="menu-item text-error-600-400"
							onclick={() => ((deleting = f.path), (confirmOpen = true))}><TrashIcon />{t('Delete')}</button
						>
					</MoreMenu>
				</li>
			{:else}
				<li class="px-4 py-3 text-sm text-surface-600-400">{t('This task has no file besides task.yaml.')}</li>
			{/each}
		</ul>
	</section>

	<section class="min-w-0 panel" aria-label={t('Editor')}>
		{#if opened}
			<form method="POST" action="?/save" use:enhance={toastEnhance()}>
				<header class="flex items-center gap-2 border-b border-surface-200-800 px-4 py-3">
					<FileCodeIcon class="size-4 shrink-0 text-surface-500" aria-hidden="true" />
					<h2 class="min-w-0 flex-1 truncate font-mono text-sm font-semibold">{opened.path}</h2>
					<a class={iconBtn} href={dl(opened.path)} aria-label={t('Download')} title={t('Download')}><DownloadIcon /></a
					>
				</header>
				{#if opened.content === null}
					<div class="p-4"><Alert kind="error">{opened.error || t("INGInious can't read this file.")}</Alert></div>
				{:else}
					<div class="p-3">
						<input type="hidden" name="path" value={opened.path} />
						<CodeEditor label={opened.path} name="content" value={opened.content} {language} minLines={22} />
					</div>
					<footer class="flex justify-end border-t border-surface-200-800 px-4 py-3">
						<button class="btn preset-filled-primary-500">{t('Save changes')}</button>
					</footer>
				{/if}
			</form>
		{:else}
			<EmptyState
				compact
				icon={FileCodeIcon}
				title={t('No file opened')}
				description={t(
					'Click a file in the list to edit it here, or create or upload one with the buttons above the list.'
				)}
			/>
		{/if}
	</section>
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title={t('Are you sure you want to delete this?')}
	description={deleting}
	confirmLabel={t('Delete')}
	action="?/delete"
	fields={{ path: deleting }}
/>
