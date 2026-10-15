# Audiences tab: list, statistics, CSV export, creation

- **ID**: CSTU-04
- **Actors**: course admin, tutor, superadmin
- **Routes**: `GET /admin/<courseid>/students?audiences` (opens tab), `GET /admin/<courseid>/students?csv_audiences`, `POST /admin/<courseid>/students` with field `audience`
- **Depends on**: CSTU-01, CSTU-05 (edit), CSTU-06 (CSV structure import/export), CSTU-11 (submissions filtered by audience)
- **Legacy code**: `pages/course_admin/student_list.py:L74-L96,L117-L147` (`get_audiences_params`), `L166-L176` (creation), `templates/course_admin/student_list.html:L79-L207`, `user_manager.py:L610-L612` (`get_course_audiences`, natsorted by description)

## Use case
Audiences are named subsets of the students (e.g. lab sessions, curricula) with assigned tutors.
Staff see the list of audiences with how many students they contain and how many tasks the
audience tried/succeeded, export it, and create new empty audiences.

## Preconditions
Staff rights on the course.

## Main flow
1. Tab "Audiences" lists audiences split into two sections when both are non-empty:
   "My audience(s)" (session user ∈ `audience.tutors`) and "Other audience(s)". Order: natural sort of `description`.
2. For every audience: aggregation on `submissions` with `{courseid, taskid ∈ course tasks on disk, username ∈ audience.students}`
   grouped by `taskid` → `tried` = number of tasks with ≥1 submission, `done` = number of tasks with ≥1 submission whose `result == "success"`.
3. Columns: `audience` (description), `# students` (len(students)), `# task tried`, `# task done`, actions
   "Edit audience" (→ `/admin/<id>/edit/audience/<audienceid>`) and "View submissions"
   (→ `/admin/<id>/submissions?audiences=<audienceid>`).
4. Header actions: "Download CSV" (`?csv_audiences=`), "View all submissions"
   (→ `/admin/<id>/submissions?audiences=<id1>,<id2>,…`), and at the top "Upload audiences" / "Download structure" (CSTU-06).
5. Create: form with text `audience` (placeholder "New audience description") + "New audience" button →
   `audiences.insert({description, courseid, students: [], tutors: []})`; message (green) "New audience created."; tab Audiences active.

## Alternative / error flows
- Empty description is accepted (verified: creates an audience with `description: ''`).
- Exception during creation → red "User returned an invalid form.".
- Messages for this tab are displayed from `msg["audiences"]`; `error["audiences"]` selects red vs green.

## UI elements
See above. Tooltips "Download CSV", "View all submissions", "Edit audience", "View submissions".

## Data
- `audiences` collection: `{_id: ObjectId, description: str, courseid: str, students: [username], tutors: [username]}`.
- `?csv_audiences` → `make_csv(audiences)` where the dict is keyed by audience id with values = the audience
  document + `tried`, `done`. Verified output:
  ```
  id,_id,courseid,description,done,students,tried,tutors
  6acf13ac…0778,6acf13ac…0778,cstu_course,Group A,1,"['cstu_eve', 'cstu_bob']",2,['cstu_tutor']
  ```
  (lists are Python reprs; filename `export.csv`).

## Permissions & security
- Creation allowed to tutors (server accepts staff; UI shows the form to tutors too).
- CSV text cells starting with a formula character (`=`, `+`, `-`, `@`, tab, carriage return) are neutralised (prefixed with `'`) in the CSV export.
- `tried`/`done` count all submissions (including staff copies) of current audience students.

## Acceptance tests
- Audiences sorted naturally ("A2" before "A10"); split My/Other only when both lists non-empty.
- `# task tried`/`# task done` for a fixture: student with failed + successful submissions on 2 tasks ⇒ tried 2, done 1.
- `?csv_audiences` returns exactly the columns above.
- POST `audience=Lab 1` creates the document with empty lists and shows "New audience created." with Audiences tab active.
- Links: edit link and filtered submissions link contain the audience id.
