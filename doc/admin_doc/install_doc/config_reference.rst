.. _ConfigReference:

Configuration reference
=======================

.. HINT::
    A first configuration file can be generated with :ref:`inginious-setup`. See :ref:`config`.

The web frontend is configured via a YAML file named ``configuration.yaml`` (path given by the ``INGINIOUS_CONFIG``
environment variable, ``./configuration.yaml`` by default). The file format is the one of the former Python
frontend: an existing file keeps working. Unknown keys are ignored. The file is read at start-up.

A minimal configuration looks like:

.. code-block:: yaml

    backend: tcp://127.0.0.1:2000
    mongo_opt:
        host: localhost
        database: INGInious
    tasks_directory: /var/www/inginious/tasks
    superadmins:
        - superadmin
    base_url: https://inginious.example.org
    webdav_host: https://inginious.example.org/dav
    session_parameters:
        secret_key: "<a long random string>"
        secure: true
    smtp:
        sendername: 'INGInious <no-reply@inginious.example.org>'
        host: smtp.example.org
        port: 587
        username: inginious
        password: secret
        starttls: true
    plugins: []

The ``configuration.deploy.yaml`` file of the repository is the configuration used by the ``docker compose``
deployment.

The backend and the agents do not read this file: they are configured by their command-line options
(see :ref:`inginious-backend`, :ref:`inginious-agent-docker` and :ref:`inginious-agent-mcq`).

The different entries are :

``allow_deletion``
    ``false`` if users cannot delete their accounts (and all related data from database), ``true`` otherwise.
    Defaults to ``true``.

``allow_registration``
    ``false`` if database registration should be disabled. In this mode no password can be set and accounts
    are only created via the external authentication systems. ``true`` otherwise (default).

``allowed_file_extensions``
    Default list of the file extensions accepted by *file* problems (a problem can override it).
    Defaults to ``[".c", ".cpp", ".java", ".oz", ".zip", ".tar.gz", ".tar.bz2", ".txt"]``.

``backend``
    Address of the backend (its *client* address, see :ref:`inginious-backend`), in the form
    ``tcp://xxx.yyy.zzz.aaa:bbbb`` or ``ipc:///path/to/your/sock``. **Required**: the frontend refuses to start with
    ``backend: local`` (the former Python frontend could start a backend and a Docker agent in its own process; the
    backend and the agents now always run as separate processes).

``base_url``
    Public URL of the instance, e.g. ``https://inginious.example.org``. Used to build the links sent by e-mail
    (account activation, password reset) and the callback URLs of the OAuth and SAML authentication plugins.
    When absent, the ``APP_ORIGIN`` environment variable is used; if neither is set, these actions are
    refused (except when the instance is accessed on ``localhost``) and an error is logged.

``lti_config``
    A dictionary containing the LTI v1.3 tool consumers configuration.
    See :ref:`lti13` for configuration details.

``maintenance``
    Set to ``true`` to replace every page by a maintenance message.

``max_file_size``
    Maximum size, in bytes, of each file uploaded in a submission. Defaults to ``1048576`` (1 MiB).

``mongo_opt``
    MongoDB client configuration.

    ``host``
        MongoDB server address (defaults to ``localhost``). If your database is user/password-protected, use the
        following syntax: ``mongodb://USER:PASSWORD@HOSTNAME/DB_NAME``

    ``database``
        You can change the database name (defaults to ``INGInious``) if you want multiple instances or in the case
        of conflict.

    The frontend refuses to start when the database version does not match the one it expects: run
    :ref:`inginious-database-update` first.

``plugins``
    A list of plugin modules together with configuration options.
    See :ref:`plugins` for detailed information on available plugins, including their configuration.

``privacy_page``
    Static page id of the Privacy Policy.  If not specified, users won't have to accept anything
    before using INGInious. (see :ref:`StaticPages`)

