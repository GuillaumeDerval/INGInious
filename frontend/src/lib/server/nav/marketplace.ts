/**
 * Course marketplace (NAV-18, NAV-19): list of publicly shared course
 * repositories and their import (git clone + new course.yaml).
 *
 * Behaviour: the remote JSON is fetched with a timeout and
 * validated (network errors give an empty list instead of a 500), remote
 * descriptions are rendered through the sanitizer (short descriptions as
 * text), only `https://` repositories are cloned, `git` runs through `execFile`
 * (no shell, `--` before the URL, no credential prompt) and the cloned `.git`
 * folder is removed so that it is never exposed by the file editors/WebDAV.
 * Symbolic links of the repository are deleted too (course files are always
 * regular files and directories, see security/paths.ts).
 */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import { requireSuperadmin } from '../security/guards.js';
import { services } from '../app.js';
import { attempt } from '../attempt.js';
import { coursePath, dumpYaml, idChecker, parseYaml, writeFileAtomic } from '../courses/files.js';

/** Official marketplace (legacy `MARKETPLACE_URL`); `marketplace_url` in configuration.yaml overrides it. */
export const MARKETPLACE_URL = 'https://marketplace.inginious.org/marketplace.json';

const str = z.string();
const loc = z.record(str, str);
const schema = z.array(
	z.object({
		id: str,
		link: str,
		languages: str,
		license: str,
		maintainers: str,
		authors: str,
		default_language: str,
		name: loc,
		short_desc: loc,
		description: loc
	})
);

/** A marketplace course, as published in the marketplace JSON. */
export type MarketCourse = z.infer<typeof schema>[number];

/** Localised value of a marketplace field: `lang`, else the default language, else the first value. */
export function pick(course: MarketCourse, field: 'name' | 'short_desc' | 'description', lang: string): string {
	const dict = course[field];
	return dict[lang] ?? dict[course.default_language] ?? Object.values(dict)[0] ?? '';
}

/** Fetches the marketplace courses (10 s timeout); an empty list when unreachable or invalid. */
export async function marketCourses(): Promise<MarketCourse[]> {
	try {
		const url = String(services().config.raw.marketplace_url ?? MARKETPLACE_URL);
		const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		return schema.parse(await response.json());
	} catch {
		return [];
	}
}

/**
 * Deletes every symbolic link of a directory tree. Links are never followed: only real
 * directories are visited (`readdirSync`'s `recursive` option descends into linked ones).
 */
function removeSymlinks(dir: string): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isSymbolicLink()) unlinkSync(path);
		else if (entry.isDirectory()) removeSymlinks(path);
	}
}

/**
 * Imports a marketplace course as `courseid`, the importer becoming its admin
 * (legacy `import_course`). The new course is hidden and keeps only the
 * description, tags, name and table of contents of the original one.
 * The course id has already been checked by `importAction`, its only caller.
 * @returns null on success, else the error message (legacy `ImportCourseException` messages).
 */
export async function importCourse(course: MarketCourse, courseid: string, username: string): Promise<string | null> {
	const dir = coursePath(courseid);
	if (existsSync(coursePath(courseid, 'course.yaml')) || existsSync(coursePath(courseid, 'course.json')))
		return `Course with id ${courseid} already exists.`;
	try {
		if (new URL(course.link).protocol !== 'https:') throw new Error('Only https repositories are allowed');
		await promisify(execFile)('git', ['clone', '--', course.link, dir], {
			timeout: 120_000,
			env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
		});
	} catch {
		rmSync(dir, { recursive: true, force: true });
		return "Couldn't clone course into your instance";
	}
	rmSync(coursePath(courseid, '.git'), { recursive: true, force: true });
	removeSymlinks(dir);
	// No (valid) course.yaml in the repository: legacy starts from {}.
	const old = attempt(
		() => (parseYaml(readFileSync(coursePath(courseid, 'course.yaml'), 'utf8')) as Record<string, unknown>) ?? {},
		() => ({}) as Record<string, unknown>
	);
	const name = old.name ? `${String(old.name)} - ${courseid}` : courseid;
	const content: Record<string, unknown> = {
		description: old.description ?? '',
		admins: [username],
		accessible: false,
		tags: old.tags ?? {},
		name
	};
	if (old.toc) Object.assign(content, { task_dispenser: 'toc', dispenser_data: { config: {}, toc: old.toc } });
	writeFileAtomic(coursePath(courseid, 'course.yaml'), dumpYaml(content));
	return null;
}

/**
 * Form action importing a marketplace course (NAV-18/19), superadmin only.
 * Fields: `new_courseid` and, when `marketId` is null, `courseid`.
 * @param target URL to go to after a successful import.
 */
export async function importAction(event: RequestEvent, marketId: string | null, target: (id: string) => string) {
	const user = requireSuperadmin(event);
	const form = await event.request.formData();
	const courseid = String(form.get('new_courseid') ?? '');
	const id = marketId ?? String(form.get('courseid') ?? '');
	// The id is checked before contacting the marketplace (cheap errors first).
	if (!idChecker(courseid)) return fail(400, { message: `Course with invalid name: ${courseid}` });
	const course = (await marketCourses()).find((c) => c.id === id);
	if (!course) return fail(400, { message: t('User returned an invalid form.') });
	const message = await importCourse(course, courseid, user.username);
	if (message) return fail(400, { message });
	redirect(303, target(courseid));
}
