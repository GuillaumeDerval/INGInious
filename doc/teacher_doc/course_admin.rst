Course administration
=====================

As a course administrator, you can simply access its management
pages with the *Course administration* link of the course menu.

Students submissions
--------------------
Statistics over students submissions are largely available in INGinious,
and all the files related to them are stored and can be downloaded.

General overview
````````````````
The administration page gives you several global list views :

- All the tasks of a course, with  the number of students who viewed the
  task at least one time, who tried and the number of tries, as well as the
  number of students who succeded the task.
- All the students/groups of a course, with the number of tasks tried and done,
  as well as its global progression for students.
- All the students/groups who tried a given task, if they succeded it, and the
  number of submissions they did. This view is also reachable from the task page.
- All the tasks tried by a given student/group, if (s)he/they succeded it and the
  number of submissions (s)he/they did, reachable from the student/group list of a course.
- All the submissions made by a student/group for a given tasks, with date of
  submission and the global result, reachable from these lists.

All the tables can be downloaded in CSV format to make some further
treatment in your favourite spreadsheet editor.

More information about groups_ possibilities can be found below.

Downloading submissions
```````````````````````

Student submissions can be downloaded from the *Download submissions* and statistics pages or the submission
inspection page. You are able to only download the set of evaluation submissions (according to the task parameters)
or all the submissions.

Submissions are downloadable as gzip tarball (.tgz) files. You may need some third-party software if your operating
system does not support this format natively. The files contain, for each submissions, a test file
with extension *test* containing the all the submission metadata and the associated archive folder containing all the
files that have been exported (via the `/archive` folder inside the container) (See :ref:`run_file`).

Replaying submissions
`````````````````````
Student submissions can be replayed from the submission inspection page. You can either replay a specific submission or replay all the submissions queried (with the replay button in the table's header). Different replay scheme are available:

- As replacement of the current student submission result. This is the default scheme for the *Replay submissions* page.
  When replayed, submission input are put back in the grading queue. When the job is completed, the newly computed
  result will replace the old one. This is useful if you want to change the grading scripts during or after the assignment
  period and want all students to be graded the same way. You can replay only the evaluation submission or all submissions.
  However, please note that if replayed, the best submission can be replaced by an older best submission.
- As a personal copy. This mode is only available from the submission inspection page and copy the student input to
  generate a new personal copy. This is useful for debugging if a problem occur with a specific student submission.
  Submission copy is also available with SSH debug mode.

.. WARNING::
    This feature is currently under testing. As the same job queue is used for standard submissions and submission
    replay, it is recommended not to launch huge replay jobs on a very active INGInious instance.


Task edition
------------

All tasks can be edited from the webapp. The task editor is reached from the *Task list* page of the course
administration, which also allows to add new tasks to a section by entering a new task id.
When editing a task, you can enter basic informations and parameters in the *General* section.

Based on the type of problem you want to put for the task, you can select one of the available *grading environments*
in the *Grading environment* section:

- Select **Multiple Choice Question solver** if you only want to add *mcq* or *match* types of problems. Note, the *math* problem type from the problems-math plugin also uses this grading environment.
- Select a container (**Standard container**, possibly with SSH or GPUs) if you want to add some more complex problems which requires to write a grading script to access the students inputs.

Adding/removing problems
````````````````````````
Adding and removing problems in a task is very easy with the task editor. In the *Problems* section, add a new
problem-id (alphanumerical characters) and a problem type. You can configure the problem context from this section.

There are two ways to grade a problem:

 - Using **check_answer** which is only implemented for *mcq* and *match* problems
 - Using a specific **grading script** which is required for more complex problems

**mcq** and **match** problems can be entirely configured from the task editor with the option to set up answers.
When editing a multiple choice problem, you're asked if the student is
shown a multiple-answers- or single-answer-problem and which of the
possible choices is (are) good answer(s).

**check_answer** is only available for *mcq* and *match* problems and is automatically used when using the *Multiple Choice Question Solver* environment. So if you are adding more complex problems such as asking students for code implementation, you will have to write your own grading script. If you are creating this kind of problems, remember to select a container as *grading environment* in the *Grading environment* section.

Note only a few types of problems are shipped with INGInious. The additional problem types of the
`INGInious plugins repository <https://github.com/INGInious/plugins>`_ are Python plugins of the former frontend:
they cannot be loaded by the current web frontend.

Task files
``````````

Task files can be created, uploaded and modified from the *Task files* of the task editor.
Only text-base files can be edited from the webapp. Binary files can however be uploaded.

The behaviour of the *Move* action is Unix-like : it can be used for renaming files.

.. _groups:

Audiences
---------

*Audiences* are useful to administratively separate
students following the same course. They offer separate statistics to
help the teacher identify problems students may encounter in this particular context.


Creation and edition
````````````````````

Audiences are created and edited from the web app in the course
administration.

In the audiences list view, create a new audience by giving its description. The newly created audience will appear
in the list.

When editing an audience, you'll be able to change the audience description,
the associated teaching staff, and to specify the students.
Assigning tutors will help them to retrieve their audience statistics.

Course structure upload
```````````````````````

You can generate the course audience structure and populate it with a csv file upload
on INGInious. The structure of the attented file is described below.
The file can be uploaded on the audience list view in the course administration.

CSV file structure
******************

The file doesn't need any header and is populate based on a person per line structure:

::

    user_id , id_field , user_role , description

A comma ``,`` is used to separate the items while the quote char is ``"``.

-   *user_id* is a string that identify the user. Based on the id_field this may take several form. Most common is the username but is not the only one. you may, for example, give email to identify the user.
-   *id_field* is a string that corresponds to the type of user_id. It can be values used on user creation (like username, email).
-   *user_role* is a string that simply represent the role of the user. it can be ``student`` or ``tutor``
-   *description* is a string and corresponds to your audience description. Line with the same description will be merged within the same audience.



Groups
------

Collaborative work is possible in INGInious. *Groups* define a set of users that
will submit together. Their submissions will contain as authors all the students
that were members of the group at submission time.

Creation and edition
````````````````````
Groups are created and edited from the web app in the course
administration.

A new group is created from the group list view. You'll then be able to specify the group description, its maximum
size, assigned tutors and students, as well as the required audiences to enter the group. Students can be moved
from one group to another.

Group attribution
``````````````````

If you do not really matter the way students work together, you can
set empty groups with maximum size and allowed audiences and let the students choose their
groups or groups themselves. Just check the option in the course settings to
allow them to gather. When submissions will be retrieved, the group members will
be displayed as the authors as with staff-defined groups or groups.

Course structure upload
```````````````````````

You can generate the course group structure with an external tool
and then upload it on INGInious. This is done with a YAML file, which structure
for groups are similar and described below. The course structure
can be uploaded on the group list view in the course administration.

Group YAML structure
********************

::

    -    description: Group 1
         tutors:
                 - tutor1
                 - tutor2
         students:
                 - user1
                 - user2
         audiences:
                - 5daffce21d064a2fb1f67527
                - 5daf00d61d064a6c25ed7be1
    -    description: Group 2
         tutors:
                 - tutor1
                 - tutor2
         students:
                 - user3
                 - user4

-   *description* is a string and corresponds to your group description
-   *tutors* is a list of strings representing the usernames of the
    assigned group tutors.
-   *students* is a list of strings representing the usernames of the
    group students.
-   *audiences* is a list of authorized audiences identifiers.

Backup course structure
```````````````````````

Course structures (audiences and groups) can be exported for backup or manual
edition via the audience/group list page in the course administration pages.
Simply click on the "*Download structure*" button. The download file will have
the same format as described above.
