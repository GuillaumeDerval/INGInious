Administrator's documentation
=============================

Installation, configuration and upgrade
---------------------------------------

.. toctree::
    :maxdepth: 2

    admin_doc/install_doc/installation
    admin_doc/install_doc/updating
    admin_doc/install_doc/config_reference
    admin_doc/install_doc/static_pages
    admin_doc/install_doc/troubleshooting
    admin_doc/install_doc/other_oci_runtimes_support
    admin_doc/install_doc/create_container

Commands reference
------------------

Frontend commands
`````````````````

The web frontend itself is started with ``node build`` (see :doc:`admin_doc/install_doc/installation`).
The following tools are shipped with it, in the ``frontend/`` directory (``npm run build:cli``).

.. toctree::
    :maxdepth: 2

    admin_doc/commands_doc/inginious-setup
    admin_doc/commands_doc/inginious-autotest
    admin_doc/commands_doc/inginious-test-task

Backend commands
````````````````

.. toctree::
    :maxdepth: 2

    admin_doc/commands_doc/inginious-agent-docker
    admin_doc/commands_doc/inginious-agent-mcq
    admin_doc/commands_doc/inginious-backend

Utilities
`````````

.. toctree::
    :maxdepth: 2

    admin_doc/commands_doc/inginious-synchronize
    admin_doc/commands_doc/inginious-container-update
    admin_doc/commands_doc/inginious-database-update
    admin_doc/commands_doc/inginious-submission-anonymizer
