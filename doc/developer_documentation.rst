Developer's documentation
=========================

INGInious is made of a Python package (``inginious``: backend, grading agents, common code and command-line
utilities) and of a web frontend written with SvelteKit (TypeScript), in the ``frontend/`` directory of the
repository. The developer documentation of the frontend (architecture, conventions, feature specifications,
references) is in ``frontend/docs/``; :doc:`dev_doc/internals_doc/frontend` gives an overview and links to it.

Extensions
----------

.. toctree::
   :maxdepth: 2

   dev_doc/extensions_doc/how_to_extend
   dev_doc/extensions_doc/i18n
   dev_doc/extensions_doc/plugins
   dev_doc/extensions_doc/taskless_jobs

Internals
---------

.. toctree::
   :maxdepth: 2

   dev_doc/internals_doc/understand_inginious
   dev_doc/internals_doc/architectures
   dev_doc/internals_doc/submissions
   dev_doc/internals_doc/frontend
   dev_doc/internals_doc/groups_audiences
   dev_doc/internals_doc/exercises
