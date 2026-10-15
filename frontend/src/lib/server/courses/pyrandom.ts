/**
 * Bit-for-bit port of CPython's `random.Random(<str seed>)` and `shuffle`
 * (Mersenne Twister MT19937, `Modules/_randommodule.c` + `Lib/random.py`).
 *
 * The legacy frontend draws the tasks of a combinatory test (NAV-13) and
 * shuffles multiple-choice answers (TASK-05) with `Random("<seed string>")`;
 * reproducing the exact sequence keeps every student's draw stable across the
 * migration. Seeding (version 2): the string is UTF-8 encoded, its SHA-512
 * digest appended, the bytes read as a big-endian integer, split into 32-bit
 * words (least significant first) and fed to `init_by_array`.
 */
import { createHash } from 'node:crypto';

const N = 624;
const M = 397;

/** A CPython-compatible pseudo random generator seeded with a string. */
export class PyRandom {
	private readonly mt = new Uint32Array(N);
	private index = N;

	/** @param seed seed string, e.g. `"nav_alice#0#Pool A"`. */
	constructor(seed: string) {
		const bytes = Buffer.from(seed, 'utf8');
		const all = Buffer.concat([bytes, createHash('sha512').update(bytes).digest()]);
		// Big-endian integer -> little-endian 32-bit words, without leading zero words.
		const key: number[] = [];
		for (let end = all.length; end > 0; end -= 4) {
			let word = 0;
			for (let i = Math.max(0, end - 4); i < end; i++) word = (word * 256 + all[i]) >>> 0;
			key.push(word);
		}
		while (key.length > 1 && key[key.length - 1] === 0) key.pop();
		this.initByArray(key);
	}

	/** MT19937 `init_genrand`. */
	private initGenrand(s: number): void {
		const mt = this.mt;
		mt[0] = s;
		for (let i = 1; i < N; i++) mt[i] = Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i;
		this.index = N;
	}

	/** MT19937 `init_by_array`. */
	private initByArray(key: number[]): void {
		const mt = this.mt;
		this.initGenrand(19650218);
		let i = 1;
		let j = 0;
		for (let k = Math.max(N, key.length); k > 0; k--) {
			mt[i] = (mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j;
			i++;
			j++;
			if (i >= N) {
				mt[0] = mt[N - 1];
				i = 1;
			}
			if (j >= key.length) j = 0;
		}
		for (let k = N - 1; k > 0; k--) {
			mt[i] = (mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i;
			i++;
			if (i >= N) {
				mt[0] = mt[N - 1];
				i = 1;
			}
		}
		mt[0] = 0x80000000;
	}

	/** MT19937 `genrand_uint32`: next 32-bit output. */
	private next(): number {
		const mt = this.mt;
		if (this.index >= N) {
			for (let kk = 0; kk < N; kk++) {
				const y = (mt[kk] & 0x80000000) | (mt[(kk + 1) % N] & 0x7fffffff);
				mt[kk] = mt[(kk + M) % N] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
			}
			this.index = 0;
		}
		let y = mt[this.index++];
		y ^= y >>> 11;
		y ^= (y << 7) & 0x9d2c5680;
		y ^= (y << 15) & 0xefc60000;
		return (y ^ (y >>> 18)) >>> 0;
	}

	/** `getrandbits(k)` for 1 <= k <= 32. */
	getrandbits(k: number): number {
		return this.next() >>> (32 - k);
	}

	/** `_randbelow_with_getrandbits(n)`: uniform integer in [0, n). */
	randbelow(n: number): number {
		const k = 32 - Math.clz32(n);
		let r = this.getrandbits(k);
		while (r >= n) r = this.getrandbits(k);
		return r;
	}

	/** In-place `random.shuffle(list)` (Fisher-Yates from the end). */
	shuffle<T>(list: T[]): T[] {
		for (let i = list.length - 1; i > 0; i--) {
			const j = this.randbelow(i + 1);
			[list[i], list[j]] = [list[j], list[i]];
		}
		return list;
	}
}
