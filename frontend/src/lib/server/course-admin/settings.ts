/**
 * Course settings (CADM-03 base/accessibility/registration, CADM-04 and
 * LTI-01 LTI keys/1.3 configuration, CADM-05 tags): conversion of course.yaml
 * to the form values and validation of the posted values. Everything is
 * validated before anything is written (fixes the legacy partial saves), and
 * the keys are written with the legacy names and types.
 */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import type { CurrentUser } from '../../../app.d.ts';
import { accessibleTime } from '../courses/accessible.js';
import type { Course } from '../courses/course.js';
import { isValidId } from '../security/paths.js';
import { userOptions } from '../course-students/people.js';
import { attempt } from '../attempt.js';
import { registrationConflict, type Client } from '../lti/common.js';
import type { Values } from '#lib/components/course-admin/specs.js';

/** An LTI 1.3 client shown on the settings page (never with its private key). */
export interface LtiClient {
	type: 'global' | 'course';
	iss: string;
	clientId: string;
	deploymentIds: string[];
	publicKey: string;
	/** `md5(iss + client_id)`, last part of the JWKS URL (LTI-11). */
	keysetHash: string;
}

type Obj = Record<string, unknown>;
const ACL = ['', 'username', 'binding', 'email'];
const CLIENT_KEYS = [
	'default',
	'client_id',
	'auth_login_url',
	'auth_token_url',
	'key_set_url',
	'private_key',
	'public_key',
	'deployment_ids'
];
const access = z.union([z.boolean(), z.string()]);
const user = z.object({ value: z.string() }).transform((u) => u.value.trim());
const tag = z.object({
	id: z.string().trim().default(''),
	name: z.string().default(''),
	description: z.string().default(''),
	visible: z.boolean().default(false),
	type: z.coerce.number().int().min(0).max(2).default(0)
});
/** Posted settings (JSON field `settings`). */
export const settingsForm = z.object({
	name: z.string(),
	description: z.string(),
	admins: z.array(user),
	tutors: z.array(user),
	groups_student_choice: z.boolean(),
	allow_preview: z.boolean(),
	is_lti: z.boolean(),
	accessible: access,
	registration: access,
	allow_unregister: z.boolean(),
	registration_password: z.string(),
	registration_ac: z.string(),
	registration_ac_accept: z.boolean(),
	registration_ac_list: z.string(),
	lti_url: z.string(),
	lti_send_back_grade: z.boolean(),
	lti_keys: z.string(),
	lti_config: z.string(),
	lti_secrets: z.record(z.string(), z.string()),
	tags: z.array(tag)
});

/** LTI 1.3 clients of a configuration (issuer -> list of clients), without private keys. */
export function ltiClients(config: unknown, type: LtiClient['type']): LtiClient[] {
	return Object.entries((config ?? {}) as Record<string, Obj[]>).flatMap(([iss, list]) =>
		(Array.isArray(list) ? list : []).map((c) => ({
			type,
			iss,
			clientId: String(c.client_id),
			deploymentIds: ((c.deployment_ids ?? []) as unknown[]).map(String),
			publicKey: String(c.public_key ?? ''),
			keysetHash: createHash('md5')
				.update(iss + String(c.client_id))
				.digest('hex')
		}))
	);
}

/** Form values of a course (users with their real names for the pickers). */
export async function settingsValues(course: Course): Promise<Values> {
	const c = course.content as Obj;
	return {
		name: course.name,
		description: course.description,
		admins: await userOptions(course.admins),
		tutors: await userOptions(course.tutors),
		groups_student_choice: !!c.groups_student_choice,
		allow_preview: course.allowPreview,
		is_lti: course.isLti,
		accessible: c.accessible ?? true,
		registration: c.registration ?? true,
		allow_unregister: c.allow_unregister ?? true,
		registration_password: String(c.registration_password ?? ''),
		registration_ac: String(c.registration_ac ?? ''),
		registration_ac_accept: c.registration_ac_accept ?? true,
		registration_ac_list: ((c.registration_ac_list ?? []) as string[]).join('\n'),
		lti_url: String(c.lti_url ?? ''),
		lti_send_back_grade: !!c.lti_send_back_grade,
		lti_keys: Object.entries((c.lti_keys ?? {}) as Obj)
			.map(([k, s]) => `${k}:${String(s)}`)
			.join('\n'),
		lti_config: JSON.stringify(c.lti_config ?? {}, null, 2),
		lti_secrets: c.lti_secrets ?? {},
		tags: Object.entries((c.tags ?? {}) as Record<string, Obj>).map(([id, x]) => ({
			id,
			name: x.name,
			description: String(x.description ?? ''),
			visible: !!x.visible,
			type: String(x.type ?? 0)
		}))
	};
}

