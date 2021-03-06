# -*- coding: utf-8 -*-
#
# Copyright (c) 2014-2015 Université Catholique de Louvain.
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
from collections import OrderedDict
import web

from common.task_file_managers.manage import get_readable_tasks
from frontend.base import get_database
from frontend.base import renderer
from frontend.pages.course_admin.utils import make_csv, get_course_and_check_rights


class CourseTaskListPage(object):

    """ List informations about all tasks """

    def GET(self, courseid):
        """ GET request """
        course = get_course_and_check_rights(courseid)
        return self.page(course)

    def submission_url_generator(self, course, taskid):
        """ Generates a submission url """
        return "/admin/" + course.get_id() + "/submissions?dl=task&task=" + taskid

    def page(self, course):
        """ Get all data and display the page """
        data = list(get_database().user_tasks.aggregate(
            [
                {
                    "$match":
                    {
                        "courseid": course.get_id(),
                        "username": {"$in": course.get_registered_users()}
                    }
                },
                {
                    "$group":
                    {
                        "_id": "$taskid",
                        "viewed": {"$sum": 1},
                        "attempted": {"$sum": {"$cond": [{"$ne": ["$tried", 0]}, 1, 0]}},
                        "attempts":{"$sum": "$tried"},
                        "succeeded": {"$sum": {"$cond": ["$succeeded", 1, 0]}}
                    }
                }
            ]))

        # Load tasks and verify exceptions
        files = get_readable_tasks(course.get_id())
        output = {}
        errors = []
        for task in files:
            try:
                output[task] = course.get_task(task)
            except Exception as inst:
                errors.append({"taskid": task, "error": str(inst)})
        tasks = OrderedDict(sorted(output.items(), key=lambda t: t[1].get_order()))

        # Now load additionnal informations
        result = OrderedDict()
        for taskid in tasks:
            result[taskid] = {"name": tasks[taskid].get_name(), "viewed": 0, "attempted": 0, "attempts": 0, "succeeded": 0, "url": self.submission_url_generator(course, taskid)}
        for entry in data:
            if entry["_id"] in result:
                result[entry["_id"]]["viewed"] = entry["viewed"]
                result[entry["_id"]]["attempted"] = entry["attempted"]
                result[entry["_id"]]["attempts"] = entry["attempts"]
                result[entry["_id"]]["succeeded"] = entry["succeeded"]
        if "csv" in web.input():
            return make_csv(result)
        return renderer.course_admin.task_list(course, result, errors)