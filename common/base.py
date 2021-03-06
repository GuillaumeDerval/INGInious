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
""" Basic dependencies for every modules that uses INGInious """
import codecs
import json
import os.path
import re

import common.custom_yaml


class Configuration(dict):

    """ Config class """

    def load(self, path):
        """ Load the config from a file """
        self.update(load_json_or_yaml(path))

INGIniousConfiguration = Configuration()


def id_checker(id_to_test):
    """Checks if a id is correct"""
    return bool(re.match(r'[a-z0-9\-_]+$', id_to_test, re.IGNORECASE))


def load_json_or_yaml(file_path):
    """ Load JSON or YAML depending on the file extension. Returns a dict """
    if os.path.splitext(file_path)[1] == ".json":
        return json.load(open(file_path, "r"))
    else:
        return common.custom_yaml.load(open(file_path, "r"))


def write_json_or_yaml(file_path, content):
    """ Load JSON or YAML depending on the file extension. """
    if os.path.splitext(file_path)[1] == ".json":
        o = json.dumps(content, sort_keys=False, indent=4, separators=(',', ': '))
    else:
        o = common.custom_yaml.dump(content)

    with codecs.open(file_path, "w", "utf-8") as f:
        f.write(o)
