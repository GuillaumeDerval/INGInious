/**
 * Data generator of the scale suite (`npx jiti perf/seed.ts`, run by
 * `npm run test:perf` before the server starts): generates the large data set described by
 * `SCALE` (perf/setup-data.ts) — course and task folders in perf/.data/tasks and
 * the documents of the `INGInious_perf` database, in the legacy format — then
 * writes the configuration of the measured server. Generation takes a few
 * minutes, so it is skipped when perf/.data/seed.json records the same
 * `SCALE` (delete perf/.data to force it).
 *
 * Data set: `courses` small courses (5 tasks each) and the big course (5,000 tasks
 * in nested sections, every student registered, audiences and groups); 100,000
 * submissions on its first task, 10,000 submissions of the main student on the
 * second one, three submissions with 1/5/15 MB of feedback on the third one.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BSON, GridFSBucket, MongoClient, ObjectId, type Db } from 'mongodb';
import { stringify } from 'yaml';
import { ACTORS, PERF, SCALE, courseName, studentName, taskName } from './setup-data.js';

/** argon2id hash of the password "superadmin" (same as the e2e suite). */
const PASSWORD =
	'argon2id-$argon2id$v=19$m=65536,t=3,p=1$QVNVUEVSU0VDVVJFU0FMVA$NpeSDEsx+FwrIS277T9o/Q4z4Ypicibs3LiLZrftXsBUmBxFnK8FKa45w5q85ewM+dOlzZPMFdAmxpmDVAmLlQ';
/** Number of documents per insertMany call. */
const BATCH = 5_000;

/** Task descriptor (a Python code problem graded by docker: never graded here, submissions are generated). */
function taskYaml(name: string): string {
	return stringify({
		name,
		author: 'Perf',
		context: `Statement of *${name}*.\n\nWrite a function \`f(x)\` returning \`x + 1\`.`,
		environment_type: 'docker',
		environment_id: 'default',
		environment_parameters: { limits: { time: 10, memory: 128, disk: 100 }, run_cmd: '' },
		problems: { answer: { type: 'code', name: 'Answer', header: 'Your code', language: 'python' } }
	});
}

/** Writes a course folder: course.yaml and its task folders. */
function writeCourse(id: string, name: string, toc: unknown, tasks: [string, string][], config: object): void {
	const dir = join(PERF.tasksDir, id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'course.yaml'),
		stringify({
			name,
			admins: [ACTORS.admin],
			tutors: [],
			accessible: true,
			registration: true,
			allow_unregister: true,
			task_dispenser: 'toc',
			dispenser_data: { toc, config }
		})
	);
	for (const [taskid, title] of tasks) {
		mkdirSync(join(dir, taskid), { recursive: true });
		writeFileSync(join(dir, taskid, 'task.yaml'), taskYaml(title));
	}
}

/** Generates the course and task folders. */
function writeTasks(): void {
	rmSync(PERF.tasksDir, { recursive: true, force: true });
	// Small courses: 5 tasks, the last two with a deadline next month (upcoming tasks page).
	const soon = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 19).replace('T', ' ');
	for (let c = 1; c <= SCALE.courses; c++) {
		const tasks: [string, string][] = [1, 2, 3, 4, 5].map((t) => [`t${t}`, `Exercise ${t} of course ${c}`]);
		writeCourse(
			courseName(c),
			`Course ${c}: ${['Algorithms', 'Databases', 'Networks', 'Compilers', 'Security'][c % 5]}`,
			[{ id: 's1', title: 'Exercises', rank: 0, tasks_list: Object.fromEntries(tasks.map(([id], i) => [id, i])) }],
			tasks,
			Object.fromEntries(tasks.map(([id], i) => [id, { accessibility: i >= 3 ? `2020-01-01 00:00:00/${soon}` : true }]))
		);
	}
	// Big course: sections × subsections × tasks.
	const perSub = SCALE.bigTasks / (SCALE.sections * SCALE.subsections);
	const tasks: [string, string][] = [];
	const toc = Array.from({ length: SCALE.sections }, (_, s) => ({
		id: `s${s + 1}`,
		title: `Chapter ${s + 1}`,
		rank: s,
		sections_list: Array.from({ length: SCALE.subsections }, (_, u) => {
			const list: Record<string, number> = {};
			for (let k = 0; k < perSub; k++) {
				const id = taskName(tasks.length + 1);
				tasks.push([id, `Exercise ${s + 1}.${u + 1}.${k + 1}`]);
				list[id] = k;
			}
			return { id: `s${s + 1}_${u + 1}`, title: `Part ${s + 1}.${u + 1}`, rank: u, tasks_list: list };
		})
	}));
	writeCourse(
		ACTORS.bigCourse,
		'Big course (5,000 tasks)',
		toc,
		tasks,
		Object.fromEntries(tasks.map(([id]) => [id, { accessibility: true }]))
	);
}