``smtp``
    Mails are sent if users are allowed to register with a password. Please note that personal mailbox
    services such as Gmail or Outlook may deactivate SMTP password authentication by default. It is
    however strongly discouraged to use personal email accounts for production.

    ``sendername``
        Email sender name, e.g. : ``INGInious <no-reply@inginious.org>``

    ``host``
        SMTP server.

    ``port``
        SMTP port.

    ``username``
        SMTP username.

    ``password``
        SMTP password.

    ``starttls``
        Set to ``true`` if TLS is needed.

    ``usessl``
        Set to ``true`` if SSL is needed.

``static_directory``
    Path to the directory where YAML-defined static pages are located. Defaults to ``./static``.

``superadmins``
    A list of super-administrators who have admin access on the whole stored content.

``tasks_directory``
    The path to the directory that contains all the task definitions, grouped by courses.
    (see :ref:`task`). Defaults to ``./tasks``.

``terms_page``
    Static page id of the Terms of Service page. If not specified, users won't have to
    accept anything before using INGInious. (see :ref:`StaticPages`)

``webterm``
    Link to the INGInious xterm app with the following syntax: ``http[s]://host:port``.
    If set, it allows to use in-browser task debug via ssh. (See :ref:`webterm_setup` for
    more information)

``webdav_host``
    Public URL of the WebDAV access, served by the frontend under ``/dav``, e.g.
    ``https://inginious.example.org/dav``. If set, the course administration displays this URL and the
    credentials to use to access the course files (see :ref:`webdav_setup`).

``welcome_page``
    Static page id to serve instead of the course list as home page. (see :ref:`StaticPages`)

``sentry_io_url``
    The Sentry.io *Data Source Name* to use for error reporting in the browser. If not set, sentry.io is not loaded.

``session_parameters``
    A dictionnary containing information about the management of sessions in the app.
    ``secret_key`` is required; the other values default to:

    ::

        session_parameters:
            cookie_name: "inginious_session_id"
            cookie_domain: null
            cookie_path: "/"
            samesite: "Lax"
            timeout: 86400  # 24 * 60 * 60, # 24 hours in seconds
            httponly: true
            secure: false

    Most value are as defined in standard HTTP cookies. The ``secret_key`` should be a long sequence of random
    characters. Set ``secure`` to ``true`` when the instance is served over HTTPS.

``reverse-proxy-config``
    A dictionary for reverse proxy configuration.

    ``enable``
        ``true`` if INGInious runs behind a reverse proxy and is only reachable through it, ``false`` otherwise
        (default). When enabled, the client IP address (used by the login rate limits) is read from the
        ``X-Forwarded-For`` header, and the public URL used to check LTI signatures from the ``X-Forwarded-Proto`` and
        ``X-Forwarded-Host`` headers. Do not enable it when clients can reach the frontend directly.

    ``x-for``
        Number of proxies in front of the frontend: the client address is the one added by the
        ``x-for``-th proxy, counting from the right of the ``X-Forwarded-For`` header. Defaults to 1. The
        spelling ``x_for`` is also accepted.

Keys of the former Python frontend that are ignored
---------------------------------------------------

The following keys may be present in existing files; the frontend ignores them:

- ``use_minified_js``, ``web_debug``, ``debug_asyncio``, ``log_level``: specific to the Python web application
  (the frontend logs on its standard output);
- ``local-config``: options of the local backend and agent, which are not started by the frontend anymore. Use the
  options of :ref:`inginious-agent-docker` (``--debug-host``, ``--debug-ports``, ``--tmpdir``, ...) instead;
- ``fs``: only the local filesystem (``tasks_directory``) is supported;
- ``backup_directory``: accepted, but not used;
- ``reverse-proxy-config.x-host`` (``x_host``): the first value of the ``X-Forwarded-Host`` header is used.

.. _configuration.example.yaml: https://github.com/INGInious/INGInious/blob/master/configuration.example.yaml

.. _plugins:

Plugins
-------

Several plugins are available to complete the INGInious feature set. They are part of the frontend and are enabled
by listing them under ``plugins`` in the configuration file, with the same ``plugin_module`` names as in the former
Python frontend; every other key of an entry is an option of the plugin. Plugins are loaded in the order of the list.

