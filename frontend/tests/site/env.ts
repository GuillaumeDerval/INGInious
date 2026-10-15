/**
 * Test support of the site area (SITE-*): services with a throw-away database,
 * a temporary tasks directory, a fake backend and fake sessions, plus helpers
 * to write courses/tasks and to build request events.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { stringify } from 'yaml';
import type { RequestEvent } from '@sveltejs/kit';
import { setupCourses, type CoursesEnv } from '../fixtures/courses/setup.js';
import { services, setServices, type Services } from '../../src/lib/server/app.js';
import { ObjectId } from 'mongodb';
import type { CurrentUser } from '../../src/app.d.ts';

/** A prepared site environment. */
export interface SiteEnv extends CoursesEnv {
	/** Fake backend: `newJob` records the jobs (call `done(result)` to complete them). */
	backend: { newJob: ReturnType<typeof vi.fn>; environments: Record<string, string[]> };
	/** Writes a course (and its tasks) in the tasks directory. */
	course: (id: string, content: Record<string, unknown>, tasks?: Record<string, Record<string, unknown>>) => void;
}

/** Installs the services of the site tests. */
export async function siteEnv(): Promise<SiteEnv> {
	const env = await setupCourses({ withDb: true });
	const backend = { newJob: vi.fn(() => 'job-1'), environments: { mcq: ['mcq'], docker: ['default'] } };
	const sessions = {
		rotate: vi.fn(async (s: { doc: { _id: ObjectId }; dirty: boolean }) => {
			s.doc._id = new ObjectId();
			s.dirty = true;
		})
	};
	setServices({ ...services(), backend, sessions } as unknown as Services);
	const course = (
		id: string,
		content: Record<string, unknown>,
		tasks: Record<string, Record<string, unknown>> = {}
	) => {
		mkdirSync(join(env.dir, id), { recursive: true });
		writeFileSync(join(env.dir, id, 'course.yaml'), stringify(content));
		for (const [tid, t] of Object.entries(tasks)) {
			mkdirSync(join(env.dir, id, tid), { recursive: true });
			writeFileSync(join(env.dir, id, tid, 'task.yaml'), stringify(t));
		}
	};
	return { ...env, backend, course };
}

/** A logged-in user for `locals.user`. */
export function user(username: string, superadmin = false): CurrentUser {
	return {
		username,
		realname: username,
		email: `${username}@x.org`,
		language: 'en',
		timezone: 'UTC',
		codeIndentation: '4',
		superadmin
	};
}

/** Builds a request event for `url` (path), with an optional user and body. */
export function event(
	url: string,
	opts: {
		method?: string;
		user?: CurrentUser | null;
		body?: BodyInit;
		headers?: Record<string, string>;
		params?: Record<string, string>;
	} = {}
): RequestEvent {
	const full = new URL(url, 'http://localhost');
	return {
		request: new Request(full, { method: opts.method ?? 'GET', body: opts.body, headers: opts.headers }),
		url: full,
		params: opts.params ?? {},
		locals: {
			user: opts.user ?? null,
			session: { doc: { _id: new ObjectId(), tos_signed: true, is_lti: false }, dirty: false, stored: true },
			lang: 'en'
		},
		getClientAddress: () => '127.0.0.1'
	} as unknown as RequestEvent;
}

/** Simple MCQ task descriptor. */
export const MCQ_TASK = {
	name: 'MCQ',
	author: 'Me',
	environment_type: 'mcq',
	environment_id: 'mcq',
	problems: {
		q: { type: 'match', name: 'Q', header: 'Type yes', answer: 'yes' },
		c: {
			type: 'multiple_choice',
			name: 'C',
			header: 'Pick',
			choices: [{ text: 'A', valid: true, feedback: 'ok' }, { text: 'B' }],
			success_message: 'secret'
		}
	}
};