/** Inserts documents in batches. */
async function insertAll(db: Db, collection: string, docs: Iterable<object>): Promise<void> {
	let batch: object[] = [];
	for (const doc of docs) {
		batch.push(doc);
		if (batch.length === BATCH) {
			await db.collection(collection).insertMany(batch, { ordered: false });
			batch = [];
		}
	}
	if (batch.length) await db.collection(collection).insertMany(batch, { ordered: false });
}

/** Stores a submission input (BSON dict in GridFS, like the frontend). */
async function putInput(db: Db, input: Record<string, unknown>): Promise<ObjectId> {
	const upload = new GridFSBucket(db).openUploadStream('');
	upload.end(Buffer.from(BSON.serialize(input)));
	await new Promise((resolve) => upload.on('finish', resolve));
	return upload.id;
}

/** RST feedback of about `size` bytes: sections, paragraphs, lists and code blocks. */
function bigFeedback(size: number): string {
	const block = [
		'Test results',
		'------------',
		'',
		'The function returned the expected value for **all** the inputs of this series:',
		'',
		...Array.from({ length: 20 }, (_, i) => `- input ${i}: expected ${i + 1}, got ${i + 1}`),
		'',
		'.. code-block:: python',
		'',
		'    def f(x):',
		'        return x + 1',
		'',
		''
	].join('\n');
	return block.repeat(Math.ceil(size / block.length)).slice(0, size);
}