/**
 * Parses the LTI 1.3 JSON configuration with the legacy messages; a platform
 * `(iss, client_id)` declared elsewhere with other keys is refused.
 */
function ltiConfig(courseid: string, text: string, errors: string[]): Obj {
	const cfg: unknown = attempt(
		() => JSON.parse(text.trim() || '{}'),
		(e) => void errors.push(t("LTI config couldn't parse as JSON - {}", e.message))
	);
	if (cfg === undefined) return {};
	const bad = (m: string) => errors.push(t('LTI config is incorrect - {}', m));
	if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) bad('Not a JSON object');
	else
		for (const [iss, clients] of Object.entries(cfg)) {
			if (!Array.isArray(clients)) bad(`Issuer ${iss} must have a list of client_id configuration`);
			else
				clients.forEach((c: Obj, i) => {
					const missing = CLIENT_KEYS.find((k) => !(k in (c ?? {})));
					if (missing) return bad(`Missing ${missing} in client config ${i} of issuer ${iss}`);
					const conflict = registrationConflict(courseid, iss, c as unknown as Client);
					if (conflict) bad(`Client ${c.client_id} of issuer ${iss} is already registered in ${conflict}`);
					for (const [kind, parse] of [
						['private', createPrivateKey],
						['public', createPublicKey]
					] as const)
						attempt<unknown>(
							() => parse(String(c[`${kind}_key`])),
							() => bad(`Error in ${kind} key of client config ${i} of issuer ${iss}`)
						);
				});
		}
	return cfg as Obj;
}

/**
 * Checks the posted settings and returns the new descriptor (unknown keys
 * and key order kept, new keys appended), or the list of errors.
 */
export function buildSettings(
	course: Course,
	v: z.output<typeof settingsForm>,
	me: CurrentUser
): { content: Obj } | { errors: string[] } {
	const errors: string[] = [];
	const check = (ok: boolean, msg: string) => ok || errors.push(msg);
	check(v.name.trim() !== '', t('Invalid name'));
	check(
		me.superadmin || v.admins.includes(me.username),
		t('You cannot remove yourself from the administrators of this course')
	);
	for (const [value, msg] of [
		[v.accessible, t('Invalid accessibility dates')],
		[v.registration, t('Invalid registration dates')]
	] as const)
		attempt<unknown>(
			() => accessibleTime(value),
			() => errors.push(msg)
		);
	check(ACL.includes(v.registration_ac), t('Invalid ACL value'));
	const ltiKeys: Record<string, string> = {};
	for (const line of v.lti_keys
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)) {
		const [key, secret, ...rest] = line.split(':');
		if (secret === undefined || rest.length) errors.push(t('Each LTI key line must have the form key:secret.'));
		else if (check(/^[a-zA-Z0-9]*$/.test(key), t('LTI keys must be alphanumerical.')) === true) ltiKeys[key] = secret;
	}
	const lti = ltiConfig(course.id, v.lti_config, errors);
	check(
		Object.values(v.lti_secrets).every((s) => /^[a-zA-Z0-9]*$/.test(s)),
		t('LTI deployment secrets must be alphanumerical.')
	);
	// CADM-05: rows with an empty id are dropped; categories (type 2) are kept.
	const rows = v.tags.filter((x) => x.id);
	check(new Set(rows.map((x) => x.id)).size === rows.length, t('Some datas have the same id! The id must be unique.'));
	const tags: Obj = {};
	for (const { id, ...x } of rows) {
		if (!x.name) errors.push(t('Some tag fields were missing.'));
		else if (!isValidId(id)) errors.push(t('Invalid tag id: {}', id));
		else tags[id] = x;
	}
	if (errors.length) return { errors };
	const content: Obj = {
		...course.content,
		name: v.name,
		description: v.description,
		admins: v.admins,
		tutors: v.tutors
	};
	return {
		content: Object.assign(content, {
			groups_student_choice: v.groups_student_choice,
			accessible: v.accessible,
			allow_unregister: v.allow_unregister,
			allow_preview: v.allow_preview,
			registration: v.registration,
			registration_password: v.registration_password || null,
			registration_ac: v.registration_ac || null,
			registration_ac_accept: v.registration_ac_accept,
			registration_ac_list: v.registration_ac_list
				.split('\n')
				.map((l) => l.trim())
				.filter(Boolean),
			is_lti: v.is_lti,
			lti_url: v.lti_url,
			lti_keys: ltiKeys,
			lti_config: lti,
			lti_secrets: v.lti_secrets,
			lti_send_back_grade: v.lti_send_back_grade,
			tags
		})
	};
}
