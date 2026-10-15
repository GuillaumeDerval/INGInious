/**
 * Display preferences of the current user (CORE-01 / AUTH-11), shared with
 * every component through a Svelte context set once by the root layout:
 * locale and time zone used by `DateTime`, code indentation used by
 * `CodeEditor`. A context (not a module variable) is used so that concurrent
 * server-side renders never see each other's preferences.
 */
import { getContext, setContext } from 'svelte';

/** Preferences used to format data for the current user. */
export interface UiPrefs {
	/** BCP 47 locale (e.g. "fr", "nb-NO"). */
	locale: string;
	/** IANA time zone (e.g. "Europe/Brussels"). */
	timeZone: string;
	/** Code indentation: "2", "3", "4" or "tabs". */
	indentation: string;
}

/** Context key (exported for tests that render a component with custom preferences). */
export const UI_PREFS_KEY = Symbol('ui-prefs');

/** Defaults used outside of the application shell (e.g. isolated component tests). */
export const DEFAULT_PREFS: UiPrefs = { locale: 'en', timeZone: 'UTC', indentation: '4' };

/** Installs the preferences for the component subtree (call during component init). */
export function setUiPrefs(prefs: () => UiPrefs): void {
	setContext(UI_PREFS_KEY, prefs);
}

/** Returns the preferences of the current subtree (call during component init). */
export function uiPrefs(): () => UiPrefs {
	return getContext<(() => UiPrefs) | undefined>(UI_PREFS_KEY) ?? (() => DEFAULT_PREFS);
}

/** Date format: medium date with or without short time, or explicit `Intl` options. */
export type DateMode = 'datetime' | 'date' | Intl.DateTimeFormatOptions;

/**
 * Formats a date in the user's locale and time zone (DateTime, RichText `<time>`,
 * deadline chips, charts). Single fallback policy: an invalid locale or time zone
 * in the preferences falls back to English / UTC instead of throwing.
 */
export function formatDate(date: Date | string | number, prefs: UiPrefs, mode: DateMode = 'datetime'): string {
	const options: Intl.DateTimeFormatOptions =
		typeof mode === 'object' ? mode : { dateStyle: 'medium', timeStyle: mode === 'date' ? undefined : 'short' };
	const d = new Date(date);
	try {
		return d.toLocaleString([prefs.locale, 'en'], { ...options, timeZone: prefs.timeZone });
	} catch {
		return d.toLocaleString('en', { ...options, timeZone: 'UTC' });
	}
}
