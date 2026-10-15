/**
 * ZeroMQ client for the (unchanged) INGInious Python backend.
 *
 * This is a TypeScript port of `legacy/inginious/client/client.py` and
 * `_zeromq_client.py` (the "BetterParanoidPirateClient"):
 *  - a DEALER socket connected to the backend's client ROUTER (e.g. tcp://backend:2000);
 *  - every frame is a msgpack map whose "@type" key names the Python dataclass
 *    of `inginious/common/messages.py` (see docs/reference/backend-protocol.md);
 *  - a Ping is sent every second; after 10 unanswered pings (or an `Unknown`
 *    message, sent by a restarted backend) the client reconnects and aborts every
 *    pending job with a "crash" result, exactly like the legacy client;
 *  - the job queue snapshot is refreshed every 10 seconds (ClientGetQueue).
 */
import { encode, decode } from '@msgpack/msgpack';
import { randomUUID } from 'node:crypto';

/** A (result, feedback) pair, as produced by the grading containers. */
export type SPResult = [string, string];

/** Content of a BackendJobDone message (the result of a grading job). */
export interface JobResult {
	result: SPResult;
	grade: number;
	problems: Record<string, SPResult>;
	tests: Record<string, unknown>;
	custom: Record<string, unknown>;
	state: string;
	archive: Uint8Array | null;
	stdout: string | null;
	stderr: string | null;
}

/** SSH debug credentials (all null when no SSH session could be opened). */
export interface SshInfo {
	host: string | null;
	port: number | null;
	user: string | null;
	password: string | null;
}

/** Description of a job to submit (fields of ClientNewJob, minus the job id). */
export interface NewJob {
	priority: number;
	courseId: string | null;
	taskId: string | null;
	/** Problems dictionary of the task (task.yaml `problems`), null/{} for course-less jobs. */
	problems: Record<string, unknown>;
	/** Student input; file uploads are `{ filename, value: Uint8Array }`. */
	input: Record<string, unknown>;
	environmentType: string;
	environment: string;
	environmentParameters: Record<string, unknown>;
	/** false, true (more output) or "ssh" (remote SSH debug session). */
	debug: boolean | 'ssh';
	/** Free-form name of who launched the job (logging only). */
	launcher: string;
}

/** Callbacks of a job; `onDone` is always called exactly once. */
export interface JobCallbacks {
	onDone: (result: JobResult) => void;
	onSsh?: (info: SshInfo) => void;
	onStarted?: () => void;
}

/** Running job entry of the queue: [jobId, isOurs, agent, info, launcher, startedAt, maxTime]. */
export type RunningJob = [string, boolean, string, string | null, string, number, number];
/** Waiting job entry of the queue: [jobId, isOurs, info, launcher, maxTime]. */
export type WaitingJob = [string, boolean, string | null, string, number];

/** Minimal socket interface (implemented by zeromq's Dealer; mocked in tests). */
export interface DealerLike {
	connect(address: string): void;
	disconnect(address: string): void;
	send(frame: Uint8Array): Promise<void>;
	receive(): Promise<Uint8Array[]>;
	close(): void;
}

/** Options of the client (intervals are configurable for tests). */
export interface BackendClientOptions {
	/** Creates a new DEALER socket. */
	socketFactory: () => DealerLike;
	/** Name sent in ClientHello (informational). */
	name?: string;
	pingIntervalMs?: number;
	maxMissedPings?: number;
	queueUpdateIntervalMs?: number;
}

/** SSH information given when no SSH session was opened. */
const NO_SSH: SshInfo = { host: null, port: null, user: null, password: null };

/**
 * Crash result of a job that could not be sent or completed (by default: the
 * result reported for every pending job when the backend becomes unreachable).
 */
function crash(message = 'Backend unavailable, retry later'): JobResult {
	const empty = { problems: {}, tests: {}, custom: {}, state: '', archive: null, stdout: '', stderr: '' };
	return { result: ['crash', message], grade: 0, ...empty };
}

/** Wraps a callback so that it fires at most once (legacy `_callable_once`). */
function callOnce<A>(fn: (arg: A) => void): (arg: A) => void {
	let called = false;
	return (arg) => {
		if (!called) {
			called = true;
			fn(arg);
		}
	};
}

