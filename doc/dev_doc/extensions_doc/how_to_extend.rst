How to extend INGInious
=======================

Creating a new frontend
-----------------------

INGInious is mainly a backend that is agnostic. It can be used to run nearly everything.
The backend's code is in :ref:`backend`. A frontend is a *client* of the backend: it connects to the client port of
``inginious-backend`` (ZeroMQ ``DEALER`` socket) and exchanges the msgpack-encoded messages defined in
``inginious/common/messages.py`` (``ClientNewJob``, ``BackendJobDone``, ``ClientKillJob``, ``ClientGetQueue``, ...).

The web frontend given with INGInious (``frontend/``) is such a client, written in TypeScript
(``frontend/src/lib/server/backend/client.ts``). You can use it as an example on how to write a new client; the
protocol is described in `frontend/docs/reference/backend-protocol.md`_. The Python client package
(``inginious.client``) of the former frontend has been removed.

.. _frontend/docs/reference/backend-protocol.md: https://github.com/INGInious/INGInious/blob/main/frontend/docs/reference/backend-protocol.md

Extending the web frontend
--------------------------

The web frontend can be extended with plugins (see :doc:`plugins`). Its architecture is described in
:doc:`/dev_doc/internals_doc/frontend`.

Creating a new agent/environment type
-------------------------------------

An agent receives `submissions` and grades them. For this, it must implement the class `Agent`.

You will probably want to start from the very simple `MCQAgent` and extend from that.

Your agent may need some parameters to run correctly, these parameters depending from task to task.
INGInious sends, inside each submission, a dictionnary called `environment_parameters`. This dictionnary is filled
as the frontend wants it to be filled, so you must add some behavior into the frontend for it to send what you want.

In the web frontend, the environment parameters are those of the ``environment_parameters`` key of ``task.yaml``.
The known environment types are validated in ``frontend/src/lib/server/courses/task.ts`` and the fields shown by the
task editor for each of them are defined in ``frontend/src/lib/components/course-admin/specs.ts`` (see `frontend/docs/features/site/24-environment-types.md`_).

.. _frontend/docs/features/site/24-environment-types.md: https://github.com/INGInious/INGInious/blob/main/frontend/docs/features/site/24-environment-types.md

Special environment parameters
------------------------------

INGInious as a whole (i.e. both the backend and the frontend) look for specific environment parameters. They are
not mandatory.

``limits[time]``

    An **expected** timeout in seconds. Allows INGInious to predict the size of the queue, and maybe other things in the
    future. Any value above (>=) 0 is taken into account. Any value below (<) will be displayed as "unknown".
