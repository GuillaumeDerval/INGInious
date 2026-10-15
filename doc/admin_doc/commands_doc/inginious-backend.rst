.. _inginious-backend:

inginious-backend
=================

Start an INGInious backend. It connects to the agent address of :ref:`inginious-backend`. The web frontend does not start agents: at least one
Docker agent (and an MCQ agent for multiple-choice tasks) must be running.

.. program:: inginious-backend

::

    inginious-backend [-h] [-v] agent client

.. option:: -h, --help

   Display the help message.

.. option:: -v, --verbose

   Increase output verbosity: logging level to DEBUG.

.. option:: agent

    The agents port, using the following syntax : ``protocol://host:port``. E.g. ``tcp://127.0.0.1:2001``.
    The backend will listen for grading agents on that port.

.. option:: client

    The clients port, using the following syntax : ``protocol://host:port``. E.g. ``tcp://127.0.0.1:2000``.
    The backend will listen for client frontend on that port.
