/**
 * Submissions archive download (CSTU-13): streams a `.tgz` with the legacy
 * folder layout (`get_submission_archive`): for each submission and each base
 * path (`taskid`, `username` (one per member), `audience`, `submissiondateid`),
 * `submission.test` (YAML of the document), the grader archive under
 * `archive/` and the uploaded files (`uploaded_files/<problemid><ext>`).
 *
 * Behaviour (CSTU-13/18): submissions without grader archive (MCQ, crashes) are
 * fine, member names of grader archives are normalised (no `..`, no absolute
 * paths) and links/special members are dropped, audience descriptions cannot
 * create extra directories.
 */
import { pipeline, Readable } from 'node:stream';
import { createGzip, gunzipSync } from 'node:zlib';
import { extract, pack as tarPack, type Header, type Pack } from 'tar-stream';
import { services } from '../app.js';
import { dumpYaml } from '../courses/files.js';
import { pyIsoformat } from '../db/index.js';
import type { AudienceDoc } from '../db/types.js';
import type { Submission } from '../submissions/manager.js';

/** Folder layouts offered by the download dialog. */
export const LAYOUTS = ['taskid/username', 'taskid/audience', 'username/taskid', 'audience/taskid'] as const;

/** One safe path component (no separator, never `.`/`..`/empty). */
const safe = (s: string) => (/^\.{0,2}$/.test(s) ? '_' : s.replace(/[/\\\0]/g, '_'));

/** Normalised relative member path (empty, `.` and `..` parts dropped); null when nothing remains. */
const safePath = (name: string) =>
	name
		.split(/[/\\]/)
		.filter((p) => !/^\.{0,2}$/.test(p))
		.join('/') || null;

/** Extension kept for uploaded files (legacy: double extensions of tarballs, else the last one). */
const ext = (name: string) =>
	['.tar.gz', '.tar.bz2', '.tar.bz', '.tar.xz'].find((e) => name.endsWith(e)) ?? /\.[^./\\]*$/.exec(name)?.[0] ?? '';

/** Adds one entry to the tar and waits for it to be written. */
const entry = (pack: Pack, header: Partial<Header> & { name: string }, data?: Uint8Array | string) =>
	new Promise<void>(
		(resolve, reject, done = (e?: Error | null) => (e ? reject(e) : resolve())) =>
			void (data === undefined ? pack.entry(header, done) : pack.entry(header, data, done))
	);

/** Base paths of a submission for the given folder list (group submissions duplicated per member). */
function basePaths(sub: Submission, folders: string[], audiences: Record<string, AudienceDoc[]>): string[] {
	let paths = [''];
	for (const f of folders) {
		const byAudience = () =>
			sub.username.flatMap(
				(u) =>
					audiences[u]?.map((a) => `${a.description} (${a._id})`.replaceAll(' ', '_')) ?? [
						[...sub.username].sort().join('-')
					]
			);
		const parts =
			f === 'taskid'
				? [sub.taskid]
				: f === 'username'
					? sub.username
					: f === 'audience'
						? byAudience()
						: [pyIsoformat(sub.submitted_on)];
		paths = paths.flatMap((p) => [...new Set(parts)].map((x) => (p ? `${p}/${safe(x)}` : safe(x))));
	}
	return paths;
}

/** Writes the files of one submission under `base`. */
async function writeSubmission(pack: Pack, sub: Submission, base: string, simplify: boolean): Promise<void> {
	const { db } = services();
	const mtime = sub.submitted_on;
	await entry(pack, { name: `${base}submission.test`, mtime }, dumpYaml(JSON.parse(JSON.stringify(sub))));
	if (sub.archive)
		try {
			const members = extract();
			Readable.from([gunzipSync(await db.getFile(sub.archive))]).pipe(members);
			await entry(pack, { name: `${base}archive`, type: 'directory', mtime });
			for await (const m of members) {
				const chunks: Uint8Array[] = [];
				for await (const c of m) chunks.push(c as Uint8Array);
				const { type, mode, mtime, uname, gname } = m.header,
					name = safePath(m.header.name);
				if (name && (type === 'file' || type === 'directory'))
					await entry(
						pack,
						{ name: `${base}archive/${name}`, type, mode, mtime, uname, gname },
						type === 'file' ? Buffer.concat(chunks) : undefined
					);
			}
		} catch {
			// Unreadable grader archive: the rest of the submission is still exported.
		}
	for (const [pid, v] of Object.entries(await db.getInput(sub.input)))
		if (v && typeof v === 'object' && 'filename' in v) {
			const name = safe(pid + ext(String(v.filename)));
			await entry(
				pack,
				{ name: base + (simplify && name !== 'submission.test' ? name : `uploaded_files/${name}`), mtime },
				Buffer.from((v as { value?: Uint8Array }).value ?? '')
			);
		}
}

/**
 * Streams the gzipped tar of the submissions.
 * @param folders base folders (e.g. ["taskid", "username", "submissiondateid"]; [] = files at the root).
 * @param audiences student -> audiences of the course (for `audience` folders).
 */
export function archiveStream(
	docs: Submission[],
	folders: string[],
	simplify: boolean,
	audiences: Record<string, AudienceDoc[]>
): ReadableStream {
	const pack = tarPack();
	(async () => {
		const used = new Map<string, number>();
		for (const sub of docs)
			for (const base of basePaths(sub, folders, audiences)) {
				const n = used.set(base, (used.get(base) ?? -1) + 1).get(base)!;
				await writeSubmission(pack, sub, base ? `${base}${n ? `-${n}` : ''}/` : '', simplify);
			}
		pack.finalize();
	})().catch((e) => pack.destroy(e));
	// pipeline (not pipe): an error of the tar aborts the response instead of leaving it open forever.
	return Readable.toWeb(pipeline(pack, createGzip(), () => {})) as ReadableStream;
}
