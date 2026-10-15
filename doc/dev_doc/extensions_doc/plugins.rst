Plugins
=======

The web frontend provides a plugin system that allows to register hooks to extend existing features, to add new
pages and to add new authentication methods. The plugins available to administrators are described in
:ref:`plugins`.

Plugins are TypeScript modules bundled with the frontend (``frontend/src/lib/server/plugins/bundled/``). The former
Python plugins (package ``inginious.frontend.plugins`` of the Python frontend) cannot be loaded: an entry of the
``plugins`` configuration list whose ``plugin_module`` is not a bundled plugin is ignored, with a warning in the log.
The plugins of the former frontend were ported and keep their ``plugin_module`` names, so that existing configuration
files keep working.

Writing a plugin
----------------

A plugin is a file ``frontend/src/lib/server/plugins/bundled/<module name>.ts``, where ``<module name>`` is the value
of ``plugin_module`` used in the configuration (e.g. ``inginious.frontend.plugins.scoreboard.ts``). Every such file is
discovered automatically at build time: there is no central list to edit. It must export an ``init`` function:

.. code-block:: typescript

    import type { PluginRegistry } from '../index.js';
    import type { PluginConfig } from '../../config.js';

    /** Called once at start-up, in the order of the `plugins` list of the configuration. */
    export function init(registry: PluginRegistry, options: PluginConfig): void {
        // options is the whole entry of the configuration, e.g.
        // {plugin_module: "inginious.frontend.plugins.myplugin", param1: "value1"}
        registry.addHook('submission_done', ({ submission }) => {
            console.log(`Submission ${String(submission._id)} done.`);
        });
    }

``init`` may be asynchronous. An exception thrown by ``init`` stops the start-up of the frontend.

The ``PluginRegistry`` (``frontend/src/lib/server/plugins/index.ts``) offers:

``addHook(name, callback, prio = 0)``
    Registers ``callback`` for the hook ``name``. Callbacks are called by decreasing priority, then in registration
    order. A callback receives one object with the hook arguments and may be asynchronous. An exception thrown by a
    callback is logged and ignored: the page is still rendered.

``callHook(name, args)``
    Calls every callback of a hook and returns the list of their non-null results.

``callHookRecursive(name, args)``
    Chains the callbacks: each one receives the result of the previous one (``null`` keeps the previous value)
    and the final value is returned.

``isEnabled(module)``
    Whether a plugin is enabled in the configuration.

The process-wide registry is returned by ``plugins()``.

Pages
-----

A plugin page is an ordinary SvelteKit route in ``frontend/src/routes/`` (a ``+server.ts`` endpoint, or a
``+page.server.ts`` and a ``+page.svelte`` page). It starts by calling ``requirePlugin(module)``, which answers
*404 Not found* when the plugin is not enabled, then checks the permissions of the user with the guards of
``frontend/src/lib/server/security/guards.ts``. For instance, the page of the ``demo`` plugin
(``frontend/src/routes/plugindemo/+server.ts``):

.. code-block:: typescript

    import { requirePlugin } from '#lib/server/plugins/index.js';
    import type { RequestHandler } from './$types';

    export const GET: RequestHandler = () => {
        requirePlugin('inginious.frontend.plugins.demo');
        return new Response('This is a simple demo plugin', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    };

Other extension points
----------------------

- Authentication methods: OAuth providers are registered with ``registerOAuth`` (``frontend/src/lib/server/auth/oauth.ts``),
  other methods with the ``authMethods`` registry (``frontend/src/lib/server/auth/external.ts``); see the ``auth``
  plugins for examples.
- Problem types: ``registerProblemType`` (``frontend/src/lib/server/courses/problems.ts``) registers how the answer
  of a problem type is read, validated and stored. Its display is a Svelte component of
  ``frontend/src/lib/components/task/``.
- Grading jobs: the backend client (``services().backend``, ``frontend/src/lib/server/backend/client.ts``) runs jobs,
  including jobs that belong to no task (see :doc:`taskless_jobs`).

List of hooks
-------------

Each hook available in the frontend is described here, with its arguments. The hooks return data (links, fields),
never HTML: the frontend renders them.

``main_menu`` ()
    Returns : ``NavItem`` (``{label, href}``) or null.

    Adds a link to the main menu (e.g. the ``upcoming_tasks`` plugin).

``course_menu`` (``course``, ``username``)
    Returns : a ``NavItem`` or a list of ``NavItem``, or null.

    Adds links to the menu of a course (e.g. scoreboards, contests).

``task_menu`` (``course``, ``task``)
    Returns : ``{label, href}`` or null.

    Adds a link to the menu of a task page.

``course_admin_menu`` (``course``)
    Returns : ``NavItem`` or null.

    Adds a link to the course administration menu.

``task_editor_tab`` (``course``, ``taskid``, ``task_data``)
    Returns : ``{id, label, text?, fields}`` or null.

    Adds a tab to the task editor. ``fields`` is a list of field descriptions (``FieldSpec``, see
    ``frontend/src/lib/components/course-admin/specs.ts``): their values are stored as top-level keys of ``task.yaml``.
    See the ``task_editor_hook_example`` plugin.

``task_editor_submit`` (``course``, ``taskid``, ``task_data``)
    Returns : an error message, or null.

    Called when a task is saved from the editor, before it is validated and written. Callbacks may modify
    ``task_data``; the first error message cancels the save and is shown to the user.

``new_submission`` (``submission``, ``inputdata``)
    Returns : nothing.

    Called when a submission is created, before it is stored and sent to the backend. Callbacks may modify
    ``submission`` and ``inputdata`` (for instance, to add ``@``-prefixed input fields).

``submission_done`` (``submission``, ``course``, ``archive``, ``newsub``)
    Returns : nothing.

    Called when a submission has been graded and stored. ``archive`` is the archive returned by the grading container
    (or null) and ``newsub`` is false when the submission was replayed in place. See the ``git_repo`` plugin.

``feedback_title`` (``submission``, ``title``) -- recursive
    Returns : the object received, with a possibly modified ``title``.

    Changes the title of the feedback of a graded submission.

The other hooks of the former Python frontend (``css``, ``javascript_header``, ``javascript_footer``,
``header_html``, ``template_helper``, ``task_list_item``, ``submission_admin_menu``, ``prefs_menu``,
``task_context``, ``course_accessibility``, ``course_allow_unregister``, ``feedback_text``, ``feedback_script``)
are not called by the frontend. The complete reference, with the call sites of the former frontend, is
`frontend/docs/reference/plugin-hooks.md`_; the conventions to follow when adding code to the frontend are described in
`frontend/docs/implementation-guide.md`_.

.. _frontend/docs/reference/plugin-hooks.md: https://github.com/INGInious/INGInious/blob/main/frontend/docs/reference/plugin-hooks.md
.. _frontend/docs/implementation-guide.md: https://github.com/INGInious/INGInious/blob/main/frontend/docs/implementation-guide.md
