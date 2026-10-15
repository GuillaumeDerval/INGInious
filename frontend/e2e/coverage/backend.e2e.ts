/**
 * Coverage-driven integration tests of the backend client and of the job life cycle
 * against a FAKE backend: an extra server of the build is connected to a ZeroMQ ROUTER
 * of this test process (never to the real backend, which must not receive anything
 * malformed), which answers like `inginious-backend` but on demand: queue snapshots
 * placing the job anywhere, jobs done without the optional fields, unknown jobs,
 * malformed frames, `Unknown` (backend restart) and unanswered pings (reconnection).
 */
import { Router } from 'zeromq';
import { encode, decode } from '@msgpack/msgpack';
import { ObjectId } from 'mongodb';
import { expect, installCourse, test, withDb } from '../fixtures.js';
import { E2E, E2E_ID } from '../setup-data.js';
import { appUrl, sessionCookie, startApp, uid, type App } from '../auth/helpers.js';

/** Index of the extra server of this file (see `startApp`). */
const INDEX = 10;
/** Port of the fake backend (distinct per run, like the extra servers). */
const PORT = 40000 + (E2E.port - 4173) * 20 + INDEX;

/** A message of the backend protocol. */
type Message = Record<string, unknown>;

/** Fake `inginious-backend` client socket. */
class FakeBackend {
	readonly router = new Router({ linger: 0 });
	/** Identity of the last connected client (the app reconnects with a new one). */
	private client: Buffer | null = null;
	/** Number of ClientHello received (one per (re)connection). */
	hellos = 0;
	/** Whether pings are answered (false: the app reconnects after 10 missed pings). */
	pong = true;
	/** Jobs received (ClientNewJob), in order. */
	readonly jobs: Message[] = [];
	/** When set, every new job is immediately answered with this result. */
	autoDone: Message | null = null;

	/** Binds the socket and serves the app until closed. */
	async start(): Promise<void> {
		await this.router.bind(`tcp://127.0.0.1:${PORT}`);
		void this.serve();
	}

	/** Receive loop: answers the protocol messages of the app. */
	private async serve(): Promise<void> {
		try {
			for await (const [id, frame] of this.router) {
				this.client = id;
				const msg = decode(frame) as Message;
				if (msg['@type'] === 'ClientHello') {
					this.hellos++;
					await this.send({
						'@type': 'BackendUpdateEnvironments',
						available_environments: { docker: ['default'], mcq: ['mcq'] }
					});
				} else if (msg['@type'] === 'Ping' && this.pong) await this.send({ '@type': 'Pong' });
				else if (msg['@type'] === 'ClientNewJob') {
					this.jobs.push(msg);
					if (this.autoDone) await this.send({ '@type': 'BackendJobDone', job_id: msg.job_id, ...this.autoDone });
				}
			}
		} catch {
			/* socket closed */
		}
	}

	/** Sends a message (or raw bytes) to the app. */
	async send(msg: Message | Uint8Array): Promise<void> {
		await this.router.send([this.client!, msg instanceof Uint8Array ? msg : encode(msg)]);
	}

	/** Id of the last job received. */
	lastJob(): string {
		return String(this.jobs.at(-1)!.job_id);
	}
}

const backend = new FakeBackend();
let app: App;
let course: string;
const url = appUrl(INDEX);

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: url });

test.beforeAll(async () => {
	await backend.start();
	course = installCourse('cov_site', `e2e_covfake_${uid()}`);
	await withDb((db) =>
		db
			.collection('courses')
			.updateOne({ _id: course as never }, { $set: { students: ['e2e_student1'] } }, { upsert: true })
	);
	app = await startApp(INDEX, {
		backend: `tcp://127.0.0.1:${PORT}`,
		// A new repository: the plugin creates it (git init) at startup.
		plugins: [
			{
				plugin_module: 'inginious.frontend.plugins.git_repo',
				repo_directory: `e2e/.generated/git-fake-${E2E_ID}-${uid()}`
			}
		]
	});
	await expect.poll(() => backend.hellos).toBeGreaterThan(0);
});

test.afterAll(async () => {
	await app?.stop();
	backend.router.close();
});

/** Session cookie of `username` on the extra server. */
async function login(context: import('@playwright/test').BrowserContext, username: string) {
	const user = await withDb((db) => db.collection('users').findOne({ username }));
	await context.addCookies([await sessionCookie(user as never, url)]);
}

/** Feedback text of a submission (task page `check` action). */
async function check(request: import('@playwright/test').APIRequestContext, taskid: string, id: string) {
	const response = await request.post(`/course/${course}/${taskid}`, {
		form: { '@action': 'check', submissionid: id },
		headers: { origin: url }
	});
	return (await response.json()).submission as { status: string; text: string; grade: number };
}

