.. _inginious-agent-mcq:

inginious-agent-mcq
===================

Start a MCQ grading agent. It connects to the agent address of :ref:`inginious-backend`. The web frontend does not start agents: at least one
Docker agent (and an MCQ agent for multiple-choice tasks) must be running.

.. program:: inginious-agent-mcq

::

    inginious-agent-mcq [-h] [--tasks TASKS] [-v] backend

.. option:: -h, --help

   Display the help message.
.. option:: --tasks TASKS

   The path to the directory **containing the courses**. Default to ``./tasks``.

.. option:: -v, --verbose

   Increase output verbosity: logging level to DEBUG.

.. option:: backend

   The backend port, using the following syntax : ``protocol://host:port``. E.g. ``tcp://127.0.0.1:2001``.
   The agent will connect to the backend listening on that port.
