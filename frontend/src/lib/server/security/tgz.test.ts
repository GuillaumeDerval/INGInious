/**
 * Unit tests of the bounded grader archive reader (tgz.ts).
 */
import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { pack } from 'tar-stream';
import { TGZ_LIMITS, TgzLimitError, tgzMembers, type TgzLimits } from './tgz.js';

/** Builds a .tgz from [name, content | null (folder)] pairs. */
async function tgz(entries: [string, string | Buffer | null][]): Promise<Buffer> {
	const p = pack();
	for (const [name, data] of entries)
		if (data === null) p.entry({ name, type: 'directory' });
		else p.entry({ name }, data);
	p.finalize();
	const chunks: Buffer[] = [];
	for await (const chunk of p) chunks.push(chunk as Buffer);
	return gzipSync(Buffer.concat(chunks));
}

/** Reads every member (name → content). */
async function read(archive: Uint8Array, limits?: TgzLimits): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for await (const { header, data } of tgzMembers(archive, limits)) out[header.name] = data.toString();
	return out;
}

describe('tgzMembers', () => {
	it('yields the members with their content', async () => {
		expect(
			await read(
				await tgz([
					['dir/', null],
					['dir/a.txt', 'hello'],
					['b', '']
				])
			)
		).toEqual({
			'dir/': '',
			'dir/a.txt': 'hello',
			b: ''
		});
	});

	it('stops at the member count, member size and total size limits', async () => {
		const limits = { ...TGZ_LIMITS, members: 2 };
		await expect(
			read(
				await tgz([
					['a', '1'],
					['b', '2'],
					['c', '3']
				]),
				limits
			)
		).rejects.toThrow(TgzLimitError);
		const big = await tgz([['zeros', Buffer.alloc(1 << 20)]]);
		// 1 MiB of zeros compresses to about 1 kB.
		expect(big.length).toBeLessThan(5000);
		await expect(read(big, { ...TGZ_LIMITS, memberBytes: 1000 })).rejects.toThrow(/member larger than 1000/);
		await expect(read(big, { ...TGZ_LIMITS, totalBytes: 100_000 })).rejects.toThrow(/more than 100000 bytes/);
		expect(Object.keys(await read(big))).toEqual(['zeros']);
	});

	it('fails on corrupted archives and can be left early', async () => {
		await expect(read(Buffer.from('not a gzip'))).rejects.toThrow();
		const members = tgzMembers(
			await tgz([
				['a', '1'],
				['b', '2']
			])
		);
		expect((await members.next()).value?.header.name).toBe('a');
		expect(await members.return(undefined)).toEqual({ done: true, value: undefined });
	});
});