/** Generates the database documents. */
async function writeDatabase(db: Db): Promise<void> {
	await db.dropDatabase();
	const now = Date.now();
	const user = (username: string, realname: string) => ({
		username,
		realname,
		email: `${username}@inginious.local`,
		password: PASSWORD,
		bindings: {},
		language: 'en',
		code_indentation: '4',
		tos_accepted: true
	});
	await insertAll(db, 'users', [
		user(ACTORS.superadmin, 'INGInious superadmin'),
		user(ACTORS.admin, 'Perf Admin'),
		...Array.from({ length: SCALE.students }, (_, i) => user(studentName(i + 1), `Student ${i + 1}`))
	]);
	const students = Array.from({ length: SCALE.students }, (_, i) => studentName(i + 1));
	// Registrations: everyone in the big course, the main student in `registered` small courses.
	await insertAll(db, 'courses', [
		{ _id: ACTORS.bigCourse, students },
		...Array.from({ length: SCALE.registered }, (_, i) => ({ _id: courseName(i + 1), students: [ACTORS.student] }))
	]);
	const perAudience = Math.floor(SCALE.students / SCALE.audiences);
	await insertAll(
		db,
		'audiences',
		Array.from({ length: SCALE.audiences }, (_, a) => ({
			courseid: ACTORS.bigCourse,
			description: `Audience ${a + 1}`,
			students: students.slice(a * perAudience, (a + 1) * perAudience),
			tutors: []
		}))
	);
	const perGroup = Math.floor(SCALE.students / SCALE.groups);
	await insertAll(
		db,
		'groups',
		Array.from({ length: SCALE.groups }, (_, g) => ({
			courseid: ACTORS.bigCourse,
			description: `Group ${g + 1}`,
			size: perGroup,
			students: students.slice(g * perGroup, (g + 1) * perGroup),
			audiences: []
		}))
	);
	// Submissions share a few input files (one GridFS file per distinct answer).
	const inputs = await Promise.all(
		[0, 1, 2, 3].map((k) => putInput(db, { answer: `def f(x):\n    return x + ${k}\n`, '@random': [] }))
	);
	const results = ['success', 'failed', 'error', 'timeout'];
	const submission = (username: string, taskid: string, k: number, at: number) => ({
		courseid: ACTORS.bigCourse,
		taskid,
		username: [username],
		input: inputs[k % 4],
		archive: null,
		status: 'done',
		submitted_on: new Date(at),
		response_type: 'rst',
		grade: k % 4 === 1 ? 100 : (k * 37) % 100,
		custom: {},
		problems: { answer: [results[k % 4], `Feedback of attempt ${k}.`] },
		result: results[k % 4],
		text: `Attempt ${k}: ${results[k % 4]}.`,
		tests: {},
		user_ip: '127.0.0.1'
	});
	await insertAll(
		db,
		'submissions',
		(function* () {
			for (let k = 0; k < SCALE.submissionsOnTask; k++)
				yield submission(students[k % SCALE.students], taskName(1), k, now - (SCALE.submissionsOnTask - k) * 60_000);
			for (let k = 0; k < SCALE.submissionsOfStudent; k++)
				yield submission(ACTORS.student, taskName(2), k, now - (SCALE.submissionsOfStudent - k) * 60_000);
		})()
	);
	for (const [k, size] of SCALE.feedbackSizes.entries())
		await db.collection('submissions').insertOne({
			...submission(ACTORS.student, taskName(3), 1, now - (3 - k) * 3600_000),
			text: bigFeedback(size),
			stdout: 'x'.repeat(Math.min(size / 10, 500_000))
		});
	// Grading status: every student tried the first `triedTasks` tasks of the big course.
	await insertAll(
		db,
		'user_tasks',
		(function* () {
			for (const [s, username] of students.entries())
				for (let t = 1; t <= SCALE.triedTasks; t++)
					yield {
						courseid: ACTORS.bigCourse,
						taskid: taskName(t),
						username,
						grade: (s * 7 + t * 13) % 101,
						submissionid: null,
						succeeded: (s + t) % 3 === 0,
						tried: 1 + ((s + t) % 5),
						random: [],
						tokens: { amount: 0, date: new Date(now) },
						state: ''
					};
		})()
	);
	// Indexes created by the frontend at startup are created by the app itself (lib/server/db).
	const created = await db.collection('submissions').countDocuments();
	console.log(`[perf] seeded ${created} submissions`);
}

/**
 * Generates the data set if needed. Sessions created by the runs are left to the
 * TTL index (they expire after one hour): runs with different PERF_IDs share the data.
 */
async function seed(): Promise<void> {
	mkdirSync(PERF.dataDir, { recursive: true });
	const marker = join(PERF.dataDir, 'seed.json');
	const wanted = JSON.stringify(SCALE);
	if (!existsSync(marker) || readFileSync(marker, 'utf8') !== wanted || !existsSync(PERF.tasksDir)) {
		const start = Date.now();
		writeTasks();
		const client = await MongoClient.connect(PERF.mongoUrl);
		try {
			await writeDatabase(client.db(PERF.database));
		} finally {
			await client.close();
		}
		writeFileSync(marker, wanted);
		console.log(`[perf] data set generated in ${Math.round((Date.now() - start) / 1000)} s`);
	}
}

await seed();
