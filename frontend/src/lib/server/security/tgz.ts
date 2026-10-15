/**
 * Bounded reading of `.tgz` archives produced by graders (stored in GridFS with
 * each submission): used by the submissions download (course-students/archive.ts)
 * and the git_repo plugin. The archive is decompressed as a stream and reading
 * stops with a `TgzLimitError` as soon as the decompressed size, the size of one
 * member or the number of members exceeds its limit, so a highly compressible
 * archive can neither exhaust memory nor keep the process busy.
 */
import { pipeline, Readable, Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { extract, type Header } from 'tar-stream';

/** Limits applied while reading an archive. */
export interface TgzLimits {
	/** Maximum decompressed size of the whole tar stream (headers included), in bytes. */
	totalBytes: number;
	/** Maximum size of one member, in bytes (a member is held in memory while it is processed). */
	memberBytes: number;
	/** Maximum number of members (files, folders, links...). */
	members: number;
}

/** Default limits: 128 MiB decompressed, 32 MiB per member, 10 000 members. */
export const TGZ_LIMITS: TgzLimits = { totalBytes: 128 << 20, memberBytes: 32 << 20, members: 10_000 };

/** Thrown when an archive exceeds one of its limits. */
export class TgzLimitError extends Error {
	constructor(what: string) {
		super(`Archive too large: ${what}`);
		this.name = 'TgzLimitError';
	}
}

/** One member of an archive: its tar header and its content (empty for folders and links). */
export interface TgzMember {
	header: Header;
	data: Buffer;
}

/**
 * Yields the members of a gzipped tar archive, in order.
 * @throws TgzLimitError when a limit is exceeded; zlib/tar errors for corrupted archives.
 */
export async function* tgzMembers(archive: Uint8Array, limits: TgzLimits = TGZ_LIMITS): AsyncGenerator<TgzMember> {
	let total = 0;
	// Counts the decompressed bytes before tar parsing (also bounds tar headers and padding).
	const counter = new Transform({
		transform(chunk: Buffer, _encoding, done) {
			total += chunk.length;
			done(total > limits.totalBytes ? new TgzLimitError(`more than ${limits.totalBytes} bytes`) : null, chunk);
		}
	});
	const members = extract();
	// pipeline propagates any error (gunzip, counter) to `members`, which makes the loop below throw;
	// leaving the loop early (limit, caller stopping) destroys `members`, and pipeline the rest.
	pipeline(Readable.from([archive]), createGunzip(), counter, members, () => {});
	let count = 0;
	for await (const member of members) {
		if (++count > limits.members) throw new TgzLimitError(`more than ${limits.members} members`);
		if (Number(member.header.size) > limits.memberBytes)
			throw new TgzLimitError(`member larger than ${limits.memberBytes} bytes`);
		const chunks: Buffer[] = [];
		for await (const chunk of member) chunks.push(chunk as Buffer);
		yield { header: member.header, data: Buffer.concat(chunks) };
	}
}
