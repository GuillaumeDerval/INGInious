/**
 * WebDAV access to course folders (SITE-22, SITE-23), served under `/dav/`
 * (set `webdav_host` to `<public url>/dav`). Replaces the legacy WsgiDAV app:
 *  - Basic authentication with the username and the API key (AUTH-19),
 *    compared in constant time; only course admins and superadmins of the
 *    course are accepted (no lazy key creation, no Digest);
 *  - the path is normalised BEFORE the course is chosen and every file access
 *    goes through `safeJoin`, so that every access stays inside the chosen
 *    course folder (`/A/../A2/` resolves to `A2`, symlinks cannot escape);
 *  - `course.yaml` cannot be deleted, moved, copied or overwritten by an
 *    invalid descriptor, and an invalid `task.yaml` is refused (400) instead
 *    of being saved;
 *  - methods: OPTIONS, GET/HEAD (folders: plain text listing), PROPFIND
 *    (depth 0/1), PUT, MKCOL, DELETE, COPY, MOVE and advisory LOCK/UNLOCK
 *    (fake tokens, like the legacy in-memory locks).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { services } from '../app.js';
import { safeEqual } from '../courses/access.js';
import { buildCourse, findCourse, type Course } from '../courses/course.js';
import { parseYaml, writeFileAtomic } from '../courses/files.js';
import { isCourseAdmin } from '../courses/members.js';
import { buildTask } from '../courses/task.js';
import { cleanRelativePath, safeJoin } from '../security/paths.js';
import { attempt } from '../attempt.js';
import { authThrottle, clientAddress } from '../auth/rate-limit.js';

/** URL prefix of the WebDAV tree. */
export const DAV_PREFIX = '/dav';
const ALLOW = 'OPTIONS, GET, HEAD, PROPFIND, PUT, MKCOL, DELETE, COPY, MOVE, LOCK, UNLOCK';

const reply = (status: number, body: string | Buffer | null = null, headers: Record<string, string> = {}) =>
	new Response(body as BodyInit | null, { status, headers });
const XML = { 'Content-Type': 'application/xml; charset=utf-8' };

/** Normalised segments of a relative path (throws for paths leaving the root). */
const segments = (path: string) => cleanRelativePath(path).split('/').filter(Boolean);
/** Absolute path of segments of the DAV tree, confined (symlinks included) to the course folder `parts[0]`. */
const abs = (parts: string[]) => safeJoin(safeJoin(services().config.tasksDirectory, parts[0]), ...parts.slice(1));
/** Course roots and course descriptors cannot be deleted, moved, copied or replaced by a move. */
const isProtected = (parts: string[]) => parts.length < 2 || (parts.length === 2 && parts[1] === 'course.yaml');

/**
 * SITE-22: true when Basic credentials are a user's API key and the user administers the course.
 * Wrong credentials are throttled per account and client; a request without credentials is the normal challenge.
 */