An entry whose ``plugin_module`` is not one of the plugins below (for instance a third-party Python plugin) is
ignored, with a warning in the log: Python plugins cannot be loaded by the frontend. See :doc:`/dev_doc/extensions_doc/plugins`
to write a new plugin.

External authentication plugins
```````````````````````````````

You can allow account creation from an external authentication source. This will link the external credentials to the
INGInious account so that the user can log in INGInious using these credentials in the future. Several authentication
plugins are available. Every authentication plugin has an ``id`` option (the authentication method id, alphanumerical
and different from the other external authentication methods) and a ``name`` option (the label of the sign-in button).

LDAP
!!!!

Uses an LDAP server to authenticate users. The user types its login and password in a form hosted by INGInious.

To enable this plugin, add to your configuration file:
::

    plugins:
        - plugin_module: inginious.frontend.plugins.auth.ldap_auth
          id: <some_id_for_ldap>
          host: "your.ldap.server.com"
          encryption: "ssl" # can be tls or none
          base_dn: "ou=People,dc=info,dc=ucl,dc=ac,dc=be"
          request: "(uid={})"
          name: "LDAP Login"

Most of the parameters are self-explaining, but:

``request``
    is the request made to the LDAP server to search the user to authentify. "{}" is replaced by the username indicated by the user.

``encryption``
    ``none`` (default), ``ssl`` (LDAPS) or ``tls`` (StartTLS).

Additional parameters to fine tune ldap authentication -- normally not necessary:

``port``
    the port of the LDAP server, if it is not the default one.

``imlink``
    URL of an image to display on the sign-in button.

``cn``
    the ldap attribute with the real name (default: ``cn``)

``mail``
    the ldap attribute with the email address (default: ``mail``)

``bind_dn``
    some ldap server do not allow access without authentication.
    'bind_dn' is a format string to convert the login name to a full ldap name for authentication,
    "{}" is replaced by the login name.

        bind_dn: "cn={},ou=People,dc=info,dc=ucl,dc=ac,dc=be"

The ``auto_bind`` option of the former Python plugin is not used.

SAML2/Shibboleth
!!!!!!!!!!!!!!!!

Uses a SAML2-compliant identity provider (such as Shibboleth IdP) to authenticate users.

To enable this plugin, add to your configuration file:
::

    plugins:
        - plugin_module: inginious.frontend.plugins.auth.saml2_auth
          id: <some_id_for_saml2>
          strict: true
          sp:
              entityId: "<your_entity_id>"
              x509cert: "<your_cert>"
              privateKey: "<your_private_key>"
          idp:
              entityId: "https://idp.testshib.org/idp/shibboleth"
              singleSignOnService:
                  url: "https://idp.testshib.org/idp/profile/SAML2/Redirect/SSO"
                  binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
              x509cert: "<idp_cert>"
              additionalX509certs:
                  - "<idp_cert>"
          security:
               metadataValidUntil: ""
               metadataCacheDuration: ""
          attributes:
               cn: "urn:oid:2.5.4.3"
               email: "urn:oid:1.3.6.1.4.1.5923.1.1.1.6"
               uid: "urn:oid:0.9.2342.19200300.100.1.1"

Your IdP is required to provide at least attributes corresponding to the username, the complete name and the email address.
Use the ``attributes`` entry for the mapping. The ``additionalX509certs`` is a plugin-specific entry to specify several
certificates in case your IdP is able to use more than one.

The configuration format is the one of the python3-saml_ package used by the former Python plugin. The frontend reads
``sp.entityId``, ``sp.x509cert``, ``sp.privateKey``, ``sp.NameIDFormat``, ``idp.singleSignOnService.url``,
``idp.x509cert``, ``idp.additionalX509certs``, ``security.wantAssertionsSigned``, ``security.wantMessagesSigned``,
``attributes`` and ``additional``; other keys are ignored. The Assertion Consumer Service (ACS) URL is
``<base_url>/auth/callback/<id>`` and the SP metadata are served at ``<base_url>/auth/<id>/metadata``.

.. _python3-saml: https://github.com/onelogin/python3-saml/


Facebook/LinkedIn/GitHub/Google
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

Uses a Facebook/LinkedIn/GitHub/Google application to allow authentication via the network.
You need to create an app on the appropriate developer platform in order to use this plugin.

To enable this plugin, add to your configuration file:
::

    plugins:
        - plugin_module: inginious.frontend.plugins.auth.facebook_auth
          id: <some_id_for_facebook>
          client_id: <your_app_id>
          client_secret: <your_app_secret>

``id`` is the authentication method id. ``client_id`` and ``client_secret`` are the OAuth identifier and secret of the
created app. Replace ``facebook_auth`` by ``linkedin_auth``, ``github_auth`` or ``google_auth`` according to your case.
The redirect (callback) URL to declare in the app is ``<base_url>/auth/callback/<id>``.

- ``google_auth`` accepts a ``domain`` option: when set, only the accounts of that Google Workspace domain are accepted.
- ``linkedin_auth`` uses *Sign In with LinkedIn using OpenID Connect*: enable this product in the LinkedIn app.
- The ``debug`` option of the former plugins is not used.

Scoreboard plugin
`````````````````

