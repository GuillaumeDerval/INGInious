import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupCourses, type CoursesEnv } from '../../../../tests/fixtures/courses/setup.js';
import { getCourse } from './course.js';
import { getTask } from './task.js';
import * as p from './problems.js';

let env: CoursesEnv;
beforeAll(async () => {
	env = await setupCourses();
});
afterAll(() => env.cleanup());

const defaults = { allowedFileExtensions: ['.c', '.txt'], maxFileSize: 1024 };
const task = (id: string) => getTask(getCourse('fx'), id);
const ctx = (username: string | null, language = 'en'): p.ViewContext => ({
	language,
	username,
	tr: (_l, s) => (s ? `[${s}]` : ''),
	defaults
});
const views = (id: string, c = ctx('alice')) => task(id).problems.map((x) => p.problemView(x, c));
const form = (entries: [string, string | File][]) => {
	const f = new FormData();
	for (const [k, v] of entries) f.append(k, v);
	return f;
};

describe('definitions', () => {
	it.each([
		['bad id', { type: 'code' }, 'Invalid problem _id: bad id'],
		['p', { type: 'nope' }, 'Invalid type for problem p'],
		['p', null, 'Invalid type for problem p'],
		['p', { type: 'code', language: 'c++' }, 'Invalid language c++'],
		['p', { type: 'match' }, 'There is no answer in this problem with type==match'],
		['p', { type: 'multiple_choice' }, 'Multiple choice problem p does not have choices or choices are not an array'],
		['p', { type: 'multiple_choice', choices: [{}] }, 'A choice in p does not have text'],
		['p', { type: 'multiple_choice', choices: [{ text: 'a' }] }, 'Problem p does not have any valid answer'],
		['p', { type: 'multiple_choice', limit: -1, choices: [{ text: 'a', valid: true }] }, 'Invalid limit in problem p'],
		[
			'p',
			{
				type: 'multiple_choice',
				limit: 1,
				multiple: true,
				choices: [
					{ text: 'a', valid: true },
					{ text: 'b', valid: true }
				]
			},
			'Invalid limit in problem p'
		]
	])('rejects %s %j', (id, content, message) => {
		expect(() => p.createProblem(id, content)).toThrow(message);
	});
	it('supports plugin types through the generic definition', () => {
		expect(() => p.createProblem('x', { type: 'custom' })).toThrow();
		p.registerProblemType('custom');
		expect(p.createProblem('x', { type: 'custom' })).toEqual({
			id: 'x',
			type: 'custom',
			content: { type: 'custom' }
		});
		expect(p.problemView(p.createProblem('x', { type: 'custom', name: 'N' }), ctx('a'))).toEqual({
			id: 'x',
			type: 'custom',
			name: '[N]',
			header: ''
		});
	});
});

describe('views', () => {
	it('describes code problems', () => {
		expect(views('code1')).toEqual([
			{
				id: 'code',
				type: 'code',
				name: '[Your code]',
				header: '[Implement it.]',
				language: 'python',
				default: 'pass',
				optional: false,
				offset: 3
			},
			{
				id: 'opt',
				type: 'code',
				name: '',
				header: '',
				language: 'plain',
				default: '',
				optional: true,
				offset: 1
			}
		]);
	});
	it('describes file, match and single line problems', () => {
		expect(views('upload')).toEqual([
			{ id: 'report', type: 'file', name: '', header: '', maxSize: 10, allowedExts: ['.txt'] },
			{ id: 'any', type: 'file', name: '', header: '', maxSize: 1024, allowedExts: ['.c', '.txt'] },
			{ id: 'answer', type: 'match', name: '', header: '' },
			{
				id: 'line',
				type: 'code_single_line',
				name: '',
				header: '',
				default: 'x',
				optional: false,
				language: undefined,
				offset: undefined
			}
		]);
	});
	it('shuffles and limits choices exactly like legacy (vectors from CPython)', () => {
		const order = (username: string | null, language: string) =>
			views('mcq1', ctx(username, language))[0].choices?.map((c) => c.index);
		expect(order('alice', 'en')).toEqual([1, 3, 0]);
		expect(order('bob', 'en')).toEqual([2, 1, 0]);
		expect(order('bob', 'fr')).toEqual([3, 0, 1]);
		expect(order(null, 'en')).toEqual([2, 3, 0]);
		const [single, multiple] = views('mcq1');
		expect(single.multiple).toBe(false);
		expect(single.choices?.find((c) => c.index === 0)?.text).toBe('[Brussels]');
		expect(multiple).toMatchObject({
			multiple: true,
			choices: [
				{ index: 0, text: '[2]' },
				{ index: 1, text: '[3]' },
				{ index: 2, text: '[4]' }
			]
		});
		const limited = p.createProblem('m', {
			type: 'multiple_choice',
			multiple: true,
			limit: 3,
			choices: ['a', 'b', 'c', 'd', 'e'].map((text, i) => ({ text, valid: i < 2 }))
		});
		expect(p.problemView(limited, ctx('alice')).choices?.map((c) => c.index)).toEqual([1, 0, 2]);
		const zero = p.createProblem('z', {
			type: 'multiple_choice',
			limit: 0,
			choices: [{ text: 'a', valid: true }]
		});
		expect(p.problemView(zero, ctx('alice')).choices).toHaveLength(1);
	});
});