async function allowed(course: Course, event: RequestEvent): Promise<boolean> {
	const { request } = event;
	const decoded = Buffer.from(
		/^Basic (.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '',
		'base64'
	).toString('utf8');
	const [username, key] = [
		decoded.slice(0, Math.max(0, decoded.indexOf(':'))),
		decoded.slice(decoded.indexOf(':') + 1)
	];
	if (!decoded) return false;
	const [client, account] = [clientAddress(event), `dav:${username}`];
	if (authThrottle.blocked(client, account)) return false;
	const user = username ? await services().db.c.users.findOne({ username }) : null;
	const ok = !!user?.apikey && safeEqual(user.apikey, key) && isCourseAdmin(course, username);
	if (!ok) authThrottle.failed(client, account);
	return ok;
}

/**
 * SITE-23: refuses invalid course/task descriptors.
 * @returns an error message, or null when `rel` is not a descriptor or is valid.
 */
function invalidDescriptor(course: Course, rel: string[], data: Buffer): string | null {
	const raw = () => parseYaml(data.toString('utf8')) as Record<string, unknown>;
	return attempt(
		() => {
			if (rel.length === 2 && rel[1] === 'course.yaml') buildCourse(course.id, raw());
			if (rel.length === 3 && rel[2] === 'task.yaml') buildTask(course, rel[1], raw());
			return null;
		},
		() => 'Invalid descriptor'
	);
}

/** One `<D:response>` of a PROPFIND answer. */
function propEntry(parts: string[]): string {
	const st = statSync(abs(parts));
	const [dir, size] = [st.isDirectory(), `<D:getcontentlength>${st.size}</D:getcontentlength>`];
	const href = DAV_PREFIX + '/' + parts.map(encodeURIComponent).join('/') + (dir ? '/' : '');
	return `<D:response><D:href>${href}</D:href><D:propstat><D:prop><D:resourcetype>${dir ? '<D:collection/>' : ''}</D:resourcetype>${dir ? '' : size}<D:getlastmodified>${st.mtime.toUTCString()}</D:getlastmodified><D:getetag>"${st.mtimeMs}-${st.size}"</D:getetag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}

/** Answers a WebDAV request on `path` (relative to the DAV root, URL-decoded). */
export async function handleDav(event: RequestEvent, path: string): Promise<Response> {
	const { request } = event;
	const rel = attempt(
		() => segments(path),
		() => null
	);
	const course = rel && findCourse(rel[0] ?? '');
	if (!rel || !course) return reply(404);
	if (!(await allowed(course, event))) return reply(401, null, { 'WWW-Authenticate': `Basic realm="${course.id}"` });
	const file = abs(rel);
	const st = existsSync(file) ? statSync(file) : null;
	const parentExists = existsSync(abs(rel.slice(0, -1)));
	switch (request.method) {
		case 'OPTIONS':
			return reply(200, null, { DAV: '1, 2', Allow: ALLOW });
		case 'GET':
		case 'HEAD':
			if (!st) return reply(404);
			if (st.isDirectory())
				return reply(200, readdirSync(file).join('\n'), { 'Content-Type': 'text/plain; charset=utf-8' });
			return reply(200, request.method === 'HEAD' ? null : readFileSync(file), {
				'Content-Type': 'application/octet-stream',
				'Content-Length': String(st.size)
			});
		case 'PROPFIND': {
			if (!st) return reply(404);
			const children =
				st.isDirectory() && request.headers.get('depth') !== '0' ? readdirSync(file).map((n) => [...rel, n]) : [];
			return reply(
				207,
				`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${[rel, ...children].map(propEntry).join('')}</D:multistatus>`,
				XML
			);
		}
		case 'PUT': {
			if (st?.isDirectory() || !parentExists) return reply(st ? 405 : 409);
			const data = Buffer.from(await request.arrayBuffer());
			const invalid = invalidDescriptor(course, rel, data);
			if (invalid) return reply(400, invalid);
			writeFileAtomic(file, data);
			return reply(st ? 204 : 201);
		}
		case 'MKCOL':
			if (st || !parentExists) return reply(st ? 405 : 409);
			mkdirSync(file);
			return reply(201);
		case 'DELETE':
			if (isProtected(rel) || !st) return reply(st ? 403 : 404);
			rmSync(file, { recursive: true });
			return reply(204);
		case 'COPY':
		case 'MOVE': {
			const header = request.headers.get('destination');
			if (!header) return reply(400);
			const dest = attempt(
				() => segments(decodeURIComponent(new URL(header, event.url).pathname.slice(DAV_PREFIX.length + 1))),
				() => null
			);
			if (!st) return reply(404);
			// Copies and moves stay inside the course, never touch its root or descriptor nor the source itself.
			const same = dest?.join('/') === rel.join('/');
			if (!dest || same || isProtected(rel) || isProtected(dest) || dest[0] !== course.id) return reply(403);
			const target = abs(dest);
			const existed = existsSync(target);
			if (existed && request.headers.get('overwrite') === 'F') return reply(412);
			rmSync(target, { recursive: true, force: true });
			if (request.method === 'MOVE') renameSync(file, target);
			else cpSync(file, target, { recursive: true });
			return reply(existed ? 204 : 201);
		}
		case 'LOCK': {
			const token = `opaquelocktoken:${randomUUID()}`;
			const lock = `<D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>0</D:depth><D:timeout>Second-3600</D:timeout><D:locktoken><D:href>${token}</D:href></D:locktoken></D:activelock>`;
			return reply(
				200,
				`<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery>${lock}</D:lockdiscovery></D:prop>`,
				{ 'Lock-Token': `<${token}>`, ...XML }
			);
		}
		case 'UNLOCK':
			return reply(204);
		default:
			return reply(405, null, { Allow: ALLOW });
	}
}
