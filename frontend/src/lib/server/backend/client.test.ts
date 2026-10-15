/**
 * Unit tests of the backend ZeroMQ client, using an in-memory fake DEALER socket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encode, decode } from '@msgpack/msgpack';
import { BackendClient, type DealerLike, type JobResult, type NewJob } from './client.js';

/** In-memory socket: records sent messages and lets tests push incoming ones. */
class FakeSocket implements DealerLike {
	sent: Record<string, unknown>[] = [];
	connected: string | null = null;
	closed = false;
	failSend = false;
	private waiters: ((f: Uint8Array[]) => void)[] = [];
	private rejecters: ((e: Error) => void)[] = [];
	private inbox: Uint8Array[][] = [];
	connect(a: string) {
		this.connected = a;
	}
	disconnect() {
		this.connected = null;
	}
	async send(frame: Uint8Array) {
		if (this.failSend) throw new Error('send failed');
		this.sent.push(decode(frame) as Record<string, unknown>);
	}
	receive(): Promise<Uint8Array[]> {
		const next = this.inbox.shift();
		if (next) return Promise.resolve(next);
		return new Promise((res, rej) => {
			this.waiters.push(res);
			this.rejecters.push(rej);
		});
	}
	close() {
		this.closed = true;
		this.rejecters.forEach((r) => r(new Error('closed')));
	}
	/** Simulates a message coming from the backend. */
	push(msg: Record<string, unknown> | Uint8Array) {
		const frame = [msg instanceof Uint8Array ? msg : encode(msg)];
		const w = this.waiters.shift();
		this.rejecters.shift();
		if (w) w(frame);
		else this.inbox.push(frame);
	}
	types() {
		return this.sent.map((m) => m['@type']);
	}
}

const flush = () => new Promise((r) => setImmediate(r));

const job = (over: Partial<NewJob> = {}): NewJob => ({
	priority: 0,
	courseId: 'c',
	taskId: 't',
	problems: { p: { type: 'code' } },
	input: { p: 'print(1)' },
	environmentType: 'docker',
	environment: 'default',
	environmentParameters: { limits: { time: 10 } },
	debug: false,
	launcher: 'test',
	...over
});

