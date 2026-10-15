/**
 * Integration tests of the bounds applied to course content and staff exports:
 * rendered texts get prefixed ids and unknown classes and harmless inline styles only
 * (TASK-19, task context and grader feedback), grader archives are exported with plain
 * permissions and size limits (CSTU-13), the page size of the submissions listing is
 * capped and archives/replays of too many submissions are refused (CSTU-11/13/14).
 */
import { GridFSBucket, BSON, Double } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync, gzipSync } from 'node:zlib';
import { extract, pack } from 'tar-stream';
import { parse, stringify } from 'yaml';
import { test, expect, installCourse, withDb } from '../fixtures.js';
import { E2E } from '../setup-data.js';

let n = 0;
/** Installs a fresh copy of the `cstu_course` fixture with e2e_student1 registered. */
async function course(name: string): Promise<string> {
	const c = installCourse('cstu_course', `e2e_secb_${name}_${Date.now() % 100000}${n++}`);
	await withDb((db) => db.collection('courses').insertOne({ _id: c as never, students: ['e2e_student1'] }));
	return c;
}

/** Stores a file in GridFS and returns its id. */
const putFile = (data: Uint8Array) =>
	withDb(async (db) => {
		const upload = new GridFSBucket(db).openUploadStream('file');
		upload.end(data);
		await new Promise((r) => upload.on('finish', r));
		return upload.id;
	});

/** Seeds a graded submission of e2e_student1 to the `answer` task and returns its id. */
async function submission(c: string, extra: Record<string, unknown> = {}): Promise<string> {
	const input = await putFile(BSON.serialize({ answer: '1', '@lang': 'en', '@username': 'e2e_student1' }));
	const doc = {
		courseid: c,
		taskid: 'answer',
		username: ['e2e_student1'],
		input,
		status: 'done',
		submitted_on: new Date(),
		grade: new Double(0),
		result: 'failed',
		text: 'Wrong',
		problems: {},
		tests: {},
		...extra
	};
	return String(await withDb(async (db) => (await db.collection('submissions').insertOne(doc)).insertedId));
}

/** Raw HTML that tries to use the page's own classes, ids and positioning. */
const OVERLAY =
	'<div class="fixed inset-0 z-50 alert alert-info" id="task-result" ' +
	'style="position: fixed; top: 0; width: 100vw; height: 100vh; z-index: 9999; color: red">Overlay</div>';

