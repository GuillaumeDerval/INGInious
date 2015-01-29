#!/usr/bin/env python
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
""" Starts an agent """

import argparse
import logging
import commentjson

from backend_agent.agent import Agent
if __name__ == "__main__":
    # parse args
    parser = argparse.ArgumentParser()
    parser.add_argument("-c", "--configfile", default="./configuration.json", help="Configuration file to use. By default, it is ./configuration.json")
    args = parser.parse_args()

    # create logger
    logger = logging.getLogger("agent")
    logger.setLevel(logging.WARN)
    ch = logging.StreamHandler()
    ch.setLevel(logging.WARN)
    formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    ch.setFormatter(formatter)
    logger.addHandler(ch)

    # get config file
    try:
        config = commentjson.load(open(args.configfile))
    except Exception as e:
        logger.error("Cannot read configuration file! %s", str(e))
        exit(1)

    # Start the agent
    Agent(config.get('local_agent_port', 5001),
          config.get('containers', {"default": "ingi/inginious-c-default", "sekexe": "ingi/inginious-c-sekexe"}),
          tmp_dir=config.get("local_agent_tmp_dir", "/tmp/inginious_agent"))