describe('BackendClient', () => {
	let sockets: FakeSocket[];
	let client: BackendClient;

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
		sockets = [];
		client = new BackendClient('tcp://backend:2000', {
			socketFactory: () => {
				const s = new FakeSocket();
				sockets.push(s);
				return s;
			}
		});
		client.start();
	});
	afterEach(() => {
		client.close();
		vi.useRealTimers();
	});

	it('says hello on connection and stores environments', async () => {
		await flush();
		expect(sockets[0].connected).toBe('tcp://backend:2000');
		expect(sockets[0].sent[0]).toEqual({ '@type': 'ClientHello', name: 'svelte-frontend' });
		sockets[0].push({ '@type': 'BackendUpdateEnvironments', available_environments: { docker: ['default'] } });
		await flush();
		expect(client.environments).toEqual({ docker: ['default'] });
	});

	it('sends a ClientNewJob with the legacy field names and reports the result', async () => {
		sockets[0].push({ '@type': 'BackendUpdateEnvironments', available_environments: { docker: ['default'] } });
		await flush();
		const results: JobResult[] = [];
		const ssh = vi.fn();
		const started = vi.fn();
		const id = client.newJob(job(), { onDone: (r) => results.push(r), onSsh: ssh, onStarted: started });
		await flush();
		const sent = sockets[0].sent.at(-1)!;
		expect(sent).toMatchObject({
			'@type': 'ClientNewJob',
			job_id: id,
			course_id: 'c',
			task_id: 't',
			task_problems: { p: { type: 'code' } },
			inputdata: { p: 'print(1)' },
			environment_type: 'docker',
			environment: 'default',
			environment_parameters: { limits: { time: 10 } },
			debug: false,
			launcher: 'test',
			priority: 0
		});
		expect(client['jobs'].size).toBe(1);
		sockets[0].push({ '@type': 'BackendJobStarted', job_id: id });
		sockets[0].push({ '@type': 'BackendJobStarted', job_id: 'unknown' });
		sockets[0].push({
			'@type': 'BackendJobDone',
			job_id: id,
			result: ['success', 'Well done'],
			grade: 100,
			problems: { p: ['success', 'ok'] },
			tests: {},
			custom: { a: 1 },
			state: 's',
			archive: new Uint8Array([1, 2]),
			stdout: 'out',
			stderr: ''
		});
		await flush();
		expect(started).toHaveBeenCalledOnce();
		expect(ssh).toHaveBeenCalledWith({ host: null, port: null, user: null, password: null });
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			result: ['success', 'Well done'],
			grade: 100,
			custom: { a: 1 },
			state: 's',
			stdout: 'out'
		});
		expect(results[0].archive).toEqual(new Uint8Array([1, 2]));
		expect(client['jobs'].size).toBe(0);
	});

	it('fills defaults for missing fields of BackendJobDone and ignores unknown jobs', async () => {
		sockets[0].push({ '@type': 'BackendUpdateEnvironments', available_environments: { docker: ['default'] } });
		await flush();
		const onDone = vi.fn();
		const id = client.newJob(job(), { onDone });
		sockets[0].push({ '@type': 'BackendJobDone', job_id: 'other' });
		sockets[0].push({ '@type': 'BackendJobDone', job_id: id, result: ['failed', ''] });
		await flush();
		expect(onDone).toHaveBeenCalledWith({
			result: ['failed', ''],
			grade: 0,
			problems: {},
			tests: {},
			custom: {},
			state: '',
			archive: null,
			stdout: null,
			stderr: null
		});
	});

	it('forwards SSH debug credentials only once', async () => {
		sockets[0].push({ '@type': 'BackendUpdateEnvironments', available_environments: { docker: ['default'] } });
		await flush();
		const onSsh = vi.fn();
		const id = client.newJob(job({ debug: 'ssh' }), { onDone: vi.fn(), onSsh });
		sockets[0].push({ '@type': 'BackendJobSSHDebug', job_id: id, host: 'h', port: 22, user: 'worker', password: 'pw' });
		sockets[0].push({ '@type': 'BackendJobDone', job_id: id, result: ['success', ''] });
		await flush();
		expect(onSsh).toHaveBeenCalledTimes(1);
		expect(onSsh).toHaveBeenCalledWith({ host: 'h', port: 22, user: 'worker', password: 'pw' });
	});

	it('refuses jobs whose environment is not available', () => {
		const onDone = vi.fn();
		const onSsh = vi.fn();
		expect(client.newJob(job(), { onDone, onSsh })).toBeNull();
		expect(onDone.mock.calls[0][0].result).toEqual(['crash', 'Environment not available.']);
		expect(onSsh).toHaveBeenCalledOnce();
	});

	it('refuses ssh debug jobs without ssh callback', () => {
		const onDone = vi.fn();
		expect(client.newJob(job({ debug: 'ssh' }), { onDone })).toBeNull();
		expect(onDone.mock.calls[0][0].result).toEqual(['crash', 'SSH callback not set.']);
	});

	it('accepts course-less jobs without checking environments', async () => {
		const id = client.newJob(job({ courseId: null, taskId: null }), { onDone: vi.fn() });
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		await flush();
		expect(sockets[0].sent.at(-1)).toMatchObject({ '@type': 'ClientNewJob', course_id: null });
	});

	it('sends kill requests', async () => {
		client.killJob('abc');
		await flush();
		expect(sockets[0].sent.at(-1)).toEqual({ '@type': 'ClientKillJob', job_id: 'abc' });
	});

	it('computes the queue position of jobs', async () => {
		vi.setSystemTime(1000_000);
		sockets[0].push({
			'@type': 'BackendGetQueue',
			jobs_running: [
				['r1', true, 'agent', 'c/t', 'me', 990, 30],
				['r2', false, 'agent', 'c/t', 'me', 990, -1]
			],
			jobs_waiting: [
				['w1', true, 'c/t', 'me', 20],
				['w2', true, 'c/t', 'me', -1],
				['w3', true, 'c/t', 'me', 5]
			]
		});
		await flush();
		expect(client.queue?.running).toHaveLength(2);
		expect(client.jobQueueInfo('r1')).toEqual([-1, 20]);
		expect(client.jobQueueInfo('r2')).toEqual([-1, 0]);
		expect(client.jobQueueInfo('w1')).toEqual([0, 20]);
		expect(client.jobQueueInfo('w2')).toEqual([1, 20]);
		expect(client.jobQueueInfo('w3')).toEqual([2, 25]);
		expect(client.jobQueueInfo('nope')).toBeUndefined();
		sockets[0].push({ '@type': 'BackendGetQueue' });
		await flush();
		expect(client.queue).toEqual({ running: [], waiting: [] });
	});

	it('pings every second, asks the queue every 10s and reconnects after 10 missed pings', async () => {
		sockets[0].push({ '@type': 'BackendUpdateEnvironments', available_environments: { docker: ['default'] } });
		await flush();
		const onDone = vi.fn();
		client.newJob(job(), { onDone });
		vi.advanceTimersByTime(10_000);
		await flush();
		expect(sockets[0].types().filter((t) => t === 'Ping')).toHaveLength(10);
		expect(sockets[0].types()).toContain('ClientGetQueue');
		// A Pong resets the counter.
		sockets[0].push({ '@type': 'Pong' });
		await flush();
		vi.advanceTimersByTime(11_000);
		expect(sockets).toHaveLength(1);
		vi.advanceTimersByTime(1_000);
		expect(sockets).toHaveLength(2);
		expect(sockets[0].closed).toBe(true);
		expect(onDone.mock.calls[0][0].result).toEqual(['crash', 'Backend unavailable, retry later']);
		await flush();
		expect(sockets[1].sent[0]['@type']).toBe('ClientHello');
		expect(client.environments).toEqual({});
	});

	it('reconnects when the backend answers Unknown', async () => {
		sockets[0].push({ '@type': 'Unknown' });
		await flush();
		expect(sockets).toHaveLength(2);
	});

	it('ignores malformed frames and send errors', async () => {
		sockets[0].push(new Uint8Array([0xc1]));
		sockets[0].push(encode([1, 2, 3]));
		await flush();
		sockets[0].failSend = true;
		client.killJob('x');
		await flush();
		expect(sockets).toHaveLength(1);
	});

	it('aborts pending jobs on close and stops receiving', async () => {
		sockets[0].push({ '@type': 'BackendUpdateEnvironments', available_environments: { docker: ['default'] } });
		await flush();
		const onDone = vi.fn();
		const onSsh = vi.fn();
		client.newJob(job(), { onDone, onSsh });
		client.close();
		expect(onDone).toHaveBeenCalledOnce();
		expect(onSsh).toHaveBeenCalledOnce();
		expect(sockets[0].closed).toBe(true);
		client.close(); // idempotent
		expect(sockets).toHaveLength(1);
	});

	it('survives a socket whose disconnect throws', () => {
		sockets[0].disconnect = () => {
			throw new Error('not connected');
		};
		client.close();
		expect(sockets[0].closed).toBe(true);
	});
});