test('TASK-19 rendered texts get prefixed classes and ids and harmless styles only', async ({ page, loginAs }) => {
	const c = await course('content');
	const file = join(E2E.tasksDir, c, 'answer', 'task.yaml');
	const task = parse(readFileSync(file, 'utf8'));
	task.context = `See the note [#]_.\n\n.. raw:: html\n\n    ${OVERLAY}\n\n.. [#] The note.`;
	writeFileSync(file, stringify(task));
	await loginAs('e2e_student1');
	await page.goto(`/course/${c}/answer`);
	const overlay = page.locator('.rich-text div', { hasText: 'Overlay' });
	await expect(overlay).toHaveAttribute('class', 'rt-fixed rt-inset-0 rt-z-50 alert alert-info');
	await expect(overlay).toHaveAttribute('id', 'rt-task-result');
	await expect(overlay).toHaveAttribute('style', 'color:red');
	await expect(overlay).toHaveCSS('position', 'static');
	// The footnote still links to its (prefixed) target.
	const ref = page.locator('.rich-text a.footnote-reference');
	const target = String(await ref.getAttribute('href'));
	expect(target).toMatch(/^#rt-/);
	await ref.click();
	await expect(page).toHaveURL(new RegExp(`${target}$`));
	await expect(page.locator(target)).toContainText('The note.');

	// Grader feedback echoing student text is rendered the same way on the staff pages.
	const s = await submission(c, { text: `Your output:\n\n.. raw:: html\n\n    ${OVERLAY}` });
	await loginAs('e2e_tutor');
	await page.goto(`/submission/${s}`);
	const echoed = page.locator('.rich-text div', { hasText: 'Overlay' });
	await expect(echoed).toHaveAttribute('class', 'rt-fixed rt-inset-0 rt-z-50 alert alert-info');
	await expect(echoed).toHaveCSS('position', 'static');
	await expect(page.locator('#task-result')).toHaveCount(0);
});

/** Builds a tgz from members (`size` zeros when no content is given). */
async function tgz(members: { name: string; mode: number; type?: 'directory'; data?: string; size?: number }[]) {
	const p = pack();
	for (const { name, mode, type, data, size } of members)
		if (type) p.entry({ name, mode, type });
		else p.entry({ name, mode }, data ?? Buffer.alloc(size ?? 0));
	p.finalize();
	const chunks: Buffer[] = [];
	for await (const chunk of p) chunks.push(chunk as Buffer);
	return gzipSync(Buffer.concat(chunks));
}

test('CSTU-13 grader archives are exported with plain permissions and size limits', async ({ page, loginAs }) => {
	const c = await course('modes');
	const archive = await putFile(
		await tgz([
			{ name: 'run.sh', mode: 0o4777, data: 'echo ok' },
			{ name: 'dir', mode: 0o1777, type: 'directory' },
			// 40 MB of zeros (a few kB compressed): larger than one member may be.
			{ name: 'big.bin', mode: 0o644, size: 40 << 20 },
			{ name: 'after.txt', mode: 0o644, data: 'after' }
		])
	);
	const s = await submission(c, { archive });
	await loginAs('e2e_tutor');
	const res = await page.request.get(`/admin/${c}/submissions/submissions.tgz?submission=${s}`);
	const members: Record<string, number> = {};
	const tar = extract();
	Readable.from([gunzipSync(await res.body())]).pipe(tar);
	for await (const entry of tar) {
		members[entry.header.name] = entry.header.mode ?? 0;
		entry.resume();
	}
	expect(members).toEqual({ 'submission.test': 0o644, archive: 0o755, 'archive/run.sh': 0o644, 'archive/dir': 0o755 });
});

test('CSTU-11/13/14 the page size is capped and too large archives or replays are refused', async ({
	page,
	loginAs
}) => {
	const c = await course('limit');
	const input = await putFile(BSON.serialize({ answer: '1', '@lang': 'en' }));
	const date = Date.now();
	await withDb((db) =>
		db.collection('submissions').insertMany(
			Array.from({ length: 10_001 }, (_, i) => ({
				courseid: c,
				// One submission of another task (narrower selection below).
				taskid: i ? 'answer' : '02_courses',
				username: ['e2e_student1'],
				input,
				status: 'done',
				submitted_on: new Date(date - i * 1000),
				grade: new Double(0),
				result: 'failed'
			}))
		)
	);
	const message = 'The selection contains 10001 submissions, more than the 10000 allowed: narrow it with the filters.';
	await loginAs('e2e_admin');
	// At most 500 rows per page, whatever the requested limit.
	await page.goto(`/admin/${c}/submissions?limit=100000`);
	await expect(page.getByRole('row')).toHaveCount(501);
	// Replay of the whole selection: refused with the message (toast).
	await page.locator('summary', { hasText: 'Whole selection' }).click();
	await page.getByRole('button', { name: 'Replay current selection' }).click();
	await expect(page.getByText(message).first()).toBeVisible();
	await expect(
		withDb((db) => db.collection('submissions').countDocuments({ courseid: c, status: 'waiting' }))
	).resolves.toBe(0);
	// The archive of the whole selection: an error page with the message instead of a file.
	await page.goto(`/admin/${c}/submissions`);
	await page.locator('summary', { hasText: 'Whole selection' }).click();
	await page.getByRole('button', { name: 'Download archive' }).click();
	await expect(page.getByText(message)).toBeVisible();
	// The CSV export (a few fields, streamed) allows more submissions; a narrower archive is exported.
	const csv = await page.request.get(`/admin/${c}/submissions/submissions.csv`);
	expect((await csv.text()).trim().split('\r\n')).toHaveLength(10_002);
	const tgz = await page.request.get(`/admin/${c}/submissions/submissions.tgz?tasks=02_courses`);
	expect([tgz.status(), tgz.headers()['content-type']]).toEqual([200, 'application/x-gzip']);
});
