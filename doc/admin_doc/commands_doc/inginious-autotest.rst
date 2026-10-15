.. _inginious-autotest:

inginious-autotest
==================

Assistant to test automatically the content and the format of the ``task.yaml`` files of a course and to check that the
output of the recorded submissions (``test/`` folder of each task) is consistent with the output obtained when they are
graded again.

The test files of a task are situated in a ``test/`` folder which is a sub directory of the task directory, at the same
level as the ``task.yaml``. Each one is a YAML file containing ``courseid``, ``taskid``, ``input`` and the expected
``result``, ``grade``, ``problems``, ``tests``, ``custom``, ``state``, ``stdout`` and ``stderr``.

For every task of the course, the tool checks that ``task.yaml`` loads and that its context and problem headers render
without reStructuredText warning, then re-grades each recorded submission and compares the outputs (keys missing on
either side and archives are ignored). Failures are printed as JSON (``{path: {key: [recorded, new]}}``, or the content
of an invalid ``task.yaml``), or written to ``FILE`` with ``-f``. The exit code is 66 when a check fails or an error
occurs (e.g. ``Environment not available``), 0 otherwise.

The command is shipped with the frontend: build it with ``npm run build:cli`` in the ``frontend/`` directory, then
run it with ``npx inginious-autotest`` from that directory. It connects to a running backend (with its agents); it does
not start one.

.. program:: inginious-autotest

::

    inginious-autotest [-h] [--logging] [-f FILE] [-b BACKEND] [--tdisp TDISP ...] [--ptype PTYPE ...] task_dir course_dir

.. option:: -h, --help

   Display the help message.

.. option:: --logging

   Print each replayed file on the standard error.

.. option:: -f FILE

    Write the output in a json format in the specified file in case of failure

.. option:: -b BACKEND

    Client address of the backend. Defaults to ``tcp://127.0.0.1:2000``.

.. option:: --ptype PTYPE [PTYPE ...]

    Additional problem type names used by the tasks (e.g. problem types provided by plugins). They are loaded as
    generic problems, so that the tasks load; the agents grade them.

.. option:: --tdisp TDISP [TDISP ...]

    Accepted for compatibility and ignored (an unknown task dispenser falls back to the table of contents).

.. option:: task_dir

    Path to the courses directory of inginious, corresponds to field ``tasks_directory`` in the ``configuration.yaml``

.. option:: course_dir

    Path to the course directory to test

Differences with the former Python command: it uses a running backend instead of starting a local Docker backend,
``--ptype`` takes problem type names instead of Python classes, the JSON output is compact, tasks and test files are
processed in name order, and an invalid course is an error (exit code 66).
