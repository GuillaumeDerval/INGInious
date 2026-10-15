Exercises
=========

INGInious proposes by default several types of exercises. This lets teachers make various exercises and diversified course.
Those types can be Code and Single line code, Multiple choices, File upload or Match.

Every type of exercise must implement Problem class which is the basic problem class. This class defines some abstract methods that will be overwritten in the different types of exercise.

They all defined the ``check_answer`` method that should return True if the answer is valid, False if not and None if the check must be done in a virtual machine.

Problem types
-------------

Code and Single Line Code
^^^^^^^^^^^^^^^^^^^^^^^^^

Those are present together as Single Line Code is a child class of Code problem.
Both took code as input which can be use after by the teacher through the run file.
They both defined there ``check_answer`` method with the None value as the code must be send to a virtual machine.

File upload
^^^^^^^^^^^

This problem takes a file as input. The ``check_answer`` method also return a None value to let the teacher run specific test through the virtual machine.
Two specific properties are also defined to limit file extensions and file size.

Multiple choices
^^^^^^^^^^^^^^^^

This classical multiple choices problem defines the most basic exercise type. It takes the selected answer(s) and calculate validation immediately (no virtual machine needed).

Match
^^^^^

This problem type simply verify that expected value and answer are strictly equal.


Custom exercises definition
---------------------------

In the web frontend, a problem type is a ``ProblemType`` object registered with ``registerProblemType``
(``frontend/src/lib/server/courses/problems.ts``). It defines how the answer is read from the submitted form, how the
problem definition of ``task.yaml`` is validated, how an answer is checked before being stored, and the data given to
the task page. The grading itself is done by the grading environment. A plugin (see
:doc:`/dev_doc/extensions_doc/plugins`) can register a new type in its ``init`` function.


Problem display
---------------

Once your problem is defined, you'll probably need to display this in the frontend.
The problems are displayed by the Svelte components of ``frontend/src/lib/components/task/`` (``CodeProblem``,
``FileProblem``, ``ChoiceProblem``, ...), and edited in the task editor with the field descriptions of
``frontend/src/lib/components/course-admin/specs.ts``. A new type needs its own component and editor fields.

Problem types of the former Python frontend (``DisplayableProblem`` subclasses provided by Python plugins) are not
loaded. The command-line tools accept their type names so that the tasks using them can be tested
(see :ref:`inginious-autotest`).
