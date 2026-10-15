/**
 * Test support of the task area (submission manager, task page): a temporary
 * tasks directory holding a copy of the task_showcase sample course, a throw-away
 * database and a fake backend client recording the jobs.
 */
import { settled } from '../../../src/lib/server/submissions/manager.js';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { services } from '../../../src/lib/server/app.js';
import type { JobCallbacks, JobResult, NewJob } from '../../../src/lib/server/backend/client.js';
import { setupCourses, SAMPLE_COURSES, type CoursesEnv } from '../courses/setup.js';

/** A job received by the fake backend. */
export interface FakeJob {
	id: string;
	job: NewJob;
	cb: JobCallbacks;
}

/** Fake BackendClient: records jobs, can finish them. */
export class FakeBackend {
	jobs: FakeJob[] = [];
	killed: string[] = [];
	environments: Record<string, string[]> = { mcq: ['mcq'], docker: ['default'] };
	queue: { running: unknown[][]; waiting: unknown[][] } | null = null;
	queueInfo = new Map<string, [number, number]>();
	private n = 0;
	/** Records the job; unavailable environments crash synchronously like the real client. */
	newJob(job: NewJob, cb: JobCallbacks): string | null {
		if (!this.environments[job.environmentType]?.includes(job.environment)) {
			cb.onDone(result(['crash', 'Environment not available.']));
			return null;
		}
		const id = `job-${++this.n}`;
		this.jobs.push({ id, job, cb });
		return id;
	}
	killJob(id: string): void {
		this.killed.push(id);
	}
	jobQueueInfo(id: string): [number, number] | undefined {
		return this.queueInfo.get(id);
	}
	/** The last job sent. */
	get last(): FakeJob {
		return this.jobs[this.jobs.length - 1];
	}
}

/** Builds a job result. */
export function result(res: [string, string], extra: Partial<JobResult> = {}): JobResult {
	return {
		result: res,
		grade: res[0] === 'success' ? 100 : 0,
		problems: {},
		tests: {},
		custom: {},
		state: '',
		archive: null,
		stdout: null,
		stderr: null,
		...extra
	};
}

/** Environment of the task tests. */
export interface TaskEnv extends CoursesEnv {
	backend: FakeBackend;
}

/** Installs the showcase course (id `task_showcase`) with a database and a fake backend. */
export async function setupTask(): Promise<TaskEnv> {
	const dir = mkdtempSync(join(tmpdir(), 'inginious-task-'));
	cpSync(join(SAMPLE_COURSES, 'task_showcase'), join(dir, 'task_showcase'), { recursive: true });
	const env = await setupCourses({ withDb: true, tasksDirectory: dir });
	const backend = new FakeBackend();
	Object.assign(services(), { backend });
	Object.assign(services().config, {
		allowedFileExtensions: ['.txt'],
		maxFileSize: 1024 * 1024,
		webterm: 'https://term'
	});
	return { ...env, backend };
}

/** Waits for pending promise callbacks (async completion). */
export const flush = async () => {
	// Let pending microtasks/IO callbacks run, then wait for the stored job results.
	await new Promise((r) => setImmediate(r));
	await settled();
};
