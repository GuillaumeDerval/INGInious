/**
 * Test support for src/lib/server/courses: copies the fixture courses into a
 * temporary tasks directory and installs services (configuration and,
 * optionally, a throw-away MongoDB database).
 */
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setServices, type Services } from '../../../src/lib/server/app.js';
import { createTestDatabase } from '../../../src/lib/server/testing/db.js';
import type { Database } from '../../../src/lib/server/db/index.js';

/** Folder of the fixture courses. */
export const FIXTURES = dirname(fileURLToPath(import.meta.url));
/** Sample courses (copies of the demo courses of the development stack). */
export const SAMPLE_COURSES = join(FIXTURES, '../sample-courses');

/** A prepared environment. */
export interface CoursesEnv {
	dir: string;
	db: Database;
	cleanup: () => Promise<void>;
}

/**
 * Installs services whose tasks directory is a fresh copy of the fixtures
 * (or `tasksDirectory` when given, used read-only).
 */
export async function setupCourses(opts: { withDb?: boolean; tasksDirectory?: string } = {}): Promise<CoursesEnv> {
	const dir = opts.tasksDirectory ?? mkdtempSync(join(tmpdir(), 'inginious-courses-'));
	if (!opts.tasksDirectory) cpSync(FIXTURES, dir, { recursive: true, filter: (src) => !src.endsWith('.ts') });
	const tdb = opts.withDb ? await createTestDatabase() : null;
	setServices({
		config: {
			tasksDirectory: dir,
			superadmins: ['root'],
			allowedFileExtensions: ['.c', '.txt'],
			maxFileSize: 1024,
			isTosDefined: false
		},
		db: tdb?.database
	} as unknown as Services);
	return {
		dir,
		db: tdb?.database as Database,
		cleanup: async () => {
			await tdb?.drop();
			if (!opts.tasksDirectory) rmSync(dir, { recursive: true, force: true });
			setServices(null);
		}
	};
}

/** Compiles a GNU .mo catalog (little or big endian) from msgid -> msgstr pairs. */
export function compileMo(entries: Record<string, string>, bigEndian = false): Buffer {
	const ids = Object.keys(entries).sort();
	const n = ids.length;
	const header = Buffer.alloc(28 + 16 * n);
	const w = (v: number, off: number) => (bigEndian ? header.writeUInt32BE(v, off) : header.writeUInt32LE(v, off));
	const strings: Buffer[] = [];
	let offset = header.length;
	const add = (s: string, table: number, i: number) => {
		const b = Buffer.from(s, 'utf8');
		w(b.length, table + 8 * i);
		w(offset, table + 8 * i + 4);
		strings.push(b, Buffer.from([0]));
		offset += b.length + 1;
	};
	w(0x950412de, 0);
	w(0, 4);
	w(n, 8);
	w(28, 12);
	w(28 + 8 * n, 16);
	ids.forEach((id, i) => add(id, 28, i));
	ids.forEach((id, i) => add(entries[id], 28 + 8 * n, i));
	return Buffer.concat([header, ...strings]);
}
