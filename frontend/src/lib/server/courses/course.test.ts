import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMo, SAMPLE_COURSES, setupCourses, type CoursesEnv } from '../../../../tests/fixtures/courses/setup.js';
import * as c from './course.js';
import { isNeverAccessible, ALWAYS, isOpen } from './accessible.js';
import { listTasks } from './task.js';

let env: CoursesEnv;
beforeAll(async () => {
	env = await setupCourses();
});
afterAll(() => env.cleanup());

describe('loading', () => {
	it('reads every key with legacy defaults', () => {
		const course = c.getCourse('fx');
		expect(course).toMatchObject({
			id: 'fx',
			name: 'Fixture course',
			description: 'Hello *world*\n',
			admins: ['admin1'],
			tutors: ['tutor1'],
			registrationPassword: 'pwd',
			registrationAc: null,
			registrationAcAccept: true,
			groupsStudentChoice: true,
			allowUnregister: true,
			allowPreview: false,
			isLti: false,
			ltiUrl: '',
			archived: false,
			archiveDate: null
		});
		expect(course.content.custom_key).toBe('kept');
		expect(course.tags.orga).toEqual({
			id: 'orga',
			name: 'Week 1',
			description: '',
			visible: false,
			type: 0
		});
		expect(course.accessible).toEqual(ALWAYS);
		expect(c.getCourse('fx')).toBe(course);
		expect(c.courseTaskIds(course)).toEqual(['broken', 'code1', 'future', 'legacy', 'mcq1', 'upload']);
		// The folder deleted since the course was loaded (concurrent deletion): no task, no error.
		expect(c.courseTaskIds({ ...course, id: 'deleted_meanwhile' })).toEqual([]);
	});
	it('forces LTI and archive values', () => {
		const lti = c.buildCourse('x', {
			name: 'L',
			is_lti: true,
			accessible: false,
			registration: true,
			registration_password: 'p',
			registration_ac: 'email',
			registration_ac_list: ['a'],
			groups_student_choice: true,
			lti_url: 'u',
			lti_keys: { k: 's' },
			lti_send_back_grade: true
		});
		expect(lti.accessible).toEqual(ALWAYS);
		expect(isNeverAccessible(lti.registration)).toBe(true);
		expect(lti).toMatchObject({
			registrationPassword: null,
			registrationAc: null,
			registrationAcList: [],
			groupsStudentChoice: false,
			allowUnregister: false,
			ltiUrl: 'u',
			ltiKeys: { k: 's' },
			ltiSendBackGrade: true
		});
		const plain = c.buildCourse('x', {
			name: 'P',
			lti_url: 'u',
			lti_keys: { k: 's' },
			lti_send_back_grade: true,
			archived: true,
			archive_date: '2026-10-14T05:39:08+00:00',
			text_format: 'rst'
		});
		expect(plain).toMatchObject({
			ltiUrl: '',
			ltiKeys: {},
			ltiSendBackGrade: false
		});
		expect(plain.archiveDate?.toISOString()).toBe('2026-10-14T05:39:08.000Z');
		expect(isOpen(plain.accessible)).toBe(false);
		// Legacy also accepts dd/mm/YYYY dates (server local time).
		expect(c.buildCourse('x', { name: 'x', archive_date: '14/10/2026 05:39' }).archiveDate).toEqual(
			new Date(2026, 9, 14, 5, 39)
		);
	});
	it('compiles the ACL like Python', () => {
		const acl = (list: string[]) =>
			c.buildCourse('x', { name: 'n', registration_ac: 'email', registration_ac_list: list }).registrationAcRegex;
		expect(acl(['*@ok.org', 'nav_bob@x.org']).test('a@ok.org')).toBe(true);
		expect(acl(['*@ok.org']).test('a@OK.org')).toBe(false);
		expect(acl(['a.b']).test('axb')).toBe(false);
		expect(acl(['a?[(']).test('a?[(')).toBe(true);
		expect(acl(['s*x']).test('s123x')).toBe(true);
		expect(acl([]).test('')).toBe(true);
		expect(acl([]).test('a')).toBe(false);
	});
	it.each([
		[{}, 'invalid name'],
		[{ name: 'x', nofrontend: true }, 'not allowed'],
		[{ name: 'x', registration_ac: 'ip' }, 'registration_ac'],
		[{ name: 'x', admins: 'root' }, 'admins'],
		[{ name: 'x', tags: { t: {} } }, 'Tag t'],
		[{ name: 'x', accessible: 'notadate' }, 'Unknown format'],
		[{ name: 'x', archive_date: 'bad' }, 'Unknown format'],
		[{ name: 'x', dispenser_data: { bad: 1 } }, 'Invalid dispenser data structure']
	])('rejects invalid descriptors %j', (content, message) => {
		expect(() => c.buildCourse('x', content)).toThrow(message);
	});
	it('reports missing, invalid and broken courses as not found', () => {
		for (const id of ['nope', '../fx', 'fxbroken', '']) expect(() => c.getCourse(id)).toThrow(c.NotFoundError);
	});
	it('lists loadable courses only', () => {
		mkdirSync(join(env.dir, 'not.a.course'));
		mkdirSync(join(env.dir, '$weird'));
		expect([...c.listCourses().keys()]).toEqual(['fx', 'fxcontest']);
	});
	it('translates course strings', () => {
		mkdirSync(join(env.dir, 'fx', '$i18n'));
		writeFileSync(join(env.dir, 'fx', '$i18n', 'fr.mo'), compileMo({ 'Fixture course': 'Cours fixture' }));
		const course = c.getCourse('fx');
		expect(course.tr('fr', course.name)).toBe('Cours fixture');
		expect(course.tr('en', course.name)).toBe('Fixture course');
	});
});