This plugin allows to generate course/tasks scoreboards. To enable the plugin, add to your configuration file:
::

    plugins:
        - plugin_module: inginious.frontend.plugins.scoreboard

To define a new scoreboard, an additional field ``scoreboard`` must be defined in the ``course.yaml`` file
associated to a course (See :ref:`course`). For instance:
::

    scoreboard:
        - content: ["taskid1"]
          name: "Scoreboard task 1"
        - content: ["taskid2", "taskid3"] # sum of both score is taken as overall score
          name: "Scoreboard for task 2 and 3"
        - content: {"taskid4": 2, "taskid5": 3} # overall score is 2*score of taskid4 + 3*score of taskid5
          name: "Another scoreboard"
          reverse: True

This defines three scoreboards for the course. The first one will create a scoreboard for task id ``taskid1`` and will
be displayed as ``Scoreboard task 1``. The second one will create a scoreboard for ``taskid2`` and ``taskid3`` where
both scores are added. The last one is more complex and will create a reversed scoreboard for task ``taskid4`` and
``taskid5`` where both scores are weighted by factor ``2`` and ``3``, respectively.

The score used by this plugin for each task must be generated via a key/value custom feedback
(see :ref:`feedback-custom`) using the ``score`` key. Only the *succeeded* tasks are taken into account.
Scoreboards are visible to the students registered in the course and to its staff.

Contests plugin
```````````````

This plugin allows to manage an ACM/ICPC like contest inside a course between students.
To enable the plugin, add to your configuration file:
::

    plugins:
        - plugin_module: inginious.frontend.plugins.contests

A *Contest* settings page, reachable from the course menu, is available to the course administrators. To enable the
contest mode, check *Enable contest plugin* on that page. Please note that the plugin will override the task
accessibility dates. The contest scoreboard is visible to the students registered in the course and to its staff.


Upcoming tasks plugin
`````````````````````

This plugin allows for students to easily visualize their upcoming tasks based on deadlines.
The new page is available directly from the main menu.

To enable the plugin, add to your configuration file:
::

    plugins:
        - plugin_module: inginious.frontend.plugins.upcoming_tasks

Simple grader plugin
````````````````````

This simple grader allows POST requests authenticated by a shared key, without user account and without storing
submissions in database.

To enable the plugin, add to your configuration file:
::

    plugins:
        - plugin_module: inginious.frontend.plugins.simple_grader
          courseid : "external"
          api_key: "<a long random string>"
          return_fields: "^(result|text|problems)$"

- ``courseid`` is the course id you want to expose to the simple grader (default: ``external``).

- ``api_key`` is the shared secret that every request must contain (field ``api_key``). **Required**: without it,
  the plugin is disabled.

- ``return_fields`` is a regular expression matching the submission fields that can be returned via the simple grader
  (among ``result``, ``text``, ``grade``, ``problems``, ``tests``, ``custom``, ``state``, ``stdout`` and ``stderr``).

