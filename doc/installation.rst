Installation and deployment
===========================

Supported platforms
-------------------

INGInious is tested under OS X 10.10 (using Boot2Docker) and CentOS 7 but will probably run without problems on any
other Linux distribution and even on Microsoft Windows®.

Simplified architecture
-----------------------

INGInious is composed of two softwares, the ```frontend``` and the ```agents```, which relies on a library called the ```backend```.
There are then two component to install in order to run the frontend of INGInious:
- The frontend itself, which will need a web server like Lighttpd or Apache to handle requests
- One or more agents, which will handle the grading

The frontend can be located on any machine, as it only needs a web server (you can use the web server included, but it is not
advised in production environment).

Each agent need to be on a machine running Docker locally, as it needs to access CGroups. It may also need root access.
The backend (runned by the frontend) and the agents communicate via TCP, the default port being 5001.

Plugins
-------

The frontend can run plugins. Most of them are shipped with the sources of INGInious but are not activated by default.

Dependencies
------------

The backend (library used by the frontend and by plugin developers) needs:

- Python_ 2.7+
- Docutils
- RPyC_

The frontend needs:

- All the backend dependencies
- MongoDB_
- pymongo_
- HTMLTidy_
- PyTidyLib_
- Python's SH_ lib
- Web.py_
- There are also some additional dependencies for some plugins.

The agents need:
- Docker_ 0.11+
- Docker-py_
- RPyC_
- cgroup-utils_
- Commentjson_
- Docutils

.. _Docker: https://www.docker.com
.. _Docker-py: https://github.com/dotcloud/docker-py
.. _Python: https://www.python.org/
.. _MongoDB: http://www.mongodb.org/
.. _pymongo: http://api.mongodb.org/python/current/
.. _HTMLTidy: http://tidy.sourceforge.net/
.. _PyTidyLib: http://countergram.com/open-source/pytidylib/docs/index.html
.. _SH: http://amoffat.github.io/sh/
.. _Web.py: http://webpy.org/
.. _Commentjson: https://pypi.python.org/pypi/commentjson/0.4
.. _RPyC: http://rpyc.readthedocs.org/en/latest/index.html
.. _cgroup-utils: https://github.com/peo3/cgroup-utils

Installation of the dependencies
--------------------------------

Centos 7.0+
```````````

We describe here the installation of the dependencies of both the agent and the frontend,
as most user will use them on the same server.

::

    $ sudo yum install epel-release
	$ sudo yum install git mongodb mongodb-server docker python-pip gcc python-devel
	$ sudo pip install -r requirements.agent.txt
	$ sudo pip install -r requirements.frontend.txt

You can then start the services *mongod* and *docker*.

::

	$ sudo service mongod start
	$ sudo service docker start

To start them on system startup, use these commands:

::

	$ sudo chkconfig mongod on
	$ sudo chkconfig docker on

OS X 10.10+
```````````

We use brew_ to install some packages. Packages are certainly available too via macPorts.
We also use Boot2Docker_, that allows to run Docker on OS X.

.. _brew: http://brew.sh/
.. _Boot2Docker: http://boot2docker.io/

::

	$ brew install mongodb
	$ brew install python
	$ pip install -r requirements.frontend.txt

Installation of INGInious
-------------------------

Clone the source and create the configuration file:

::

    $ git clone https://github.com/INGInious/INGInious.git
    $ cd INGInious
    $ cp configuration.example.json configuration.json

You should now review and tune configuration options in ``configuration.json`` according to `Configuring INGInious`_.


Installation of the agent
`````````````````````````

Centos 7
^^^^^^^^

Simply run the agent:

::
    $ python app_agent.py
    
OS X
^^^^

As the agent need to be run directly on the machine running Docker, you need to run it on the VM used by Boot2Docker.
We have a script that do everything for you:

::
    $ ./utils/boot2docker/start_agent.sh

Installation of the frontend
````````````````````````````

Finally, you can start a demo server with the following command.
If you want a robust webserver for production, see :ref:`production`.

::

	$ python app_frontend.py

The server will be running on localhost:8080.

.. _tasks folder:

Configuring INGInious
---------------------

Configuring INGInious is done via a file named ``configuration.json``.
To get you started, a file named ``configuration.example.json`` is provided.
It content is :

::

    {
        ##############################################
        # Part common to the frontend and the agents #
        ##############################################
        
        # Location of the task directory
        "tasks_directory": "./tasks",
        
        # Aliases for containers.
        # Only containers listed here can be used by tasks
        "containers": {
            "default": "ingi/inginious-c-default",
            "sekexe": "ingi/inginious-c-sekexe"
        },
        
        ##############################################
        #        Part used only by the agents        #
        ##############################################
        
        # Port on which the local agent will listen
        "local_agent_port": 5001,
        
        # Tmp folder used by the agent.
        "local_agent_tmp_dir": "/tmp/inginious_agent",
        
        ##############################################
        #       Part used only by the frontend       #
        ##############################################
        
        # List of the agents to which the backend will try
        # to connect
        "agents": [
            {
                "host": "192.168.59.103",
                "port": 5001
            }
        ],
        
        # MongoDB options
        "mongo_opt": {"host": "localhost", "database":"INGInious"},
        
        # Plugins that will be loaded by the frontend
        "plugins": [
            {
                "plugin_module": "frontend.plugins.git_repo",
                "repo_directory": "./repo_submissions"
            },
            {
                "plugin_module": "frontend.plugins.auth.demo_auth",
                "users": {"test":"test"}
            }
        ],
        
        # Allow HTML in tasks? can be 1, 0 or "tidy" (to run HTMLTidy)
        "allow_html": "tidy"
    }

As you can see, INGInious uses a variation of JSON that allows comments with # or //.
This file contains entries that are used by both the frontend and the agents. This is clearly indicated in the comments of the JSON file.

Common part for the frontend and the agents
```````````````````````````````````````````

