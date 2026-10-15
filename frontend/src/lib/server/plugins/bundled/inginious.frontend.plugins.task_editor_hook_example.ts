/**
 * Port of the legacy "task_editor_hook_example" plugin (SITE-17, CADM-13):
 * two extra tabs in the task editor, the second one with a "Task hint" field
 * (stored as the top-level task key `example_task_hint`), and a submit hook
 * that adds `example_field: test` and refuses tasks without a hint.
 * Tabs are data (text + field specs), never raw HTML.
 */
import type { Course } from '../../courses/course.js';
import type { EditorTab } from '../../course-admin/task-editor.js';
import type { PluginRegistry } from '../index.js';

/** Arguments of the task editor hooks. */
interface EditorArgs {
	course: Course;
	taskid: string;
	task_data: Record<string, unknown>;
}

/** Registers the two tabs and the submit check. */
export function init(registry: PluginRegistry): void {
	registry.addHook<EditorArgs, EditorTab>('task_editor_tab', () => ({
		id: 'tab_example',
		label: 'Example tab',
		text: 'This is a test',
		fields: []
	}));
	registry.addHook<EditorArgs, EditorTab>('task_editor_tab', ({ course, taskid, task_data }) => ({
		id: 'tab_example_2',
		label: 'Example tab 2',
		text: `This is an example tab for course "${course.name}" (id: "${course.id}"), and task "${taskid}". We can show data from the task descriptor, such as the name "${String(task_data.name ?? '')}". We can also include some data for a form (note that form data needs to be processed by a separate hook):`,
		fields: [{ key: 'example_task_hint', label: 'Task hint', kind: 'text', optional: true }]
	}));
	registry.addHook<EditorArgs, string>('task_editor_submit', ({ task_data }) => {
		task_data.example_field = 'test';
		return task_data.example_task_hint ? null : 'You must provide a task hint in Example tab 2';
	});
}
