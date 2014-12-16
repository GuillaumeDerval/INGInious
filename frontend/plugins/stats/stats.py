# -*- coding: utf-8 -*-
#
# Copyright (c) 2014 Université Catholique de Louvain.
#
# This file is part of INGInious.
#
# INGInious is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# INGInious is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public
# License along with INGInious.  If not, see <http://www.gnu.org/licenses/>.
""" Stat plugin """
from datetime import datetime, timedelta
import os
import threading
#import time

import psutil
import pymongo
import web

from frontend.base import get_database, get_template_renderer


class StatPage(object):

    """ Returns statistics about INGInious and the server on which it is running """

    def GET(self):
        """ GET request """
        user_input = web.input()
        if "data" not in user_input:
            renderer = get_template_renderer('frontend/plugins/stats', '../../../templates/layout')

            # Get last monitoring infos
            monitoring_info = StatManager.get_instance().compute_monitoring_infos()

            return renderer.stats(monitoring_info, StatManager.get_instance().running_jobs)


class StatManager(object):

    """ Collects data about INGInious and the server on which it is running """

    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(StatManager, cls).__new__(cls, *args, **kwargs)
        return cls._instance

    @classmethod
    def get_instance(cls):
        """ get the instance of StatManager """
        return cls._instance

    def __init__(self, plugin_manager, config):
        # Init database
        get_database().server_monitoring.ensure_index([("datetime", pymongo.ASCENDING)])
        get_database().stats_jobs.ensure_index([("started", pymongo.ASCENDING)])
        get_database().stats_jobs.ensure_index([("ended", pymongo.ASCENDING)])
        get_database().stats_jobs.ensure_index([("started", pymongo.ASCENDING)])
        get_database().stats_jobs.ensure_index([("courseid", pymongo.ASCENDING), ("taskid", pymongo.ASCENDING)])

        # Add some hooks
        plugin_manager.add_hook("new_job", self._new_job)
        plugin_manager.add_hook("job_ended", self._job_ended)

        # Init everything else
        self.running_jobs = {}
        self.jobs_recently_done = []

        self.config = config
        self.update_time = int(self.config.get("update_time", 30))
        if self.update_time < 10:
            self.update_time = 30

        self.last_update = datetime.now()

    def _new_job(self, jobid, task, statinfo, inputdata):
        """ Hook called when a job begins """
        self.running_jobs[jobid] = {
            "courseid": task.get_course_id(),
            "taskid": task.get_id(),
            "launcher": statinfo["launcher_name"],
            "started": datetime.now()
        }

    def _job_ended(self, jobid, task, statinfo, result):
        """ Hook called when a job ends """
        data = self.running_jobs[jobid]
        data["ended"] = datetime.now()
        data["result"] = result["result"]
        del self.running_jobs[jobid]
        self.jobs_recently_done.append(data)
        get_database().stats_jobs.insert(data)

    def run(self):
        """ Collect data """
        threading.Timer(self.update_time, self.run).start()
        # Delete infos about old jobs
        if self.config.get("keep_jobs_done", 0) != 0:
            get_database().stats_jobs.remove({"ended": {"$lt": datetime.now() - timedelta(minutes=self.config.get("keep_jobs_done"))}})
        # Delete other infos
        if self.config.get("keep_monitoring_info", 0) != 0:
            get_database().server_monitoring.remove({"datetime": {"$lt": datetime.now() - timedelta(minutes=self.config.get("keep_monitoring_info"))}})

        monitoring_info = self.compute_monitoring_infos()
        self.jobs_recently_done = []
        self.last_update = datetime.now()
        get_database().server_monitoring.insert(monitoring_info)

    def compute_monitoring_infos(self):
        """ Computes instant monitoring infos. Can be called async from another part of the code """
        # Get basic infos
        monitoring_info = {
            "datetime": datetime.now(),
            "running_jobs": len(self.running_jobs),
            "load_average": os.getloadavg()[0],
            "cpu_percent": psutil.cpu_percent(),
            "memory_percent": psutil.virtual_memory().percent,
            "swap_percent": psutil.swap_memory().percent,
            "disk_percent": psutil.disk_usage('/').percent,
            "processes": len(psutil.pids()),
            "mwt": 0
        }

        # Get Median Waiting Time (mwt)
        waiting_time = timedelta()
        waiting_count = 0
        # Compute mwt from recently finished jobs...
        for jobdata in self.jobs_recently_done:
            waiting_time += jobdata["ended"] - jobdata["started"]
            waiting_count += 1
        # ... and from running jobs
        for jobdata in self.running_jobs.itervalues():
            waiting_time += datetime.now() - jobdata["started"]
            waiting_count += 1
        if waiting_count == 0:
            waiting_count = 1
        monitoring_info["mwt"] = waiting_time.total_seconds() / waiting_count
        return monitoring_info


def init(plugin_manager, config):
    """
        Plugin for stats and monitoring of INGInious

        Available configuration:
        ::

            {
                "plugin_module": "frontend.plugins.stats.stats",
                "users": [],
                "update_time": 30,
                "keep_jobs_done": 0,
                "keep_monitoring_info": 0,
            }

        *users*
            Users that have the rights to see the statistics.
        *update_time*
            Second between each computation of statistics. Must be greater than 10 seconds.
            Default: 30.
        *keep_jobs_done*
            Time, in minutes, before deleting old statistics about old jobs in database.
            0 = infinite. Default: 0.
        *keep_monitoring_info*
            Time, in minutes, before deleting old monitoring information in database.
            0 = infinite. Default: 0.
    """
    StatManager(plugin_manager, config).run()
    plugin_manager.add_page("/statistics", "frontend.plugins.stats.stats.StatPage")
