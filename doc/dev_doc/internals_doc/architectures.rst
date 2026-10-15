INGInious Architecture
======================

.. _frontend:

Frontend
--------

The web frontend is a Node.js application written with SvelteKit (TypeScript), in the ``frontend/`` directory of the
repository. It is independent from the Python package: it shares no code with the backend and the agents, and
communicates with the backend through its client port (ZeroMQ, messages of ``inginious/common/messages.py``).

Its ``src/routes`` directory contains the pages and endpoints, ``src/lib/server`` the server-side modules (configuration,
database access, backend client, user and submission management, courses and tasks, task dispensers, LTI, WebDAV,
plugins), ``src/lib/components`` the Svelte components, and ``e2e`` and ``perf`` the integration and scale tests.
See :doc:`frontend` for details.

.. _backend:

Backend queue
-------------

Backend package architecture is quite simple to understand are there are two important files. 

First one is ``topic_priority_queue.py`` that defines a queue data structure based on topics. 

The other one is ``backend.py`` which define the all backend logic base on message passing. Backend uses the topic priority queue to handle requests.

.. _agent:

Agent
-----

Agent package is split into python subpackages : Docker and MCQ.

MCQ subpackage defines a class object that implements the MCQ Agent. This comes with translation configuration files.

Docker subpackage also defines a class object that implements Docker Agent. An interface to Docker is also defined as utils for Docker mangement. Finally a timeout interface is also declared to especially manage timeout in agent.