The grader is available at ``/external``; the ``page_pattern`` option of the former plugin is ignored. A demonstration
POST form is displayed by a GET request on that URL. Requests are form-encoded or JSON objects with the fields below;
requests coming from web pages of another origin must be sent as JSON. A request with a missing or wrong ``api_key``
gets a ``403`` answer ``{"status": "error", "status_message": "Invalid API key"}``.

New synchronized job
!!!!!!!!!!!!!!!!!!!!

External submissions must take the form of a POST request on ``/external``.
This POST must contain, besides ``api_key``, two data fields:

- ``taskid``: the task id of the task

- ``input``: the input for the task, in JSON. The input is a dictionary filled with problemid:problem_answer pairs.

The return value will contain the fields allowed by ``return_fields`` plus a "status" field that will
contain "done".

If an error occurs, it will return a dictionary containing

::

    {
        "status": "error",
        "status_message": "A message containing a simple description of the error"
    }

New asynchronous job
!!!!!!!!!!!!!!!!!!!!

This POST request allows new jobs to be treated asynchronously.
It must contain, besides ``api_key``, three data fields:

- ``taskid``: the task id of the task

- ``input``: the input for the task, in JSON. The input is a dictionary filled with problemid:problem_answer pairs.

- ``async``: field that indicate that the job must be launched asynchronously. Only have to be present, content is not read.

The return value will be a dictionnary containing:

::

    {
        "status": "done",
        "jobid": "the jobid of the async job. Will be needed to get the results."
    }

or

::

    {
        "status": "error",
        "status_message": "A message describing the error"
    }

Get status of asynchronous job
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

Given a ``jobid`` (and the ``api_key``) as fields of the POST request, it will return either:
::

    {
        "status": "waiting"
    }

or

::

    {
        "status": "error",
        "status_message": "A message describing the error"
    }

or

::

    {
        "status": "done",
        "...":"..."
    }

where ``...`` are the results of the job, as defined in the ``return_fields`` configuration value. A result can be
retrieved once; results that are not retrieved are deleted after one hour. Asynchronous jobs are kept in the memory of
the frontend process: they are lost when it restarts.

Git Repo plugin
```````````````
This plugin allows saving submissions history in a Git repository, according to the following path pattern :
``courseid/taskid/username``. The version kept in the head of branch is the latest submission made.
Each graded submission is committed with its input (``input.yaml``), its result (``result.yaml``) and the archive
returned by the grader (``output/``).

To enable this plugin, add to your configuration file:
::

    plugins:
        - plugin_module: inginious.frontend.plugins.git_repo
          repo_directory: "./repo_submissions"

The ``repo_directory`` parameter specify the path of the repository (default: ``./repo_submissions``). ``git`` must be
installed on the host running the frontend.

LTI best submission plugin
``````````````````````````
This plugin adds the ``/lti/bestsubmission`` and ``/lti1.3/bestsubmission`` endpoints, which return in JSON the evaluated
submission of the user of an LTI session for the task of the launch, with a summary of the questions and answers.
To enable it:
::

    plugins:
        - plugin_module: inginious.frontend.plugins.ltibestsubmission

Example and demonstration plugins
`````````````````````````````````

The following plugins are examples for developers; they are not useful in production.

- ``inginious.frontend.plugins.demo`` serves a demonstration page at ``/plugindemo``.
- ``inginious.frontend.plugins.taskless-hello-world`` serves at ``/taskless_hello_world`` (superadmins only) a page
  that runs a *taskless* grading job (see :doc:`/dev_doc/extensions_doc/taskless_jobs`). Options: ``environment_type``
  (default ``docker``), ``environment`` (default ``taskless-hello-world``), ``run_cmd`` (command run in the container
  instead of its run file) and ``timeout`` (seconds, default 60).
- ``inginious.frontend.plugins.task_editor_hook_example`` adds two tabs to the task editor and refuses to save a task
  without a value for its *Task hint* field.

Task file formats
`````````````````
Tasks are described in YAML (``task.yaml``). The JSON task file reader plugin
(``inginious.frontend.plugins.task_file_readers.json_reader``) of the former Python frontend is not available.
