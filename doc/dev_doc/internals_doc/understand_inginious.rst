Understand INGInious
====================

INGInious is made from several different packages:

- The common package (``inginious.common``) which contains basic blocks shared by the backend and the agents, like
  the messages exchanged between them and the task file parsing.
  The common package does not need the :ref:`backend` nor the :ref:`frontend`;
- The :ref:`agent`, that runs jobs. It interacts directly with Docker to start new containers, and sends the grades back to the backend.
  A specific part of the :ref:`backend` is in charge of starting the agents automatically; you most of time won't need to it manually.
  The agent needs to be run *on* the Docker host, as it interacts with other containers with Unix sockets, and must also interact with CGroups
  to allow a very fine management of timeouts and memory limits.
- The :ref:`backend`, which is in charge of handling grading requests, giving the work to distant agents;
  the backend is made to be simple and frontend-agnostic; you can 'easily' replace the frontend by something else.
  The backend only store information about *running* tasks. This point is important when considering replication and horizontal scalability (see
  later)
- The :ref:`frontend` which is a web interface for the backend. It provides a simple yet powerful interface for students and teachers.
  It is a Node.js application (SvelteKit) and acts as a *client* of the backend.
  It is made to be "stateless": all its persistent state is stored in DB.

The backend, the agents and the common package form the Python package ``inginious``; the frontend lives in the
``frontend/`` directory of the repository.

Basic architecture of INGInious
-------------------------------
The following schema shows the basic architecture of INGInious:

.. image:: /dev_doc/internals_doc/inginious_arch.png
    :align: center

Scalability of Docker hosts
---------------------------
In order to share the work between multiple servers, INGInious can use multiple agents, as shown in the following schema.
The completely horizontal scalability is (nearly) without additional configuration, and can be made fully automatic with a bit of work.

.. image:: /dev_doc/internals_doc/inginious_arch_docker.png
    :align: center

Scalability of the INGInious frontend
-------------------------------------
As the backend only stores information about *running* submission, and the frontend keeps its persistent state in
MongoDB, we can use the replication feature of MongoDB to scale horizontally the frontends too. Note that some
short-lived data is kept in the memory of each frontend process: the login rate limits are counted per process, and the
results of the asynchronous jobs of the ``simple_grader`` plugin must be fetched from the process that started them.
The (final) schema below shows the most advanced way of configuring INGInious,
with multiple frontends replicated and multiple Docker hosts.

.. image:: /dev_doc/internals_doc/inginious_arch_full.png
    :align: center

Grading containers and student containers
-----------------------------------------

A *grading container* is a container that do the grading. It typically runs a script made by a teacher or its assistants, a launch sub-containers,
called *student containers*, that will separately jail code made by students.

A single *grading container* can launch more than one *student container*; the interaction between the two is completely secured by the agent.

Jobs
----

When you send a student's input to the backend, it creates what we call a *job*.
Jobs are sent by a *Client* (the backend client of the frontend, ``frontend/src/lib/server/backend/client.ts``), which
itself is a simple communication layer to a job queue that we call the *Backend*.
The *Backend* itself can be used by multiple *Clients*, and dispatch jobs among *Agents*, which can be of different types (for now, we have two
kinds of agents, *DockerAgent* and *MCQAgent*)

When a job is submitted, a callback must be given: it is automatically called when the task is done, asynchronously.

Submission
----------

A submission is an extension of the concept of job. A submission only exists in the
frontend, and it is mainly a job saved to db.
