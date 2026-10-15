/**
 * Document types of the MongoDB collections shared with the legacy INGInious
 * frontend. They mirror the mongoengine models of
 * `legacy/inginious/frontend/models/*.py` field by field: the database format
 * must NOT change (see docs/reference/db-schema.md). Optional fields are the
 * ones mongoengine does not always write.
 */
import type { ObjectId } from 'mongodb';

/** `users` collection (models/user.py). */
export interface UserDoc {
	_id?: ObjectId;
	username: string;
	realname: string;
	email: string;
	/** "argon2id-<PHC string>" (or a legacy hash format), absent for external-only accounts. */
	password?: string | null;
	language: string;
	/** One of "2", "3", "4", "tabs". */
	code_indentation?: string;
	/** auth method id -> [external user id, extra info]. */
	bindings: Record<string, unknown[]>;
	/** LTI bindings: "<courseid>/<consumer key or platform>" -> LTI user id. */
	ltibindings?: Record<string, string>;
	tos_accepted?: boolean;
	apikey?: string | null;
	timezone?: string;
	pinned_courses?: string[];
	/** Activation hash; present while the account is not activated. */
	activate?: string;
	/** Password reset hash, if a reset was requested. */
	reset?: string;
}

/** LTI information embedded in a session (models/session.py LTIData). */
export interface LtiData {
	version: string;
	email: string;
	username: string;
	realname: string;
	roles: string[];
	task: [string, string];
	redir_url: string;
	context_title?: string;
	context_label?: string;
	tool_description?: string;
	tool_name?: string;
	tool_url?: string;
	consumer_key?: string;
	outcome_service_url?: string;
	outcome_result_id?: string;
	message_launch_id?: string;
	platform_instance_id?: string;
	course_secret?: string;
}

/** `sessions` collection (models/session.py). */
export interface SessionDoc {
	_id: ObjectId;
	permanent: boolean;
	is_lti: boolean;
	loggedin: boolean;
	auth_storage: Record<string, unknown>;
	/** TTL index: the session is deleted by MongoDB after this date. */
	expiration?: Date;
	lti?: LtiData | null;
	code_indentation?: string;
	email?: string | null;
	language?: string;
	realname?: string | null;
	token?: string | null;
	tos_signed?: boolean;
	username?: string | null;
	timezone?: string;
}

/** `submissions` collection (models/submission.py). */
export interface SubmissionDoc {
	_id?: ObjectId;
	courseid: string;
	taskid: string;
	/** Usernames of the submitters (several for group submissions). */
	username: string[];
	/** GridFS file id containing the BSON-encoded input dict. */
	input: ObjectId;
	/** GridFS file id of the tgz archive produced by the grading container. */
	archive?: ObjectId | null;
	status: 'done' | 'error' | 'waiting';
	submitted_on: Date;
	response_type?: string;
	grade: number;
	custom?: Record<string, unknown>;
	/** problem id -> [result, feedback] (stored as a 2-element array). */
	problems?: Record<string, unknown>;
	result?: string;
	stderr?: string;
	stdout?: string;
	tests?: Record<string, unknown>;
	text?: string;
	user_ip?: string;
	state?: string;
	jobid?: string;
	ssh_host?: string;
	ssh_port?: number;
	ssh_user?: string;
	ssh_password?: string;
	last_replay?: Date;
	lti_version?: string;
	message_launch_id?: string;
	outcome_service_url?: string;
	outcome_result_id?: string;
	outcome_consumer_key?: string;
}

/** Submission tokens of a user for a task (models/user_task.py Tokens). */
export interface TokensDoc {
	amount: number;
	date: Date;
}

/** `user_tasks` collection: per user/task grading status (models/user_task.py). */
export interface UserTaskDoc {
	_id?: ObjectId;
	courseid: string;
	taskid: string;
	username: string;
	grade: number;
	submissionid: ObjectId | null;
	succeeded: boolean;
	tried: number;
	random: number[];
	tokens: TokensDoc;
	state: string;
}

/** `courses` collection: course registrations (models/course_class.py). */
export interface CourseClassDoc {
	_id: string;
	students: string[];
}

/** `audiences` collection (models/audience.py). */
export interface AudienceDoc {
	_id?: ObjectId;
	description: string;
	courseid: string;
	students: string[];
	tutors: string[];
}

/** `groups` collection (models/group.py). */
export interface GroupDoc {
	_id?: ObjectId;
	description: string;
	courseid: string;
	size: number;
	students: string[];
	audiences: ObjectId[];
}

/** `nonce` collection, LTI 1.1 replay protection (models/lti1_1.py). */
export interface NonceDoc {
	_id?: ObjectId;
	timestamp: Date;
	nonce: string;
	expiration: Date;
}

/** `lis_outcome_queue` collection, LTI 1.1 grade passback queue. */
export interface LisOutcomeDoc {
	_id?: ObjectId;
	courseid: string;
	taskid: string;
	username: string;
	nb_attempt: number;
	outcome_consumer_key: string;
	outcome_result_id: string;
	outcome_service_url: string;
}

/** `lti_grade_queue` collection, LTI 1.3 grade passback queue. */
export interface LtiGradeDoc {
	_id?: ObjectId;
	courseid: string;
	taskid: string;
	username: string;
	nb_attempt: number;
	message_launch_id: string;
}

/** `lti_launch` collection, LTI 1.3 launch data cache (PyLTI1p3 launch data storage). */
export interface LtiLaunchDoc {
	_id?: ObjectId;
	key: string;
	context: unknown[];
	value: unknown;
	/** Expiry of the entry (TTL index; added by the rewrite, entries written by the legacy frontend have none). */
	expires?: Date;
}

/** `db_version` collection. */
export interface DbVersionDoc {
	_id?: ObjectId;
	db_version: number;
}