``tasks_directory``
    The path to the directory that contains all the task definitions, grouped by courses.
    (see :ref:`task`)

``containers``
    A ditionnary of docker's container names.
    The key will be used in the task definition to identify the container, and the value must be a valid Docker container identifier.
    The some `pre-built containers`_ are available on Docker's hub.

Part used only by the agents
````````````````````````````

```local_agent_port```
        Port to which the agent will listen. 5001 by default.

```local_agent_tmp_dir```
    Directory used by the agent to stored temporary information used by the containers. By default it is "/tmp/inginious_agent".
    
Part used only by the frontend
``````````````````````````````
``agents``
    List of agents to which the frontend will try to connect.
    
``mongo_opt``
    Quite self-explanatory. You can change the database name if you want multiple instances of in the non-probable case of conflict.

``plugins``
    A list of plugin modules together with configuration options.
    See :ref:`plugin` for detailed information on plugins, ad each plugin for its configuration options.

``allow_html``
    This parameter accepts three options that define if and how HTML values in strings are treated.
    This option applies globally on descriptions, titles and all strings directly displayed.
    By default, all text is supposed to be in reStructuredText format but ``*IsHTML`` options are available in :ref:`course.json` and :ref:`task.json`.

    ``false``
        HTML is never allowed.

    ``"tidy"``
        HTML will be sanitized by the HTML Tidy library, to ensure that it is well-formed and will not impact the remaining of the document it is included in.

    ``true``
        HTML is always accepted, and never sanitized. (discouraged)

.. _pre-built containers: https://registry.hub.docker.com/search?q=ingi
.. _docker-py API: https://github.com/docker/docker-py/blob/master/docs/api.md#client-api


.. _production:

Using lighttpd (on CentOS 7.0)
------------------------------

In production environments, you can use lighttpd in replacement of the built-in Python server.
This guide is made for CentOS 7.0.

First, don't forget to enable EPEL_.

We can then install lighttpd with fastcgi:
::

	$ sudo yum install lighttpd lighttpd-fastcgi

Now put the INGInious' sources somewhere, like */var/www/INGInious*.

First of all, we need to put the lighttpd user in the necessary groups, to allow it to launch new containers and to connect to mongodb:
::

	$ usermod -aG docker lighttpd
	$ usermod -aG mongodb lighttpd

Allow lighttpd to do whatever he wants inside the sources:

::

	$ chown -R lighttpd:lighthttpd /var/www/INGInious

Now we can configure lighttpd. First, the file */etc/lighttpd/lighttpd.conf*. Modify the document root:

::

	server.document-root = "/var/www/INGInious"

Next, in module.conf, load theses modules:

::

	server.modules = (
		"mod_access",
		"mod_alias"
	)

	include "conf.d/compress.conf"

	include "conf.d/fastcgi.conf"

You can then replace the content of fastcgi.conf with:

::

	server.modules   += ( "mod_fastcgi" )
	server.modules   += ( "mod_rewrite" )

	fastcgi.server = ( "/app_frontend.py" =>
	(( "socket" => "/tmp/fastcgi.socket",
	   "bin-path" => "/var/www/INGInious/app_frontend.py",
	   "max-procs" => 1,
	  "bin-environment" => (
	    "REAL_SCRIPT_NAME" => ""
	  ),
	  "check-local" => "disable"
	))
	)

	url.rewrite-once = (
	  "^/favicon.ico$" => "/static/favicon.ico",
	  "^/static/(.*)$" => "/static/$1",
	  "^/(.*)$" => "/app_frontend.py/$1",
	)

Finally, start the server:

::

	$ sudo chkconfig lighttpd on
	$ sudo service lighttpd start