test('TASK-09 SITE-11 queue positions, job results without optional fields and backend reconnections', async ({
	page,
	context
}) => {
	test.setTimeout(120_000);
	await login(context, 'e2e_student1');
	const created = await page.request.post(`/api/v0/courses/${course}/tasks/code1/submissions`, {
		form: { answer: '42' },
		headers: { origin: url }
	});
	const { submissionid } = await created.json();
	await expect.poll(() => backend.jobs.length).toBe(1);
	const job = backend.lastJob();
	expect(backend.jobs[0]).toMatchObject({ course_id: course, task_id: 'code1', debug: false });
	// Not yet in a queue snapshot.
	expect((await check(page.request, 'code1', submissionid)).text).toContain('Your submission has been sent');
	// Queue snapshots: one job before it, then next, then running without time limit.
	const now = Date.now() / 1000;
	const queue = async (running: unknown[], waiting: unknown[], text: string) => {
		await backend.send({ '@type': 'BackendGetQueue', jobs_running: running, jobs_waiting: waiting });
		await expect.poll(async () => (await check(page.request, 'code1', submissionid)).text).toContain(text);
	};
	const other = (id: string) => [id, false, 'x/y', 'other', 30];
	await queue([], [other('o1'), other('o2'), [job, true, `${course}/code1`, 'me', -1]], 'There are 2 tasks in front');
	await queue([], [other('o1'), [job, true, `${course}/code1`, 'me', -1]], 'one task in front');
	await queue([], [[job, true, `${course}/code1`, 'me', -1]], 'You are next');
	await queue([[job, true, 'agent', `${course}/code1`, 'me', now, -1]], [], 'almost done');
	// The job queue page shows the running job without timeout.
	await page.goto('/queue');
	await expect(page.locator(`tr[title="${job}"]`)).toContainText('No timeout set');
	// Malformed frames, a non-map message, events of unknown jobs are ignored.
	await backend.send(new Uint8Array([0xc1]));
	await backend.send(encode([1, 2, 3]));
	await backend.send({ '@type': 'BackendJobDone', job_id: 'unknown-job', result: ['success', ''] });
	await backend.send({ '@type': 'BackendJobStarted', job_id: job });
	// Done without grade, state, problems (null), output; an empty archive.
	await backend.send({
		'@type': 'BackendJobDone',
		job_id: job,
		result: ['success', 'Well done'],
		problems: null,
		tests: {},
		custom: {},
		archive: new Uint8Array(0)
	});
	await expect.poll(async () => (await check(page.request, 'code1', submissionid)).status).toBe('done');
	const stored = await withDb((db) => db.collection('submissions').findOne({ _id: new ObjectId(submissionid) }));
	expect(stored).toMatchObject({ result: 'success', grade: 0, state: '' });
	expect(stored!.archive).toBeInstanceOf(ObjectId);
	// A result too large for MongoDB (stored outside of any request: untranslated message).
	const big = await page.request.post(`/api/v0/courses/${course}/tasks/code1/submissions`, {
		form: { answer: '43' },
		headers: { origin: url }
	});
	const bigId = (await big.json()).submissionid;
	await expect.poll(() => backend.jobs.length).toBe(2);
	await backend.send({
		'@type': 'BackendJobDone',
		job_id: backend.lastJob(),
		result: ['success', 'Too much'],
		grade: 100,
		problems: {},
		tests: {},
		custom: {},
		// Outputs are truncated when stored, the state is not: the document is too large.
		state: 'x'.repeat(17_000_000)
	});
	await expect
		.poll(async () => (await check(page.request, 'code1', bigId)).text, { timeout: 30_000 })
		.toContain('Maximum submission size exceeded');
	// A restarted backend answers Unknown: the app reconnects (new hello).
	const hellos = backend.hellos;
	await backend.send({ '@type': 'Unknown' });
	await expect.poll(() => backend.hellos).toBe(hellos + 1);
	// Unanswered pings: the app reconnects after 10 missed pings (about 12 seconds).
	backend.pong = false;
	await expect.poll(() => backend.hellos, { timeout: 30_000 }).toBe(hellos + 2);
	backend.pong = true;
});

