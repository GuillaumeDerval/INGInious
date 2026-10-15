Updating INGInious
==================

Updating a docker compose deployment
------------------------------------

From the clone of the repository:
::

    $ git pull
    $ docker compose up --build -d

Updating the sources
--------------------

To fetch the latest updates of the backend and the agents on the Git repository master branch :
::

   $ pip install --upgrade git+https://github.com/INGInious/INGInious.git

The frontend is rebuilt from an updated clone of the repository, then restarted:
::

    $ git pull
    $ cd frontend
    $ npm ci
    $ npm run build

Migrating from the Python frontend
----------------------------------

The frontend in ``frontend/`` replaces the former Python frontend (``inginious-webapp`` and ``inginious-webdav``,
package ``inginious.frontend``), which is no longer part of INGInious. It uses the same database, the same course and
task files and the same configuration file, so no data migration is needed:

#. Stop ``inginious-webapp`` and ``inginious-webdav``.
#. If the configuration uses ``backend: local``, start ``inginious-backend`` and the agents separately (see
   :ref:`config`) and set ``backend`` to the client address of the backend. Move the ``local-config`` options to the
   options of :ref:`inginious-agent-docker`.
#. Add ``base_url`` (and set ``webdav_host`` to ``<public URL>/dav`` if you used WebDAV). See :ref:`ConfigReference`.
#. Check the ``plugins`` list: the bundled plugins keep their ``plugin_module`` names, other Python plugins are ignored
   (see :ref:`plugins`). The ``simple_grader`` plugin now requires an ``api_key`` option.
#. Build and start the frontend (see :ref:`config`), and point the reverse proxy to it. The WebDAV service is not
   needed anymore: WebDAV is served by the frontend under ``/dav``.

The ``inginious-install`` command is replaced by :ref:`inginious-setup`, and ``inginious-autotest`` and
``inginious-test-task`` are now shipped with the frontend (see :ref:`inginious-autotest` and :ref:`inginious-test-task`).

Updating your containers
------------------------

The provided containers can be automatically updated using:
::

    $ inginious-container-update

This will download containers images on docker-hub based on the locally installed INGInious version.
Please note, if you have not pip-installed INGInious but are running a dev version cloned from the repository,
you should manually build your containers to take into consideration local changes.
If you are in this situation or if you want to add new containers, please refer to :ref:`new_container`.

Updating the configuration
--------------------------

Most of the time, you won't need to update your configuration. The new or changed entries are described in
:ref:`ConfigReference`.

Updating the database
---------------------

The database scheme may have changed since the last INGInious release. A tool is available to do this migration
automatically from your configuration file. Please refer to :ref:`inginious-database-update`. The frontend refuses
to start until the database is up to date.

To update the database in a `compose`-based installation, you may run the following command in the root of the project:
::

	$ docker run --network inginious_inginious -v ./configuration.deploy.yaml:/db/config.yml -v ./inginious/scripts/database_update.py:/db/db.py:z -w /db -it ghcr.io/inginious/core-base:main python3 db.py -c config.yml
