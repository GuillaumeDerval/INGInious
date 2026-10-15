Installation and deployment
===========================

An INGInious instance is made of the following services:

- a MongoDB_ database;
- the *backend* (:ref:`inginious-backend`), which queues the grading jobs;
- one or more *agents* (:ref:`inginious-agent-docker`, :ref:`inginious-agent-mcq`), which grade the jobs in containers;
- the web *frontend*, a Node.js application (SvelteKit) located in the ``frontend/`` directory of the repository.
  It serves the student, teacher and administration pages, the REST API, the LTI endpoints and the WebDAV access
  to the course files (under ``/dav``).

The backend and the agents are the Python package ``inginious``. The frontend reads the same ``configuration.yaml``
file (see :ref:`ConfigReference`) and uses the same MongoDB database format as the former Python frontend
(``inginious-webapp``), which it replaces: an existing instance can switch to it without migrating its data.

The recommended deployment is the ``docker compose`` one (see :ref:`compose`). A manual installation is described
afterwards.

Supported platforms
-------------------

INGInious runs Linux containers and is therefore intended to run on Linux.

You may be able to run it on other platforms supporting Linux containers, but no support is provided yet.
If you are willing to contribute this, feel free to contact us on Github.

.. _compose:

Deployment with docker compose
------------------------------

The repository provides a ``docker-compose.yml`` file that builds (or pulls) and runs every service:

- ``db``: MongoDB, initialised with a superadmin account by ``deploy/init-mongo.js``;
- ``backend``: ``inginious-backend``, listening for clients on port 2000 and for agents on port 2001;
- ``agent-docker`` and ``agent-mcq``: the grading agents;
- ``frontend``: the Node.js frontend (target ``frontend`` of ``deploy/Containerfile``), listening on port 8000;
- ``caddy``: the reverse proxy terminating TLS (configuration in ``deploy/Caddyfile``), which forwards every request,
  including WebDAV ones under ``/dav``, to the frontend;
- ``env-base``, ``env-default`` and ``env-python3``: the default grading environments.

From a clone of the repository:

.. code-block:: bash

    $ docker compose up --build

and open https://localhost. The default login and password are ``superadmin``. The README of the repository details
the environment variables of the superadmin account.

Before running it in production:

#. Edit ``configuration.deploy.yaml`` (mounted as ``/inginious/configuration.yaml`` in the frontend container):
   change ``session_parameters.secret_key``, set ``session_parameters.secure: true``, set ``base_url`` and
   ``webdav_host`` to your public URL (``webdav_host: https://your.host/dav``), and add the ``smtp`` and ``plugins`` entries you need (see :ref:`ConfigReference`).
#. The ``frontend`` service takes its public URL from the ``X-Forwarded-Proto`` and ``X-Forwarded-Host`` headers set
   by Caddy (``PROTOCOL_HEADER`` and ``HOST_HEADER`` in ``docker-compose.yml``): it refuses form submissions whose
   origin does not match the URL used by the browser, so keep the frontend reachable only through the proxy.
#. Replace the host names of ``deploy/Caddyfile`` by your domain name. See the
   `Caddyfile documentation <https://caddyserver.com/docs/caddyfile>`_ for more advanced proxy configuration.
#. Install your courses in the ``tasks`` directory (it is created by ``docker compose`` if needed).

The frontend container needs no Python and the backend containers need no Node.js: each image only contains its own
service.

Manual installation: dependencies
---------------------------------

INGInious needs:

- Python_ 3.10+ for the backend and the grading agents;
- Docker_ or Podman_ for the grading containers;
- MongoDB_;
- `Node.js`_ 24 (with ``npm``) for the web frontend.

.. _Docker: https://www.docker.com
.. _Podman: https://podman.io/
.. _Python: https://www.python.org/
.. _MongoDB: http://www.mongodb.org/
.. _Node.js: https://nodejs.org/

RHEL/Rocky/Alma Linux 8+
````````````````````````

#. The previously mentioned dependencies can be installed:

   .. code-block:: bash

     # dnf install -y epel-release && crb enable
     # dnf install -y git gcc python3.12 python3.12-devel python3.12-pip dnf-plugins-core
     # dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
     # yum install -y docker-ce docker-ce-cli
     # cat <<EOF > /etc/yum.repos.d/mongodb-org-8.0.repo
     [mongodb-org-8.0]
     name=MongoDB Repository
     baseurl=https://repo.mongodb.org/yum/redhat/$releasever/mongodb-org/8.0/x86_64/
     gpgcheck=1
     enabled=1
     gpgkey=https://pgp.mongodb.com/server-8.0.asc
     EOF
     # dnf install -y mongodb-org mongodb-org-server

   Node.js 24 can be installed from the ``nodejs:24`` module stream (``dnf module install -y nodejs:24``) when your
   release provides it, or from the `Node.js download page <https://nodejs.org/en/download>`_.

#. You can now enable and start the ``mongod`` and ``docker`` services:
   ::

      # systemctl enable --now mongod docker

#. Check the cgroups version the container runtime is running on:
   ::

      # docker info | grep "Cgroup"

   If the cgroups version is ``2`` and cgroups driver is ``systemd``, apply the following systemd rule:
   ::

      # cat /etc/systemd/system/docker-.scope.d/99-inginious.conf
      [Scope]
      OOMPolicy=kill

Ubuntu 24.04+
`````````````

#. The previously mentioned dependencies can be installed:

   .. code-block:: bash

      $ sudo apt install git gcc python3-pip python3-dev python3-venv
      $ sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
      $ sudo chmod a+r /etc/apt/keyrings/docker.asc
      $ sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
      Types: deb
      URIs: https://download.docker.com/linux/ubuntu
      Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
      Components: stable
      Architectures: $(dpkg --print-architecture)
      Signed-By: /etc/apt/keyrings/docker.asc
      EOF
      $ sudo apt update
      $ sudo apt install docker-ce docker-ce-cli
      $ curl -fsSL https://pgp.mongodb.com/server-8.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
      $ echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
      $ sudo apt update
      $ sudo apt install mongodb-org

   Node.js 24 is not packaged by Ubuntu: install it from the `Node.js download page <https://nodejs.org/en/download>`_
   (official binaries, NodeSource repository or a version manager such as ``nvm``).

#. You can now enable and start the ``mongod`` and ``docker`` services:
   ::

      # systemctl enable --now mongod docker

#. Check the cgroups version the container runtime is running on:
   ::

      # docker info | grep "Cgroup"

   If the cgroups version is ``2`` and cgroups driver is ``systemd``, apply the following systemd rule:
   ::

      # cat /etc/systemd/system/docker-.scope.d/99-inginious.conf
      [Scope]
      OOMPolicy=kill

macOS
`````

.. WARNING::

    Documentation for macOS is outdated. Feel free to contribute.

We use brew_ to install some packages. Packages are certainly available too via macPorts.

.. _brew: http://brew.sh/

::

    $ brew tap mongodb/brew
    $ brew update
    $ brew install mongodb-community
    $ brew install python3
    $ brew install node@24

Follow the instruction of brew to enable mongodb.

The next step is to install `Docker for Mac <https://docs.docker.com/docker-for-mac/install/>`_.

.. _Installpip:

**Whatever the distribution, you should make docker available for non-root user:**

1. Run the ``groupadd`` command below to create a new group called ``docker``. Enter your password to continue running the command.

.. code-block:: bash

    sudo groupadd docker

If the ``docker`` group exists in the user group, you will get a message like "group already exists".

2. Next, run the ``usermod`` command below where the ``-aG`` options tell the command to add the INGInious running user ``<user>`` to the ``docker`` group.
This command causes your user account to have non-user access.

.. code-block:: bash

    sudo usermod -aG docker user

3. Run the ``newgrp`` command below to change the current real group ID to the ``docker`` group.

.. code-block:: bash

    sudo newgrp docker

Installing INGInious
--------------------

Backend and agents
``````````````````

To keep a clean distribution, we recommend to work with a virtualenv:

.. code-block:: bash

    python3 -m venv /path/to/venv/INGInious
    source /path/to/venv/INGInious/bin/activate

The backend and the agents are installed via pip, from PyPI or from a clone of the repository:
::

    $ pip install --upgrade pip
    $ pip install --upgrade inginious                                       # latest release
    $ pip install --upgrade git+https://github.com/INGInious/INGInious.git  # development version

This installs the commands ``inginious-backend``, ``inginious-agent-docker``, ``inginious-agent-mcq`` and the
utilities listed in the commands reference. It does not install the web frontend.

Frontend
````````

The frontend is built from the ``frontend/`` directory of a clone of the repository:
::

    $ git clone https://github.com/INGInious/INGInious.git
    $ cd INGInious/frontend
    $ npm ci
    $ npm run build
    $ npm prune --omit=dev     # optional: drop the build-only dependencies

The result is a standalone Node.js server in ``frontend/build``. It needs the ``node_modules`` directory next to it
(runtime dependencies) and ``git`` on the ``PATH`` for the marketplace course import and the ``git_repo`` plugin.

The command-line tools of the frontend (:ref:`inginious-setup`, :ref:`inginious-autotest` and :ref:`inginious-test-task`)
are built separately:
::

    $ npm run build:cli

.. _config:

Configuring INGInious
---------------------

INGInious comes with a mini-LMS web app that provides statistics, group management, and the
INGInious studio, that allows to modify and test your tasks directly in your browser. It supports the LTI_ interface
that allows to interface with Learning Management System via the LTI_ specification. Any LMS supporting LTI_ is
compatible. This includes Moodle, edX, among many others.

.. _LTI: https://www.1edtech.org/standards/lti

It is recommended to create a folder for INGInious and subfolders for tasks and backup, e.g.:
::

    $ mkdir -p /var/www/inginious
    $ cd /var/www/inginious
    $ mkdir tasks
    $ mkdir backup

The configuration file can be written by hand (see :ref:`ConfigReference`) or created with the ``inginious-setup``
tool of the frontend, once the backend and MongoDB are running:
::

    $ cd /path/to/INGInious/frontend
    $ npx inginious-setup --file /var/www/inginious/configuration.yaml

It asks for the backend address, the MongoDB host and database, the tasks and backup folders (enter absolute paths,
e.g. ``/var/www/inginious/tasks``), the superadmin account, whether the instance is served over HTTPS and the SMTP
server, checks that MongoDB and the backend are reachable, creates the superadmin account and writes the file.
See :ref:`inginious-setup` for its options.

Make sure the configuration has an ``smtp`` entry, since INGInious sends e-mails during user registration and
password reset, and a ``base_url`` entry (the public URL of the instance), used to build the links of these e-mails.

.. note::

    The frontend does not start a backend by itself: ``backend: local`` is refused. The backend and the agents
    always run as separate processes (possibly on the same host), and ``backend`` must be their address
    (e.g. ``tcp://127.0.0.1:2000``).

Running INGInious
-----------------

#. Launch the backend (see :ref:`inginious-backend`):
   ::

        inginious-backend tcp://0.0.0.0:2001 tcp://0.0.0.0:2000

   The agents connect on port 2001 and the frontend on port 2000. Restrict access to these ports to the hosts
   running the agents and the frontend.
#. Possibly on different hosts, launch the Docker and MCQ agents (see :ref:`inginious-agent-docker`
   and :ref:`inginious-agent-mcq`):
   ::

        inginious-agent-docker tcp://backend-host:2001
        inginious-agent-mcq tcp://backend-host:2001

#. In the configuration file (see :ref:`ConfigReference`), set ``backend`` to the client address of the backend:
   ::

        backend: tcp://backend-host:2000

#. Start the frontend:
   ::

        $ cd /path/to/INGInious/frontend
        $ INGINIOUS_CONFIG=/var/www/inginious/configuration.yaml PORT=8000 \
          PROTOCOL_HEADER=x-forwarded-proto HOST_HEADER=x-forwarded-host node build

The frontend is configured by environment variables:

``INGINIOUS_CONFIG``
    Path of the configuration file. Defaults to ``./configuration.yaml``.

``PORT`` and ``HOST``
    Port and address the HTTP server listens on (defaults: ``3000`` and ``0.0.0.0``).

``PROTOCOL_HEADER`` and ``HOST_HEADER``
    Headers giving the public scheme and host name of the requests, set by the reverse proxy (usually
    ``x-forwarded-proto`` and ``x-forwarded-host``). The frontend compares the origin of each form submission with
    this public URL and refuses the others, so it must only be reachable through the proxy. Without a proxy, give the
    public URL in ``APP_ORIGIN`` when building and running it instead
    (``APP_ORIGIN=https://inginious.example.org npm run build``, and the same variable for ``node build``).

``TZ``
    Time zone used to display and parse dates (e.g. ``Europe/Brussels``).

The other variables of the SvelteKit Node adapter (``BODY_SIZE_LIMIT``, ``ADDRESS_HEADER``, ...) are
described in the `adapter-node documentation <https://svelte.dev/docs/kit/adapter-node>`_.

The configuration file is read once, at start-up: restart the frontend after modifying it.

.. _production:

Running as a service behind a reverse proxy
```````````````````````````````````````````

In production, run the frontend as a service and put a reverse proxy in front of it to terminate TLS.
A *systemd* unit can look like:
::

    [Unit]
    Description=INGInious frontend
    After=network.target mongod.service

    [Service]
    User=inginious
    WorkingDirectory=/opt/INGInious/frontend
    Environment=INGINIOUS_CONFIG=/var/www/inginious/configuration.yaml
    Environment=PORT=8000
    Environment=HOST=127.0.0.1
    Environment=PROTOCOL_HEADER=x-forwarded-proto
    Environment=HOST_HEADER=x-forwarded-host
    ExecStart=/usr/bin/node build
    Restart=on-failure

    [Install]
    WantedBy=multi-user.target

The user running the frontend must be able to read and write the tasks directory (course and task edition, WebDAV).
It does not need access to the Docker daemon.

Any HTTP reverse proxy can be used. With Caddy:
::

    inginious.example.org {
        reverse_proxy 127.0.0.1:8000
    }

With nginx:
::

    server {
        listen 443 ssl;
        server_name inginious.example.org;
        # ssl_certificate ...;
        client_max_body_size 100m;

        location / {
            proxy_pass http://127.0.0.1:8000;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;
        }
    }

When the frontend is only reachable through the proxy, set ``reverse-proxy-config: {enable: true}`` in the
configuration, so that the client IP addresses (used by the login rate limits) and the public URL (used to verify
LTI signatures) are read from the ``X-Forwarded-*`` headers. Leave it disabled otherwise.

To check the installation, open the public URL in a browser, log in as superadmin, install a course (for instance
the tutorial of the `INGInious demo tasks <https://github.com/INGInious/demo-tasks>`_) and submit a task: the
submission is graded when the backend and the agents are connected. The *Queue* page lists the running jobs.

Optional apps
=============

.. _webdav_setup:

WebDAV setup
------------

Course administrators can access the files of their courses with a WebDAV client. WebDAV is served by the frontend
itself under the ``/dav`` path: there is no separate service to run. Users authenticate with their username and
their API key (created with the "Generate secret" button of the WebDAV box); only the administrators of a course (and
the superadmins) can access it, and only over HTTPS (see ``webdav_allow_http`` in :ref:`ConfigReference`).

To display the WebDAV URL and credentials to course administrators (on the task list page of the course
administration), set ``webdav_host`` to the public URL of that path in the
configuration file (see :ref:`ConfigReference`)::

    webdav_host: https://inginious.example.org/dav

.. _webterm_setup:

Webterm setup
-------------

An optional web terminal can be used with INGInious to load the remote SSH debug session. This rely on an external tool.

To install this tool :
::

    $ git clone https://github.com/INGInious/xterm
    $ cd xterm && npm install

You can then launch the tool by running:
::

    $ npm start bind_hostname bind_port debug_host:debug_ports

This will launch the app on ``http://bind_hostname:bind_port``. The ``debug_host`` and ``debug_ports`` parameters are
the debug parameters of the Docker agent (see :ref:`inginious-agent-docker`).

To make the INGInious frontend aware of that application, update your configuration file by setting the ``webterm``
field to ``http://bind_hostname:bind_port`` (see :ref:`ConfigReference`).

For more information on this tool, please see `INGInious-xterm <https://github.com/INGInious/xterm>`_. Please
note that INGInious-xterm must be launched using SSL if the frontend is launched using SSL.