test('CSTU-14 in-place replay of a submission with an archive; replay as a tutor', async ({ page, context }) => {
	const sub = await withDb((db) =>
		db.collection('submissions').findOne({ courseid: course, taskid: 'code1', username: ['e2e_student1'] })
	);
	// A newer evaluated submission without state: replays recompute the evaluated submission from it.
	await withDb((db) =>
		db.collection('submissions').insertOne({
			courseid: course,
			taskid: 'code1',
			username: ['e2e_student1'],
			status: 'done',
			result: 'success',
			grade: 100,
			submitted_on: new Date(Date.now() + 60_000),
			input: sub!.input
		})
	);
	backend.autoDone = {
		result: ['failed', 'Replayed'],
		grade: 10,
		state: 'replayed',
		problems: {},
		tests: {},
		custom: {}
	};
	await login(context, 'e2e_admin');
	// SITE-11 a kill posted without JavaScript: the page shows the result message.
	const running = [['kill-me', false, 'agent', `${course}/code1`, 'other', Date.now() / 1000, 10]];
	await backend.send({ '@type': 'BackendGetQueue', jobs_running: running, jobs_waiting: [] });
	await expect.poll(async () => (await page.request.get('/queue')).text()).toContain('kill-me');
	await page.goto('/queue');
	await page.evaluate(() => {
		const form = Object.assign(document.createElement('form'), { method: 'POST', action: '?/kill' });
		form.innerHTML = '<input name="jobid" value="kill-me">';
		document.body.append(form);
		form.submit();
	});
	await expect(page.getByText('Kill request sent.')).toBeVisible();
	await page.goto(`/submission/${sub!._id}`);
	await page.getByText('Replay', { exact: true }).click(); // replay actions menu
	await page.getByRole('button', { name: 'Replay submission' }).click();
	await expect
		.poll(() => withDb((db) => db.collection('submissions').findOne({ _id: sub!._id })))
		.toMatchObject({ status: 'done', result: 'failed' });
	const ut = await withDb((db) =>
		db.collection('user_tasks').findOne({ courseid: course, taskid: 'code1', username: 'e2e_student1' })
	);
	expect(ut).toMatchObject({ grade: 100, state: '' });
	// The tutor replays it as his own first attempt.
	await context.clearCookies();
	await login(context, 'e2e_tutor');
	await page.goto(`/submission/${sub!._id}`);
	await page.getByText('Replay', { exact: true }).click(); // replay actions menu
	await page.getByRole('button', { name: /Replay as/ }).click();
	await expect(page).toHaveURL(new RegExp(`/course/${course}/code1`));
	expect(backend.jobs.at(-1)!.inputdata).toMatchObject({ '@username': 'e2e_tutor', '@attempts': '1' });
	backend.autoDone = null;
});

test('TASK-09 TASK-21 CSTU-15 feedback of stored submissions with missing or legacy fields', async ({
	page,
	context
}) => {
	const { input } = (await withDb((db) => db.collection('submissions').findOne({ courseid: course })))!;
	const seed = (fields: Record<string, unknown>) =>
		withDb(async (db) =>
			String(
				(
					await db.collection('submissions').insertOne({
						courseid: course,
						taskid: 'code2',
						username: ['e2e_student1'],
						submitted_on: new Date(),
						input,
						...fields
					})
				).insertedId
			)
		);
	// Waiting without job id (not sent to the backend yet).
	const waiting = await seed({ status: 'waiting' });
	// Done without grade nor problems; legacy string feedback of a problem without result.
	const bare = await seed({ status: 'done', result: 'success' });
	const legacy = await seed({ status: 'done', problems: { answer: 'Legacy *feedback*' } });
	// A long stored text: truncated in the debug dump of admins.
	// A stored text too long to be rendered; a non-string problem feedback.
	const long = await seed({
		status: 'done',
		result: 'failed',
		grade: 50,
		text: 'x'.repeat(200_001),
		problems: { answer: ['failed', 42] }
	});
	await login(context, 'e2e_student1');
	expect((await check(page.request, 'code2', waiting)).text).toContain('Your submission has been sent');
	expect(await check(page.request, 'code2', bare)).toMatchObject({ status: 'done', grade: 0 });
	const old = (await check(page.request, 'code2', legacy)) as unknown as { problems: Record<string, string[]> };
	expect(old.problems.answer[0]).toBe('crash');
	await context.clearCookies();
	await login(context, 'e2e_admin');
	const dumped = (await check(page.request, 'code2', long)) as unknown as { debug: { text: string } };
	expect(dumped.debug.text).toBe(`${'x'.repeat(1000)} <truncated>`);
	expect((dumped as unknown as { problems: Record<string, string[]> }).problems.answer[1]).toContain('42');
	// The staff view of a waiting submission: no download.
	await page.goto(`/submission/${waiting}`);
	await expect(page.getByText('Download full submission')).toHaveCount(0);
});
