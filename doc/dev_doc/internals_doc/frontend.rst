Web frontend
============

The web frontend is a SvelteKit application located in the ``frontend/`` directory of the repository. It replaces the
former Python frontend (Flask application, Jinja templates and WebDAV server of the ``inginious.frontend`` package)
and is a drop-in replacement for it: it reads the same ``configuration.yaml``, uses the same MongoDB collections and
document format, the same course and task files, and talks to the unchanged backend with the same protocol.

This page gives an overview. The developer documentation of the frontend lives next to its code, in
``frontend/docs/``:

- `architecture.md`_: stack, source layout and coding rules;
- `implementation-guide.md`_: the server modules to reuse, plugins, tests;
- `ux-design.md`_ and `design-system.md`_: user interface conventions and components;
- `features/`_: one use case per feature (actors, flows, permissions, acceptance tests), grouped by area;
- `reference/`_: configuration, database schema, backend protocol, course and task models, LTI, plugin hooks, i18n;
- `performance.md`_: the scale test suite;
- `cli.md`_: the command-line tools.

.. _architecture.md: https://github.com/INGInious/INGInious/blob/main/frontend/docs/architecture.md
.. _implementation-guide.md: https://github.com/INGInious/INGInious/blob/main/frontend/docs/implementation-guide.md
.. _ux-design.md: https://github.com/INGInious/INGInious/blob/main/frontend/docs/ux-design.md
.. _design-system.md: https://github.com/INGInious/INGInious/blob/main/frontend/docs/design-system.md
.. _features/: https://github.com/INGInious/INGInious/tree/main/frontend/docs/features
.. _reference/: https://github.com/INGInious/INGInious/tree/main/frontend/docs/reference
.. _performance.md: https://github.com/INGInious/INGInious/blob/main/frontend/docs/performance.md
.. _cli.md: https://github.com/INGInious/INGInious/blob/main/frontend/docs/cli.md

Stack
-----

- SvelteKit with Svelte 5 and TypeScript, served by ``@sveltejs/adapter-node`` on Node.js 24;
- Skeleton and Tailwind CSS for the user interface;
- the official ``mongodb`` driver (GridFS for the submission inputs and archives);
- ``zeromq`` and ``@msgpack/msgpack`` for the connection to the backend;
- Vitest (unit and component tests) and Playwright (integration tests).

Source layout
-------------

::

    frontend/
      src/
        hooks.server.ts      request pipeline: security headers, session, language, maintenance mode
        routes/              pages and endpoints (thin: they call lib/server and render components)
        lib/
          server/            server-only code
            config.ts          configuration.yaml loading and defaults
            db/                MongoDB connection, typed collections, GridFS
            backend/           ZeroMQ client of the backend
            auth/              passwords, sessions, external authentication methods (OAuth, LDAP, SAML)
            courses/           courses and tasks on disk, accessibility, task dispensers, problem types
            submissions/       submission manager (creation, results, replay)
            lti/               LTI 1.1 and 1.3
            webdav/            WebDAV access to the course files (served under /dav)
            plugins/           plugin hook registry and bundled plugins
            security/          authorization guards, path checks, rate limits
          components/        Svelte components, by area
          i18n/              translation catalogs and t()
      cli/                   inginious-setup, inginious-autotest, inginious-test-task
      e2e/                   Playwright integration tests
      perf/                  scale test suite
      docs/                  developer documentation

Pages load their data on the server (``+page.server.ts``), check the permissions of the user with the guards of
``lib/server/security/guards.ts``, call the domain functions of ``lib/server`` and return plain data to the Svelte
components. Every form and API input is validated, and every text written in reStructuredText or Markdown (task
contexts, feedback, ...) is rendered on the server to sanitized HTML.

Main components
---------------

Users and authentication
    Local accounts (argon2id password hashes, same format as before), sessions stored in MongoDB, and the external
    authentication methods provided by the ``auth`` plugins (GitHub, Google, Facebook, LinkedIn, LDAP, SAML2). An
    external account is bound to an INGInious account (``bindings`` of the user document); users manage their bindings
    in their preferences.

Courses and tasks
    Read from ``tasks_directory`` (``course.yaml``, ``task.yaml``, task files), with the same task dispensers (table of
    contents, combinatory test, contest) and problem types (code, single-line code, file, multiple choice, match).

Submissions
    Created by the task page or the REST API, sent to the backend as jobs, and updated when the backend returns the
    result (see :doc:`submissions`).

LTI
    LTI 1.1 and 1.3 launches and grade publication.

WebDAV
    Course administrators access the files of their courses under ``/dav`` with their username and API key.

Plugins
    See :doc:`/dev_doc/extensions_doc/plugins`.

Developing
----------

::

    $ cd frontend
    $ npm ci
    $ INGINIOUS_CONFIG=/path/to/configuration.yaml npm run dev    # development server with hot reload
    $ npm run check                                               # type checking
    $ npm run lint                                                # formatting and lint

The development server needs a MongoDB database and, to grade submissions, a running backend with its agents.

Tests
-----

Unit and component tests
    Vitest, next to the code (``*.test.ts`` run in Node.js, ``*.svelte.test.ts`` in a browser):
    ``npm run test:unit``.

Integration tests
    Playwright scenarios (``frontend/e2e/``) run against the production build, a MongoDB database, the backend and real
    grading agents: ``npm run test:e2e``. ``frontend/e2e/compose.yml`` starts the services they need.

Scale tests
    ``npm run test:perf`` measures the response times on a generated large data set (thousands of courses and users,
    100,000 submissions on a task) against budgets; see `performance.md`_.

The continuous integration runs these suites.
