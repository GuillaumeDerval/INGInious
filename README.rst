INGInious
=========

.. image:: https://app.codacy.com/project/badge/Grade/a555b98bda7444d8afcd06963178193d
   :alt: Codacy Badge
   :target: https://app.codacy.com/gh/INGInious/INGInious/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade
.. image:: https://app.codacy.com/project/badge/Coverage/a555b98bda7444d8afcd06963178193d
   :alt: Codacy coverage Badge
   :target: https://app.codacy.com/gh/INGInious/INGInious/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_Coverage
.. image:: https://github.com/INGInious/INGInious/actions/workflows/ci.yml/badge.svg
   :target: https://github.com/INGInious/INGInious/actions
.. image:: https://readthedocs.org/projects/inginious/badge/?version=latest
   :target: https://readthedocs.org/projects/inginious/?badge=latest
.. image:: https://weblate.info.ucl.ac.be/widgets/inginious/-/frontend/svg-badge.svg
   :target: https://weblate.info.ucl.ac.be/engage/inginious/?utm_source=widget

INGInious is an intelligent grader that allows secured and automated testing of code made by students.

It uses Docker_ to run student's code inside a secured environment.

INGInious provides a backend which manages interaction with Docker and grade code (Python package ``inginious``), and a web frontend which allows students to submit their code (SvelteKit application in the ``frontend/`` directory, running on Node.js). The frontend also includes an administration interface that allows teachers to check the progression of their students and to modify exercices in a simple way.

INGInious can be used as an external grader for Moodle or edX. The course `Constraint Programming`_ uses INGInious to correct students' code.

.. _Docker: https://www.docker.com/
.. _Constraint Programming: https://www.edx.org/learn/computer-programming/universite-catholique-de-louvain-constraint-programming

How to install?
---------------

Simply run:

.. code-block::

   $ docker compose up --build

And access https://localhost in your browser.

*The default login and password are* ``superadmin``.

You may alternatively add ``127.0.0.1 inginious.local`` to your ``/etc/hosts`` file and access https://inginious.local in your browser.

The superadmin account is configurable at the database instantiation through 6 environment variables to specify in the `docker-compose.yml` file:

* INGINIOUS_SUPERADMIN_PASSWORD: Sepcifies the superadmin password. **MUST BE ENCODED WITH argon2id.**
* INGINIOUS_SUPERADMIN_USERNAME: Defines the superadmin username. Defaults to `"superadmin"` if not provided.
* INGINIOUS_SUPERADMIN_REALNAME: Defines the superadmin real name. Defaults to `"INGInious superadmin"` if not provided.
* INGINIOUS_SUPERADMIN_EMAIL: Defines the superadmin email address. Defaults to `"superadmin@inginious.org"`.
* INGINIOUS_SUPERADMIN_LANG: Defines the superadmin language. Defaults to `"en"`.
* INIGNIOUS_SUPERADMIN_INDENT: Defines the text indentation (in number of spaces) for the superadmin account. Defaults to `"4"`.

Currently supported **INGINIOUS_SUPERADMIN_LANG** values are:

======= ========
Code    Language
======= ========
`en`    English
`el`    Greek
`es`    Spanish
`fr`    French
`he`    Hebrew
`nl`    Dutch
`nb_NO` Norwegian
`pt`    Portuguese
`vi`    Vietnamese
======= ========

Currently supported **INGINIOUS_SUPERADMIN_INDENT** values are: "2", "3", "4" and "tabs".

.. _Caddyfile documentation: https://caddyserver.com/docs/caddyfile

The INGInious frontend is exposed via the Caddy reverse proxy. A sample configuration file is located at `deploy/Caddyfile`.
Refer to the `Caddyfile documentation`_ for more advanced proxy configuration.

The ``--build`` argument is optional, use it if you want to rebuild locally the core containers.
If you want to simply pull them from the project's registry, this argument is not required.

*Note that you can override the registry and containers version by setting the `REGISTRY` and `VERSION` environment variables.*

Docker-compose will create a ``tasks`` folder if it does not exist already.

You can then add new courses to your fresh INGInious instance by installing them in the ``tasks`` folder.

For example, the INGInious tutorial course is installed with the following commands:

.. code-block::

   $ git clone https://github.com/INGInious/demo-tasks.git
   $ mv demo-tasks/tutorial tasks/

*If you encounter permission errors, you should run the following command:*

.. code-block::

   $ sudo chown -R <your_user>:<your_user_group> tasks

*This can happen when the tasks directory is created by docker-compose.*

Note that the ``configuration.deploy.yaml`` file provided is a sample configuration, the secret key **must** be changed by administrators in production deployments.
Set also ``base_url`` and ``webdav_host`` in that file to the public URL of your instance (the frontend gets that URL from Caddy's ``X-Forwarded-*`` headers).
WebDAV access to the course files is served by the frontend under ``/dav``.

.. _env-base: https://github.com/INGInious/INGInious/tree/main/base-containers/base
.. _env-default: https://github.com/INGInious/INGInious/tree/main/base-containers/default

The provided ``docker-compose.yaml`` file builds from sources the basic grading environments `env-base`_ and `env-default`_.
It also pulls from the project's registry a basic ``python3`` grading environment.
These three environments are sufficient for a simple INGInious deployment.

Administrators can add grading environments to their instance either by adding them statically to the ``docker-compose.yaml`` file or by pulling them manually from the container registry.

.. _Manual installation: https://docs.inginious.org/en/latest/admin_doc/install_doc/installation.html

`Manual installation`_ is also possible: the backend and the agents are installed with pip, and the frontend is built with npm:

.. code-block::

   $ cd frontend
   $ npm ci && npm run build
   $ INGINIOUS_CONFIG=/path/to/configuration.yaml PORT=8000 PROTOCOL_HEADER=x-forwarded-proto HOST_HEADER=x-forwarded-host node build   # behind a reverse proxy

The frontend uses the same ``configuration.yaml`` and the same MongoDB database as the former Python frontend (``inginious-webapp``), which it replaces.

Documentation
-------------

The documentation is available on Read the Docs:

- For the latest published version on PyPI : https://docs.inginious.org/
- For the master (dev) branch (not always up to date) : http://docs.inginious.org/en/latest/index.html

On Linux, run ``make html`` in the directory ``/doc`` to create a html version of the documentation.
The developer documentation of the frontend is in ``frontend/docs``.

Roadmap
-------

INGInious is continuously improved. The various Work In Progress tasks are described in the Roadmap_ of the project.
 
 .. _Roadmap: https://github.com/UCL-INGI/INGInious/wiki/Roadmap
 
Notes on security
-----------------

Docker containers can be used securely with SELinux enabled. Please do not run untrusted code without activating SELinux.

