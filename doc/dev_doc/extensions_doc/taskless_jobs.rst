Taskless jobs
=============

INGInious can handle taskless jobs. That means jobs that are not linked to a task or course.
They can be used to run background jobs without needing to create a course.

In the web frontend, a taskless job is started with the ``newJob`` method of the backend client
(``services().backend``, see ``frontend/src/lib/server/backend/client.ts``) with ``courseId`` and ``taskId`` set to
``null``. Any other client of the backend can do the same by sending a ``ClientNewJob`` message with no course and no
task (see ``inginious/common/messages.py``). You can create and provide any environment based on the base environment.

^^^^^^^^^^^
Hello World
^^^^^^^^^^^

Here is an example of a taskless job running a simple Hello World script and returning it as feedback. You can use the
``input`` to provide any data you want to provide to the job. You can then retrieve it with the get_input INGInious API.
The environment, as any other grading environment is based on the INGInious base environment.

This is what the ``taskless-hello-world`` plugin does
(``frontend/src/lib/server/plugins/bundled/inginious.frontend.plugins.taskless-hello-world.ts``). Its default
environment, ``taskless-hello-world``, must be available on a Docker agent: its source is in
``base-containers/taskless-hello-world`` (``docker build -t taskless-hello-world base-containers/taskless-hello-world``,
after building the base environment). The ``environment`` and ``run_cmd`` options of the plugin allow to use another
environment (see :ref:`plugins`).


"""""""""""""""
Running the job
"""""""""""""""

.. code-block:: typescript

    import { services } from '../../app.js';

    const { backend } = services();
    const jobId = backend.newJob(
        {
            priority: 0,
            courseId: null,
            taskId: null,
            problems: {},
            input: { hello_world_name: 'John Doe' },
            environmentType: 'docker',
            environment: 'taskless-hello-world',
            environmentParameters: {},
            debug: false,
            launcher: 'Plugin - taskless Hello World'
        },
        { onDone: (result) => console.log(result.result) } // [status, feedback]
    );

``onDone`` is always called exactly once, with a ``crash`` result if the backend becomes unreachable. A job whose
environment is provided by no agent stays in the backend queue: use ``backend.killJob(jobId)`` to stop it after a
timeout.

^^^^^^^^^^^^^^^^^
Unreachable paths
^^^^^^^^^^^^^^^^^

**Please be advised** : The `/task` and `/course/common` paths are mounted during the container's creation. Therefore, any
runfile or ressource you put in these paths in your job's Docker image won't be accessible.
