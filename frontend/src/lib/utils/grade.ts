/**
 * Grade formatting shared by every component showing a grade (ResultBadge,
 * TaskInfo, GradeBar, ...), with the same rounding as the server-side feedback
 * (`submissions/feedback.ts`): at most 2 decimals, trailing zeros trimmed.
 */

/** Rounds a grade (percent) to at most 2 decimals. */
export const roundGrade = (grade: number): number => Math.round(grade * 100) / 100;

/** Formats a grade (percent) for display, e.g. "75.4%", "100%", "33.33%". */
export const formatGrade = (grade: number): string => `${roundGrade(grade)}%`;
