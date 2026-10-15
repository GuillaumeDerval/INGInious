# Task editor: subproblems editor (code, single-line code, file, match, multiple choice)

- **ID**: CADM-12
- **Actors**: course admin, superadmin
- **Routes**: part of `GET|POST /admin/<courseid>/edit/task/<taskid>` (CADM-10)
- **Depends on**: CADM-10; TASK-02..06 (student rendering/checking of each problem type); reference `docs/reference/task-model.md` §4
- **Legacy code**: `legacy/inginious/frontend/templates/course_admin/edit_tabs/subproblems.html:L1-L24`; `templates/course_admin/task_edit.html:L100-L147` (per-type templates); `templates/course_admin/subproblems/{code,file,match,multiple_choice,multiple_choice_templates}.html`; `task_problems.py:L38-L245` (`show_editbox`, `get_type_name`); `common/tasks_problems.py:L62-L462` (`parse_problem`, constructors = validation); `static/js/studio.js:L24-L48,L328-L592`

## Use case
The admin defines the questions ("subproblems") of a task, each with an id, a type and type-specific options, and
orders them.

## Main flow
1. Tab "Subproblems": accordion `#accordion` with one card per existing problem (built client-side by `studio_load(problem_data)` from the per-type hidden templates `#subproblem_<type>` with `PID` replaced by the problem id). If there is more than one problem all cards start collapsed.
2. Card header: "Problem id: <pid>" (click toggles collapse), links ↑ `studio_subproblem_up(pid)`, ↓ `studio_subproblem_down(pid)` (fade animation, DOM reorder), trash `studio_subproblem_delete(pid)` (confirm "Are you sure that you want to delete this subproblem?", removes its CodeMirror editors from `codeEditors`).
3. Common fields in every card: hidden `problem[<pid>][type]` = type key, hidden `problem[<pid>][@order]` (set to DOM index on save), text `problem[<pid>][name]` "Name" (placeholder "A title for this question"), textarea `problem[<pid>][header]` "Context" (CodeMirror rst, 10 lines).
4. New problem row: text `#new_subproblem_pid` "New problem id" (placeholder "new-problem-id"), select `#new_subproblem_type` "Problem type" (options `subproblem_<type>` labelled by `get_type_name`: "code", "single-line code", "file upload", "match", "multiple choice", + plugin types), button "Add". JS validation: `/^[a-zA-Z0-9_\-]+$/` else alert 'Problem id should only contain alphanumeric characters (in addition to "_" and "-").'; existing id → alert "This problem id is already used." (verified). New card appended at the bottom.

### Type-specific fields and server parsing (`parse_problem`) — verified output
| Type | Form fields (`problem[<pid>][…]`) | Stored |
|---|---|---|
| `code` "code" | `language` text "Language" (placeholder "Language used in this question (c/cpp/java/python/oz/...)"); disabled select "Type: Multiline code" (not posted); `optional` checkbox "Optional?"; `default` textarea "Default value" (CodeMirror, 10 lines); `offset` text "Code line offset" (placeholder "Line offset for the code block. Must be a number.") | `optional: 'on'` (string! absent when unchecked); `offset`: removed if empty, else int ≥ 1 ("Your browser returned an invalid form (Line offset must be positive!)" / "(Line offset must be an integer!)"); `language` must match `[a-z0-9\-_\.]+` else "Invalid data: Invalid language c++"; `header: ''`, `default: ''` kept as strings |
| `code_single_line` "single-line code" | same without `language` and `offset`; `default` is a single-line `<input>` (CodeMirror 1 line, placeholder "No default value") | `default`, `optional: 'on'` |
| `file` "file upload" | `allowed_exts` text "Allowed file extensions (including the dot, separated by commas)" (placeholder ".txt,.zip,.gz"); `max_size` text "Maximum file size (in bytes)" (placeholder "1000000"); disabled select "File upload" | `allowed_exts`: `""` → key removed, else list of stripped items (`.py, .txt` → `[.py, .txt]`); `max_size`: int or key removed if not parseable |
| `match` "match" | `answer` text "Answer"; `centralize` checkbox "Count error only at top of the page?" | `answer` string (e.g. `'42'`); `centralize: true` when checked (absent otherwise); missing `answer` → "Invalid data: There is no answer in this problem with type==match" |
| `multiple_choice` "multiple choice" | `multiple` checkbox "Can select multiple answers"; `unshuffle` "Unshuffle answers"; `centralize` "Count error only at top of the page?"; `limit` text "Number of choices to display (0 = all choices)" (default 0); `success_message`, `error_message` textareas (CodeMirror rst 1 line, placeholders "An optional success message"/"An optional error message"); "Choices" list + button "Add new choice" | `multiple/unshuffle/centralize: true` when present; `limit`: int or removed; empty `success_message`/`error_message` removed; `choices` = list sorted by numeric index of `problem[pid][choices][<i>][…]` |

