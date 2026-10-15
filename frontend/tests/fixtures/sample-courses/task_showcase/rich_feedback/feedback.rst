Global feedback title
=====================

Plain paragraph with *emphasis*, **strong**, ``literal`` and a link to `INGInious <https://inginious.org>`_
and an `anchor <#task_alert>`_.

.. note:: Note without title -> ``alert alert-light``.

.. note::
    :title: Note with title

    Card ``border-default`` with header ``bg-default``.

.. attention:: attention -> warning
.. caution:: caution -> warning
.. danger:: danger -> danger
.. error:: error -> danger
.. hint:: hint -> info
.. important:: important -> warning
.. tip:: tip -> info
.. warning:: warning -> warning

.. admonition:: Generic admonition (title is the argument)
    :class: success

    Admonition with class success.

.. admonition:: Primary card
    :class: primary
    :title: Card title from option

    Body.

.. hidden-until:: 2000-01-01 00:00:00

    PAST-HIDDEN-UNTIL: this block is visible to everybody (date in the past).

.. hidden-until:: 2099-12-31 23:59:59

    FUTURE-HIDDEN-UNTIL: only staff see this block before 2099.

.. code-block:: python

    def f(x):
        return x * 2

.. code-block:: c

Submitted at :time:`2024-05-01T12:00:00+00:00`.

=====  =====
 A      B
=====  =====
 1      2
 3      4
=====  =====

.. container:: row

    .. container:: col-md-6

        Left column.

    .. container:: col-md-6

        Right column.

.. class:: text-muted

    A paragraph with a custom class.

.. raw:: html

    <span id="raw-html-proof" class="badge badge-dark">raw html is enabled</span>

Math: :math:`a^2 + b^2 = c^2`