/** Converts a decoded msgpack value to a plain record (defensive). */
function asRecord(v: unknown): Record<string, unknown> {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Client of the INGInious backend. One instance is shared by the whole server
 * (see `backend/index.ts`).
 */
export class BackendClient {
	/** Available environments, by environment type (e.g. {docker: ['default'], mcq: ['mcq']}). */
	environments: Record<string, string[]> = {};
	/** Last job queue snapshot received from the backend, if any. */
	queue: { running: RunningJob[]; waiting: WaitingJob[] } | null = null;

	/** Socket of the current connection (set by `start`; kept, closed, after `close`). */
	private socket!: DealerLike;
	private readonly jobs = new Map<string, JobCallbacks>();
	private queueInfo = new Map<string, [number, number]>();
	private missedPings = 0;
	private timers: NodeJS.Timeout[] = [];
	private generation = 0;
	private readonly opts: Required<BackendClientOptions>;

	/**
	 * @param address ZeroMQ address of the backend client socket (e.g. "tcp://localhost:2000").
	 * @param options socket factory and timing options.
	 */
	constructor(
		readonly address: string,
		options: BackendClientOptions
	) {
		this.opts = {
			name: 'svelte-frontend',
			pingIntervalMs: 1000,
			maxMissedPings: 10,
			queueUpdateIntervalMs: 10_000,
			...options
		};
	}

	/** Connects to the backend and starts the ping, receive and queue-update loops. */
	start(): void {
		const generation = ++this.generation;
		const socket = (this.socket = this.opts.socketFactory());
		socket.connect(this.address);
		this.environments = {};
		this.missedPings = 0;
		void this.send({ '@type': 'ClientHello', name: this.opts.name });
		void this.receiveLoop(socket, generation);
		this.timers.push(
			setInterval(() => this.ping(), this.opts.pingIntervalMs),
			setInterval(() => void this.send({ '@type': 'ClientGetQueue' }), this.opts.queueUpdateIntervalMs)
		);
	}

	/** Stops the client; pending jobs are aborted (the receive loop ends and every timer is cleared). */
	close(): void {
		this.stop();
	}

	/**
	 * Submits a new job. Mirrors `Client.new_job`: when the environment is not
	 * available, the job is immediately reported as crashed and null is returned.
	 * @returns the client-side job id, or null if the job could not be sent.
	 */
	newJob(job: NewJob, callbacks: JobCallbacks): string | null {
		const jobId = randomUUID();
		const cb = {
			...callbacks,
			onSsh: callbacks.onSsh && callOnce(callbacks.onSsh),
			onDone: callOnce(callbacks.onDone)
		};
		if (job.debug === 'ssh' && !callbacks.onSsh) {
			cb.onDone(crash('SSH callback not set.'));
			return null;
		}
		if (job.courseId && job.taskId && !this.environments[job.environmentType]?.includes(job.environment)) {
			cb.onSsh?.(NO_SSH);
			cb.onDone(crash('Environment not available.'));
			return null;
		}
		this.jobs.set(jobId, cb);
		void this.send({
			'@type': 'ClientNewJob',
			job_id: jobId,
			priority: job.priority,
			course_id: job.courseId,
			task_id: job.taskId,
			task_problems: job.problems,
			inputdata: job.input,
			environment_type: job.environmentType,
			environment: job.environment,
			environment_parameters: job.environmentParameters,
			debug: job.debug,
			launcher: job.launcher
		});
		return jobId;
	}

	/** Asks the backend to kill a running job (its onDone will still be called). */
	killJob(jobId: string): void {
		void this.send({ '@type': 'ClientKillJob', job_id: jobId });
	}

	/**
	 * Position of a job in the backend queue.
	 * @returns [jobs before it (-1 when running), approx. remaining seconds] or undefined.
	 */
	jobQueueInfo(jobId: string): [number, number] | undefined {
		return this.queueInfo.get(jobId);
	}

	/** Encodes and sends one message; send errors are ignored (the ping loop will reconnect). */
	private async send(message: Record<string, unknown>): Promise<void> {
		try {
			await this.socket.send(encode(message));
		} catch {
			/* the heartbeat detects broken connections */
		}
	}

	/** Sends a ping, or reconnects after too many unanswered pings. */
	private ping(): void {
		if (this.missedPings > this.opts.maxMissedPings) {
			this.reconnect();
			return;
		}
		this.missedPings++;
		void this.send({ '@type': 'Ping' });
	}

	/** Receives and dispatches messages until the socket is replaced or closed. */
	private async receiveLoop(socket: DealerLike, generation: number): Promise<void> {
		while (generation === this.generation) {
			let frames: Uint8Array[];
			try {
				frames = await socket.receive();
			} catch {
				return; // socket closed
			}
			if (generation !== this.generation) return;
			this.missedPings = 0;
			try {
				this.dispatch(asRecord(decode(frames[0])));
			} catch {
				/* malformed message: ignored, like the legacy client logging it */
			}
		}
	}

	/** Handles one decoded message from the backend. */
	private dispatch(msg: Record<string, unknown>): void {
		const jobId = String(msg.job_id ?? '');
		switch (msg['@type']) {
			case 'BackendUpdateEnvironments':
				this.environments = asRecord(msg.available_environments) as Record<string, string[]>;
				break;
			case 'BackendGetQueue':
				this.updateQueue(msg.jobs_running as RunningJob[], msg.jobs_waiting as WaitingJob[]);
				break;
			case 'BackendJobStarted':
				this.jobs.get(jobId)?.onStarted?.();
				break;
			case 'BackendJobSSHDebug':
				this.jobs.get(jobId)?.onSsh?.({
					host: msg.host as string,
					port: msg.port as number,
					user: msg.user as string,
					password: msg.password as string
				});
				break;
			case 'BackendJobDone': {
				const cb = this.jobs.get(jobId);
				if (!cb) break;
				this.jobs.delete(jobId);
				// The legacy client always calls the ssh callback once, with nulls if unused.
				cb.onSsh?.(NO_SSH);
				cb.onDone({
					result: msg.result as SPResult,
					grade: Number(msg.grade ?? 0),
					problems: asRecord(msg.problems) as Record<string, SPResult>,
					tests: asRecord(msg.tests),
					custom: asRecord(msg.custom),
					state: String(msg.state ?? ''),
					archive: (msg.archive as Uint8Array | null) ?? null,
					stdout: (msg.stdout as string | null) ?? null,
					stderr: (msg.stderr as string | null) ?? null
				});
				break;
			}
			case 'Unknown': // the backend restarted and forgot us
				this.reconnect();
				break;
		}
	}

	/** Stores the queue snapshot and precomputes per-job wait estimates (legacy algorithm). */
	private updateQueue(running: RunningJob[] = [], waiting: WaitingJob[] = []): void {
		this.queue = { running, waiting };
		const info = new Map<string, [number, number]>();
		const now = Date.now() / 1000;
		for (const [id, , , , , startedAt, maxTime] of running) {
			info.set(id, [-1, maxTime > 0 ? Math.max(0, startedAt + maxTime - now) : 0]);
		}
		let wait = 0;
		waiting.forEach(([id, , , , maxTime], position) => {
			if (maxTime > 0) wait += maxTime;
			info.set(id, [position, wait]);
		});
		this.queueInfo = info;
	}

	/** Tears down the socket and timers, aborting every pending job. */
	private stop(): void {
		this.generation++;
		this.timers.forEach(clearInterval);
		this.timers = [];
		const pending = [...this.jobs.values()];
		this.jobs.clear();
		for (const cb of pending) {
			cb.onSsh?.(NO_SSH);
			cb.onDone(crash());
		}
		try {
			this.socket.disconnect(this.address);
		} catch {
			/* already disconnected */
		}
		this.socket.close();
	}

	/**
	 * Restarts the connection from scratch (legacy `_reconnect`). Only called from the
	 * ping timer and the receive loop of the current socket, both ended by `close`.
	 */
	private reconnect(): void {
		this.stop();
		this.start();
	}
}
