.. _inginious-setup:

inginious-setup
===============

Assistant to create a configuration file for the INGInious frontend. It replaces the ``inginious-install`` command of
the former Python frontend.

It is shipped with the frontend: build it with ``npm run build:cli`` in the ``frontend/`` directory, then run it with
``npx inginious-setup`` from that directory (or ``node build-cli/inginious-setup.js``; ``npm link`` puts the
commands on the ``PATH``).

Every setting that is not given as an option is asked (``question [default]:``; an empty answer keeps the default,
``--default`` answers every remaining question with its default). The tool then:

#. checks that MongoDB is reachable (an error stops the tool) and that the backend is reachable (a warning only);
#. creates the tasks and backup directories;
#. creates the superadmin account in the database (password hashed with argon2id), unless the login already exists;
#. writes the configuration file with ``backend``, ``mongo_opt``, ``tasks_directory``, ``backup_directory``,
   ``superadmins``, ``session_parameters`` (new random ``secret_key``, ``timeout`` of 86400 seconds, ``secure``
   according to ``--https``) and, when given, ``smtp`` and ``webdav_host``.

Nothing is written when an error occurs. The exit code is 0 on success and 1 on error. The other entries of the
configuration (``base_url``, ``plugins``, ...) are added by hand, see :ref:`ConfigReference`.

Unlike ``inginious-install``, it does not configure a local backend, build or download containers, download the demo
tasks, nor ask for LDAP or webterm settings: the backend and the agents are started separately
(see :ref:`config`).

.. program:: inginious-setup

::

    inginious-setup [-h] [--file FILE] [--default] [--backend ADDR] [--mongo-host HOST] [--mongo-database NAME]
                    [--tasks-directory DIR] [--backup-directory DIR] [--superadmin LOGIN] [--superadmin-name NAME]
                    [--superadmin-email EMAIL] [--superadmin-password PASSWORD] [--https yes|no]
                    [--smtp-host HOST] [--smtp-port PORT] [--smtp-sender FROM] [--webdav-host URL]

.. option:: -h, --help

   Display the help message.

.. option:: --file FILE

   Configuration file to write. Defaults to ``./configuration.yaml``.

.. option:: --default

   Use the default value of every setting not given as an option, without asking.

.. option:: --backend ADDR

   Client address of the backend, e.g. ``tcp://127.0.0.1:2000``.

.. option:: --mongo-host HOST

   MongoDB host (or ``mongodb://`` URI).

.. option:: --mongo-database NAME

   MongoDB database name.

.. option:: --tasks-directory DIR

   Tasks directory (created if needed).

.. option:: --backup-directory DIR

   Backup directory (created if needed).

.. option:: --superadmin LOGIN, --superadmin-name NAME, --superadmin-email EMAIL, --superadmin-password PASSWORD

   Login, real name, e-mail address and password of the superadmin account.

.. option:: --https yes|no

   Whether the instance is served over HTTPS (sets ``session_parameters.secure``).

.. option:: --smtp-host HOST, --smtp-port PORT, --smtp-sender FROM

   SMTP server, port and sender address used to send e-mails.

.. option:: --webdav-host URL

   Public URL of the WebDAV access, e.g. ``https://inginious.example.org/dav``.
