.. _inginious-test-task:

inginious-test-task
===================

This tool replays submissions of a given course to ensure that its task's grading processes
are consistent over time.

It reads the configuration file of the instance, connects to its backend and replays the ``<task>/test/*.test``
submissions of the given tasks, checking the global result and every recorded test tag. The verification of a
specific task may be skipped by adding a ``.testignore`` file in the task directory. The report is printed on the
standard output; the exit code is 1 when a test failed, 0 otherwise.

The command is shipped with the frontend: build it with ``npm run build:cli`` in the ``frontend/`` directory, then
run it with ``npx inginious-test-task`` from that directory.

.. program:: inginious-test-task

::

    inginious-test-task [-h] [-c CONFIG] [-v] [-p [PLUGINS ...]] courseid [taskids ...]

.. option:: -h, --help

   Display the help message.

.. option:: -c CONFIG, --config CONFIG

   Path towards the INGInious instance configuration file. Defaults to ``./configuration.yaml`` (or
   ``./configuration.json``).

.. option:: -v, --verbose

   Display the output of the grading containers.

.. option:: -p [PLUGINS ...], --plugins [PLUGINS ...]

   Names of additional problem types used by the course's tasks (e.g. ``pl``). They are loaded as generic problems,
   so that the tasks load; the agents grade them.

.. option:: courseid

    Course ID of the course to test, e.g., linfo1140. It should match the name of the corresponding
    course directory in the ``tasks`` directory.

.. option:: taskids

    If specified, a list of tasks to test. If none is given, all the task of the course are replayed.

Differences with the former Python command (``inginious-test-task``, documented as ``inginious-task-test``): it waits
until the backend announced its environments (at most 15 seconds), ``-p`` takes problem type names instead of Python
plugin modules, tag values are compared deeply and printed as JSON, and tasks are processed in name order.
