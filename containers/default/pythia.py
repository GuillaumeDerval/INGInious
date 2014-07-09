import json
import sys
import shutil
import os
import resource
import subprocess

#Copy /ro/task (which is read-only) in /task. Everything will be executed there
shutil.copytree("/ro/task","/task")

#Change directory to /task
os.chdir("/task")

#Parse input to return stupid output
input = json.loads(sys.stdin.readline())
problems = {}
for boxId in input:
    taskId = boxId.split("/")[0]
    problems[taskId] = str(input[boxId])

def setlimits():
    resource.setrlimit(resource.RLIMIT_CPU, (1, 1))

p = subprocess.Popen(["/task/run"], preexec_fn=setlimits, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
p.wait()
text = "It's a test. Here is what /task/run returned: "+str(p.stdout.read())
print json.dumps({"result":"failed","text":text,"problems":problems})