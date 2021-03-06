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
""" YAML task file manager """

import common.custom_yaml
from common.task_file_managers.abstract_manager import AbstractTaskFileManager


class TaskYAMLFileManager(AbstractTaskFileManager):

    """ Read and write task descriptions in YAML """

    def _get_content(self, content):
        return common.custom_yaml.load(content)

    @classmethod
    def get_ext(cls):
        return "yaml"

    def _generate_content(self, data):
        return common.custom_yaml.dump(data)