Multiple-choice choice row (template `#subproblem_multiple_choice_choice`, `CHOICE` = first free index): textarea `choices][i][text]` "Content" (CodeMirror rst 1 line), textarea `choices][i][feedback]` "Feedback message (displayed when selected)", hidden checkbox `choices][i][valid]` toggled by a button "Valid ?" (red ✗ ↔ green ✓, `studio_toggle_choice`), button "Delete" (`studio_delete_choice`). Stored choice: `{text, feedback?, valid?: true}` (empty feedback removed, `valid` only when true).
Validation by `MultipleChoiceProblem`: needs `choices` list, each with `text`; at least one valid → "Invalid data: Problem <pid> does not have any valid answer"; `limit` must be int ≥ 0 and, when `multiple`, either 0 or ≥ number of valid choices → else "Invalid data: Invalid limit in problem <pid>".

Verified written problems block (UI order kept, inner key order = form order):
```yaml
problems:
    q1:
        type: code
        name: Code Q
        header: ''
        language: python
        optional: 'on'
        default: ''
        offset: 3
    q2:
        type: code_single_line
        name: ''
        header: ''
        default: ''
    q3:
        type: file
        name: File Q
        header: ''
        allowed_exts:
        - .py
        - .txt
        max_size: 1000
    q4:
        type: match
        name: Match Q
        header: ''
        answer: '42'
        centralize: true
    q5:
        type: multiple_choice
        name: MCQ
        header: ''
        multiple: true
        limit: 2
        choices:
        -   text: 'Yes'
            feedback: good
            valid: true
        -   text: 'No'
```

## Alternative / error flows
- Problem ids are validated server-side by `id_checker` (`[a-z0-9\-\._]+`, which also allows `.`), client-side by `[a-zA-Z0-9_\-]+`.
- Duplicate pid via crafted POST is impossible (dict keys). Problem order comes only from `@order` (int); missing → error.
- Initialisation for an existing problem (`studio_init_template_<type>`): code: language, optional checkbox (truthy), default (CodeMirror), offset; file: max_size, `allowed_exts.join()` (comma without space); match: centralize, answer; MCQ: limit (default 0), multiple/centralize/unshuffle, messages, choices (valid ones pre-toggled). A plugin problem type must provide `studio_init_template_<type>` JS and `show_editbox(_templates)` HTML.
- Translations: names/headers are stored untranslated (gettext ids); nothing language-specific is written.

## Data
- `task.yaml` `problems` (ordered map pid → problem dict).

## Permissions & security
- Admin only. Problem headers/choices are rendered for students with the RST renderer described in the rst-rendering
  reference (the `include` directive is disabled) and the resulting HTML is always sanitized (allow-list).

## Acceptance tests
- Add one problem of each type with the values above, save → exactly the YAML above (or typed-equivalent where the legacy stores `'on'`; the backend/student side must treat `optional: 'on'` as true).
- Reorder with ↑/↓ → `problems` order follows; delete → removed.
- Each validation error message reproduced (offset 0/x, language `c++`, MCQ without valid answer, invalid limit, match without answer).
- Re-opening the editor shows all values (round-trip).