describe('buildInput (TASK-08)', () => {
	it('builds the legacy input dict', async () => {
		const input = await p.buildInput(
			task('upload').problems,
			form([
				['@action', 'submit'],
				['@debug-mode', 'ssh'],
				['extra', 'kept'],
				['extra', 'second'],
				['report', new File(['hello'], 'a.txt')],
				['any', new File(['int main'], 'm.c')],
				['answer', ' 42 '],
				['line', 'y']
			]),
			defaults
		);
		expect(input).toEqual({
			extra: 'kept',
			answer: ' 42 ',
			line: 'y',
			report: { filename: 'a.txt', value: new TextEncoder().encode('hello') },
			any: { filename: 'm.c', value: new TextEncoder().encode('int main') }
		});
	});
	it('keeps only the @random_<i> fields among the posted @-fields', async () => {
		const input = await p.buildInput(
			[],
			form([
				['@random_0', '0.5'],
				['@random_12', '0.25'],
				['@random_x', 'no'],
				['@username', 'someone_else'],
				['@email', 'x@example.com'],
				['@state', '{}'],
				['@lang', 'fr'],
				['plain', 'kept']
			]),
			defaults
		);
		expect(input).toEqual({ '@random_0': '0.5', '@random_12': '0.25', plain: 'kept' });
	});
	it('keeps every posted field for trusted callers', async () => {
		expect(await p.buildInput([], form([['@lang', 'fr']]), defaults, true)).toEqual({ '@lang': 'fr' });
	});
	it('rejects missing or invalid files', async () => {
		const base: [string, string | File][] = [
			['answer', 'x'],
			['line', 'y'],
			['any', new File([''], 'm.c')]
		];
		const build = (report?: File) =>
			p.buildInput(task('upload').problems, form(report ? [...base, ['report', report]] : base), defaults);
		expect(await build()).toBeNull();
		expect(await build(new File(['x'], 'a.pdf'))).toBeNull();
		expect(await build(new File(['01234567890'], 'a.txt'))).toBeNull();
		expect(await build(new File(['0123456789'], 'a.txt'))).not.toBeNull();
	});
	it('validates code and multiple choice answers', async () => {
		const mcq = task('mcq1').problems;
		const build = (entries: [string, string][]) => p.buildInput(mcq, form(entries), defaults);
		expect(
			await build([
				['capital', '1'],
				['primes', '0'],
				['primes', '2']
			])
		).toMatchObject({ capital: '1', primes: ['0', '2'] });
		expect(await build([['capital', '0']])).toMatchObject({ primes: [] });
		for (const bad of ['7', 'abc', '-1']) expect(await build([['capital', bad]])).toBeNull();
		expect(await build([['primes', '0']])).toBeNull();
		expect(
			await build([
				['capital', '0'],
				['primes', 'x']
			])
		).toBeNull();
		const code = task('code1').problems;
		expect(
			await p.buildInput(
				code,
				form([
					['code', 'print(1)'],
					['opt', '']
				]),
				defaults
			)
		).toEqual({ code: 'print(1)', opt: '' });
		expect(
			await p.buildInput(
				code,
				form([
					['code', ''],
					['opt', '']
				]),
				defaults
			)
		).toBeNull();
		expect(await p.buildInput(code, form([['code', 'x']]), defaults)).toBeNull();
		expect(await p.buildInput(task('future').problems, form([]), defaults)).toBeNull();
		expect(p.genericProblemType.accept(undefined, {}, defaults)).toBeUndefined();
	});
});