describe('writing', () => {
	it('creates a course without overwriting existing ones (NAV-04)', () => {
		const course = c.createCourse('newc');
		expect(course).toMatchObject({ name: 'newc' });
		expect(readFileSync(join(env.dir, 'newc', 'course.yaml'), 'utf8')).toBe('name: newc\naccessible: false\n');
		expect(() => c.createCourse('fx')).toThrow('EEXIST');
		for (const id of ['', 'a b', '../x', 'a/b', 'é']) expect(() => c.createCourse(id)).toThrow('Invalid course id');
	});
	it('saves and reloads a descriptor', () => {
		const content = { ...c.getCourse('newc').content, description: 'multi\nline', admins: ['me'] };
		c.saveCourse('newc', content);
		expect(c.getCourse('newc')).toMatchObject({ description: 'multi\nline', admins: ['me'] });
		expect(() => c.saveCourse('newc', { name: 'x', accessible: 'bad' })).toThrow('Unknown format');
		expect(() => c.saveCourse('a/b', { name: 'x' })).toThrow(c.NotFoundError);
	});
	it('reloads after an external edit', () => {
		const path = join(env.dir, 'newc', 'course.yaml');
		writeFileSync(path, 'name: Edited\n');
		utimesSync(path, new Date(), new Date(Date.now() + 10000));
		expect(c.getCourse('newc').name).toBe('Edited');
	});
	it('deletes a course', () => {
		c.deleteCourse('newc');
		expect(existsSync(join(env.dir, 'newc'))).toBe(false);
		expect(() => c.getCourse('newc')).toThrow(c.NotFoundError);
		expect(() => c.deleteCourse('..')).toThrow(c.NotFoundError);
	});
	it('handles a missing tasks directory', async () => {
		await env.cleanup();
		env = await setupCourses({ tasksDirectory: join(SAMPLE_COURSES, 'missing') });
		expect(c.listCourses().size).toBe(0);
	});
});

describe('smoke test', () => {
	it('loads every course and task of the sample courses', async () => {
		await env.cleanup();
		env = await setupCourses({ tasksDirectory: SAMPLE_COURSES });
		// e2e_* courses are temporary fixtures installed by integration runs (some invalid on purpose).
		const ids = readdirSync(SAMPLE_COURSES).filter(
			(id) => !id.startsWith('e2e_') && existsSync(join(SAMPLE_COURSES, id, 'course.yaml'))
		);
		expect(ids.length).toBeGreaterThan(20);
		for (const id of ids) {
			const course = c.getCourse(id);
			expect(listTasks(course).size, id).toBe(c.courseTaskIds(course).length);
		}
	});
});
