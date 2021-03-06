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
""" A course class with some modification for users """

from collections import OrderedDict
from datetime import datetime

from common.courses import Course
from frontend.accessible_time import AccessibleTime
from frontend.base import get_database
from frontend.custom.tasks import FrontendTask
from frontend.user_data import UserData


class FrontendCourse(Course):

    """ A course with some modification for users """

    _task_class = FrontendTask

    def __init__(self, courseid):
        Course.__init__(self, courseid)

        if self._content.get('nofrontend', False):
            raise Exception("That course is not allowed to be displayed directly in the frontend")

        if "name" in self._content and "admins" in self._content and isinstance(self._content["admins"], list):
            self._name = self._content['name']
            self._admins = self._content['admins']
            self._accessible = AccessibleTime(self._content.get("accessible", None))
            self._registration = AccessibleTime(self._content.get("registration", None))
            self._registration_password = self._content.get('registration_password', None)
            self._registration_ac = self._content.get('registration_ac', None)
            if self._registration_ac not in [None, "username", "realname", "email"]:
                raise Exception("Course has an invalid value for registration_ac: " + courseid)
            self._registration_ac_list = self._content.get('registration_ac_list', [])
        else:
            raise Exception("Course has an invalid description: " + courseid)

    def get_name(self):
        """ Return the name of this course """
        return self._name

    def get_admins(self):
        """ Return a list containing the username of the administrators of this course """
        return self._admins

    def is_open_to_non_admin(self):
        """ Returns true if the course is accessible by users that are not administrator of this course """
        return self._accessible.is_open()

    def is_open_to_user(self, username):
        """ Returns true if the course is open to this user """
        return (self._accessible.is_open() and self.is_user_registered(username)) or username in self.get_admins()

    def is_registration_possible(self, username):
        """ Returns true if users can register for this course """
        return self._accessible.is_open() and self._registration.is_open() and self.is_user_accepted_by_access_control(username)

    def is_password_needed_for_registration(self):
        """ Returns true if a password is needed for registration """
        return self._registration_password is not None

    def get_registration_password(self):
        """ Returns the password needed for registration (None if there is no password) """
        return self._registration_password

    def register_user(self, username, password=None, force=False):
        """ Register a user to the course. Returns True if the registration succeeded, False else. """
        if not force:
            if not self.is_registration_possible(username):
                return False
            if self.is_password_needed_for_registration() and self._registration_password != password:
                return False
        if self.is_open_to_user(username):
            return False  # already registered?
        get_database().registration.insert({"username": username, "courseid": self.get_id(), "date": datetime.now()})
        return True

    def unregister_user(self, username):
        """ Unregister a user from this course """
        get_database().registration.remove({"username": username, "courseid": self.get_id()})

    def is_user_registered(self, username):
        """ Returns True if the user is registered """
        return (get_database().registration.find_one({"username": username, "courseid": self.get_id()}) is not None) or username in self.get_admins()

    def get_registered_users(self, with_admins=True):
        """ Get all the usernames that are registered to this course (in no particular order)"""
        l = [entry['username'] for entry in list(get_database().registration.find({"courseid": self.get_id()}, {"username": True, "_id": False}))]
        if with_admins:
            return list(set(l + self.get_admins()))
        else:
            return l

    def get_accessibility(self):
        """ Return the AccessibleTime object associated with the accessibility of this course """
        return self._accessible

    def get_registration_accessibility(self):
        """ Return the AccessibleTime object associated with the registration """
        return self._registration

    def get_user_completion_percentage(self, username=None):
        """ Returns the percentage (integer) of completion of this course by the current user (or username if it is not None)"""
        if username is None:
            import frontend.user as User
            username = User.get_username()
        cache = UserData(username).get_course_data(self.get_id())
        if cache is None:
            return 0
        if cache["total_tasks"] == 0:
            return 100
        return int(cache["task_succeeded"] * 100 / cache["total_tasks"])

    def get_user_grade(self, username=None):
        """ Return the grade (a floating-point number between 0 and 100) of the user (if username is None, it uses the currently logged-in user) """
        if username is None:
            import frontend.user as User
            username = User.get_username()
        cache = UserData(username).get_course_data(self.get_id())
        if cache is None:
            return 0
        total_weight = 0
        grade = 0

        for task_id, task in self.get_tasks().iteritems():
            if task.is_visible_by_user(username):
                total_weight += task.get_grading_weight()
                grade += cache["task_grades"].get(task_id, 0.0) * task.get_grading_weight()

        if total_weight == 0:
            return 0

        return grade / total_weight

    def get_user_last_submissions(self, limit=5, one_per_task=False):
        """ Returns a given number (default 5) of submissions of task from this course """
        from frontend.submission_manager import get_user_last_submissions as extern_get_user_last_submissions
        task_ids = []
        for task_id in self.get_tasks():
            task_ids.append(task_id)
        return extern_get_user_last_submissions({"courseid": self.get_id(), "taskid": {"$in": task_ids}}, limit, one_per_task)

    def get_tasks(self):
        return OrderedDict(sorted(Course.get_tasks(self).items(), key=lambda t: t[1].get_order()))

    def get_access_control_method(self):
        """ Returns either None, "username", "realname", or "email", depending on the method used to verify that users can register to the course """
        return self._registration_ac

    def get_access_control_list(self):
        """ Returns the list of all users allowed by the AC list """
        return self._registration_ac_list

    def is_user_accepted_by_access_control(self, username):
        """ Returns True if the user is allowed by the ACL """
        if self.get_access_control_method() is None:
            return True
        elif self.get_access_control_method() == "username":
            return username in self.get_access_control_list()
        elif self.get_access_control_method() == "realname":
            return UserData(username).get_data()["realname"] in self.get_access_control_list()
        elif self.get_access_control_method() == "email":
            return UserData(username).get_data()["email"] in self.get_access_control_list()
        return False
