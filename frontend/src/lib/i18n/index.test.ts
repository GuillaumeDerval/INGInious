/**
 * Unit tests of the i18n helpers (AUTH-10).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { t, format, loadCatalog, setCatalogGetter, negotiateLanguage, isRtl, LANGUAGES } from './index.js';

afterEach(() => setCatalogGetter(() => ({})));

describe('format', () => {
	it('supports positional and named placeholders', () => {
		expect(format('{} and {}', 'a', 'b')).toBe('a and b');
		expect(format('{n} tasks', { n: 3 })).toBe('3 tasks');
		expect(format('{} {missing} {5}', 'only')).toBe('only {missing} {5}');
	});
});

describe('t', () => {
	it('returns the msgid when untranslated and formats it', () => {
		expect(t('Hello {}', 'Bob')).toBe('Hello Bob');
		expect(t('')).toBe('');
	});

	it('uses the current catalog', async () => {
		const fr = await loadCatalog('fr');
		setCatalogGetter(() => fr);
		expect(t('Sign in')).not.toBe('Sign in');
		expect(t('Sign in')).toBe(fr['Sign in']);
	});

	it('has an empty catalog for English and unknown languages', async () => {
		expect(await loadCatalog('en')).toEqual({});
		expect(await loadCatalog('xx')).toEqual({});
	});
});

describe('negotiateLanguage', () => {
	it('matches the best supported language', () => {
		expect(negotiateLanguage('de')).toBe('de');
		expect(negotiateLanguage('fr-BE,fr;q=0.9,en;q=0.8')).toBe('fr');
		expect(negotiateLanguage('nb-NO')).toBe('nb_NO');
		expect(negotiateLanguage('nb')).toBe('nb_NO');
		expect(negotiateLanguage('ja,es;q=0.5')).toBe('es');
		expect(negotiateLanguage('es;q=0.2,de;q=0.9')).toBe('de');
		expect(negotiateLanguage('fr;q=0')).toBe('en');
		expect(negotiateLanguage('')).toBe('en');
		expect(negotiateLanguage(null)).toBe('en');
	});
});

describe('isRtl', () => {
	it('flags Hebrew only', () => {
		expect(isRtl('he')).toBe(true);
		expect(Object.keys(LANGUAGES).filter(isRtl)).toEqual(['he']);
	});
});
