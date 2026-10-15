# reStructuredText rendering (legacy `ParsableText`)

## Summary

* All rich text in INGInious (task context, problem headers, multiple-choice choice texts,
  course descriptions, marketplace descriptions, static pages, **and every grader feedback
  message**) is reStructuredText rendered **server-side** by
  `legacy/inginious/frontend/parsable_text.py` with **docutils 0.21.2** (`html4css1` writer,
  subclassed). There is no Markdown mode. An `"html"` mode exists (pytidylib) but has **no
  production caller**, and it **always fails** in the reference container because libtidy is
  not installed.
* Settings: `initial_header_level=3` (2 for static pages), `doctitle_xform=False`,
  `syntax_highlight='none'` (no Pygments; the code is coloured **client-side** by CodeMirror's
  `colorize`), **`raw_enabled=True`** (`.. raw:: html` is allowed; the new app sanitizes the
  output, see §7), `file_insertion_enabled=False`, `math_output='MathJax …'` (math is left as
  `\( … \)` / `\begin{equation*}` for MathJax 2.7.1 in the browser),
  `line_length_limit=len(source)`.
* Custom behaviour: Bootstrap 4 classes for admonitions (`alert alert-*`, or a `card` when
  the `:title:` option is set), tables (`table table-bordered`, `thead-light`), `<code>`
  instead of `<tt>` for inline literals, `target="_blank"` on every link whose `href` does not
  start with `#`, LTI URL rewriting (`asset/<url>?session_id=…`) for relative links and images,
  a `container` directive that does not add the `container` class, plus three INGInious
  extensions: the `hidden-until` directive, the `:time:` role, and `code-block` with no
  content (renders `[no content]`).
* Problems in the source produce inline docutils "System Message" `<div>`s (levels WARNING
  and above). Only a SEVERE error (level 4) or an exception falls back to
  `<b>Parsing failed</b>: <pre>{escaped source}</pre>` (that string is translated).
* The output is inserted as HTML in server-rendered pages and in the feedback loaded through
  AJAX. The new app sanitizes every rendered fragment (see §7).
* Result caching: only per `ParsableText` instance (memoised `parse()`). Task/course objects
  are cached by file mtime, but `get_context()`/`get_description()` build a new `ParsableText`
  on every call, so the RST is parsed again on every page view.

---

## 1. Module anatomy (`legacy/inginious/frontend/parsable_text.py`)

| Lines | Element | Behaviour |
|---|---|---|
| 26-30 | `EmptiableCodeBlock(CodeBlock)` | Registered as `code-block` (l.331). If the directive has no content, the content becomes `[_("[no content]")]`, translated in the **UI language of the session** (fr: `[pas de contenu]`). Note: only the `code-block` name is overridden. `code` and `sourcecode` are still the stock docutils `CodeBlock`, which raises an ERROR system message when the content is empty. |
| 33-37 | `CustomBaseAdmonition(BaseAdmonition)` | `option_spec = {class, name, title}`, so every admonition accepts a `:title:` option. |
| 40-43 | `CustomAdmonition` | Registered as the generic `admonition` (l.320). It takes 1 required argument (the docutils title). That argument is **never displayed** (see the translator below); only `:title:` is shown. |
| 46-90 | `HiddenUntilDirective` | `.. hidden-until:: <date> [<time>]`, with content required (l.53). The arguments are joined with a space and parsed by `accessible_time.parse_date` (`accessible_time.py:11-27`: `datetime.fromisoformat(s).astimezone()`, else `%d/%m/%Y %H:%M:%S`, `%d/%m/%Y %H:%M`, `%d/%m/%Y %H`, `%d/%m/%Y`; naive dates are interpreted in the **server's local timezone**). Invalid date → `self.error(...)`, i.e. an ERROR system message (see the examples). If `date <= now` or `settings.force_show_hidden_until` is set: the content is returned wrapped in `nodes.compound` (`<div class="compound">`). When the date is still in the future and the reader is staff, a `caution` node is put in front of it containing `_("The feedback below will be hidden to the students until :time:`{}`.")` with `isoformat()`. When the date is in the future and the reader is not staff, only a `caution` node is returned, containing `_("A part of this feedback is hidden until {}. Please come back later and reload the submission to see the full feedback.")` with a plain ISO string (no `<time>`). The messages are translated in the session language and are themselves parsed as RST (`nested_parse`). |
| 93-231 | `_CustomHTMLWriter` / `_CustomHTMLTranslator` | Subclass of `docutils.writers.html4css1`. See §2. |
| 233-301 | `ParsableText` | See §3. |
| 305-308 | `_gen_admonition_cls` | Builds an admonition directive (with the `:title:` option) for each specific node class. |
| 311-317 | `time` node + `time_role` | Inline `:time:` role. Its text becomes the `datetime` attribute and the content of a `<time>` element. |
| 320-332 | registrations (global, at import) | `admonition`, `attention`, `caution`, `danger`, `error`, `hint`, `important`, `note`, `tip`, `warning`, `hidden-until`, `code-block`, local role `time`. **There are no `success`/`info`/`primary` directives.** Those words only work as a `:class:` on `admonition` or on another admonition. |

### 1.1 docutils settings (`ParsableText.rst`, l.284-301)

```python
overrides = {
    'initial_header_level': initial_header_level,   # 3 by default; 2 for static pages (pages/utils.py:240)
    'doctitle_xform': False,                        # a lone top title stays a <div class="section"><h3>
    'syntax_highlight': 'none',                     # no Pygments tokens; class "code <lang> literal-block"
    'force_show_hidden_until': show_everything,     # custom setting read by hidden-until
    'raw_enabled': True,                            # .. raw:: html and raw roles are allowed
    'file_insertion_enabled': False,                # include / raw :file: / csv-table :file: -> WARNING "directive disabled"
    'math_output': 'MathJax /this/does/not/need/to/exist.js',  # MathJax-style output; script URL unused (fragment only)
    'line_length_limit': len(string),
}
if debug:   # only used by scripts/autotest.py; ParsableText.parse(debug=True)
    overrides['halt_level'] = 2
    overrides['traceback'] = True
parts = core.publish_parts(source=string, writer=_CustomHTMLWriter(), settings_overrides=overrides)
return parts['body_pre_docinfo'] + parts['fragment']
```

Implicit docutils defaults that matter:

* `report_level = 2`: WARNING (2), ERROR (3) and SEVERE (4) system messages are rendered
  **inline** in the HTML. INFO (1) messages are dropped. All messages are also written to
  stderr (they show up in the container logs).
* `halt_level = 4`: a SEVERE message (e.g. "Title level inconsistent") raises an exception,
  which leads to the fallback described in §3.
* The docinfo transform is still active. A field list at the very top of the document
  (`:author: me`) is consumed as docinfo and **does not appear** in the output (it would go to
  `parts['docinfo']`, which is not returned).
* `smart_quotes` is off by default, so quotes are not converted.
* `input_encoding` does not apply: the source is a `str`, so unicode passes through untouched.
* Section ids are generated from the titles (`id="title"`). Duplicate titles get docutils'
  auto ids.

### 1.2 Translator overrides (`_CustomHTMLTranslator`)

* `visit_container` (l.103-105): `<div>` carrying only the node's classes (no `container`
  class). `.. container:: row` therefore gives `<div class="row">`, and the tutorial relies on
  this to build Bootstrap grids.
* `visit_literal` (l.107-136):
  * The `:code:` role and custom roles based on `code` become `<code class="{other classes}">`
    with the raw text (for `:code:`, `<code>` without a class).
  * Inline literals (``` ``x`` ```) become `<code class="docutils literal">`. Tokens containing
    `-` (docutils' `in_word_wrap_point`) are wrapped in `<span class="pre">`. Runs of N>1 spaces
    become `&nbsp;`×(N-1) followed by a space.
* `starttag` (l.138-149):
  * For every `<a>` whose `href` does not start with `#`: `target="_blank"`. This covers
    external, relative, `mailto:` and image `:target:` links.
  * **LTI rewriting**: when `flask.has_app_context()` and `request.args['session_id']` is
    present, the `href` of `<a>` and the `src` of `<img>` are rewritten by `rewrite_lti_url`
    (l.151-155). URLs with a netloc (`https://…`, `//host/…`) are kept. Everything else
    (relative paths **and `#anchors`**, `mailto:`, `data:` URIs that have no netloc) becomes
    `'asset/' + url + '?session_id=' + session_id`. Images inserted through `.. raw:: html`
    are not rewritten. The rewrite only depends on the query string of the *current request*
    (on the LTI task page under `/lti/…?session_id=…`, the relative `asset/…` resolves to
    the route `/lti/asset/<path:asset_url>`, `flask/mapping.py:92`).
* `visit_table` (l.157-165): `class="docutils table table-bordered {table_style}"`, plus
  `align-{x}` when `:align:` is set (`table_style` defaults to `""`; the emitted attribute is
  exactly `class="docutils table table-bordered"`). There is no `border="1"`.
* `visit_tbody` (l.167-169): no `valign`. `visit_thead` (l.171-173): `<thead class="thead-light">`.
  Header cells are `<th class="head">`. `<colgroup><col width="N%" />` is kept.
  Footnote/citation tables are *not* affected by these overrides (they keep
  `class="docutils footnote" frame="void" rules="none"` and `<tbody valign="top">`).
* `visit_admonition` (l.175-220) / `depart_admonition` (l.222-225). docutils first rewrites
  every specific admonition (`note`, `tip`, …) into a generic `admonition` node: it inserts
  a title child ("Note", …) and adds the class `note`. Then:
  1. `node['classes']` gets `'admonition'` inserted at position 0. The `:class:` values come
     **before** the type class (`.. note:: :class: success` → classes `admonition success note`).
  2. Every class is stripped of the `admonition-` prefix and mapped through `converter`:
     `danger→danger, attention→warning, caution→warning, error→danger, hint→info,
     important→warning, note→default, tip→info, warning→warning, success→success, info→info,
     primary→primary, secondary→secondary, light→light, dark→dark`. The **first** class
     that maps wins. If none maps, the result is `info`.
  3. When `node['title']` (the `:title:` **option**) is set and non-empty, the output is a card:
     `<div class="{classes} card mb-3 border-{cls}">`
     `<div class="{classes} card-header bg-{cls}[ text-white]">{escaped title}</div>`
     `<div class="{classes} card-body">` … `</div></div>`. `text-white` is added unless
     cls ∈ {default, light, secondary}. Note that `bg-default`/`border-default` are not
     Bootstrap classes (a titled `note` card has no colour).
  4. Without a title, the output is `<div class="{classes} alert alert-{cls}">` … `</div>`,
     where `default` is replaced by `light`.
  5. `node.children = node.children[1:]` drops the first child: the generated title
     ("Note") or, for `.. admonition:: X`, the argument title X. The argument title of a
     generic admonition is therefore **never rendered**.
  6. html4css1 "compact paragraph" rules apply: an admonition holding a single paragraph
     renders the text without `<p>`. With several paragraphs, `<p>` is used and the last one
     gets `class="last"`.
* `visit_time`/`depart_time` (l.227-231): `<time datetime="{text}">\n{text}</time>`
  (the starttag suffix inserts a newline). The browser reformats `<time>` elements inside
  `#task_alert` only (`task.js:554-556`, `dtf` Intl formatter from `layout.html:226`).

## 2. `ParsableText` class (l.233-301)

```python
ParsableText(content, mode="rst", show_everything=False)
```

* `mode.lower()` must be `rst` or `html`. Any other value raises `Exception("Unknown text parser: …")`.
* `original_content()` returns the raw source (used by the REST API, see §4).
* `parse(debug=False)` is memoised in `self._parsed`:
  * `html` mode: `tidylib.tidy_fragment(content)[0]` (it tidies the markup).
    **libtidy is missing in the frontend image**, so `tidy_fragment` raises `OSError` and the
    fallback is returned for every input. This mode has no production caller (only
    `tests/test_parsable_text.py:23`).
  * `rst` mode: `ParsableText.rst(content, show_everything, debug=debug)`.
  * Any exception (SEVERE docutils error, directive crash) → `_("<b>Parsing failed</b>: <pre>{}</pre>").format(html.escape(content))`.
    `html.escape` escapes `& < > " '` (`'` becomes `&#x27;`). The wrapper is translated
    (fr: `<b>L'analyse a échoué</b> : <pre>…</pre>`).
  * If `content` is not a `str` (e.g. `None` from an old or broken submission), `html.escape`
    itself raises inside the `except` block, so the exception propagates (HTTP 500).
    An empty string returns `""`.
  * With `debug=True`, it raises `BaseException("Parsing failed")` instead of falling back.
* `__str__`/`__unicode__` call `parse()`. Jinja `{{ x | safe }}` on a `ParsableText` calls `str()`.
* `ParsableText.rst(string, show_everything=False, initial_header_level=3, debug=False)` is a
  classmethod that is also called directly (static pages).

## 3. Call sites (which content is rendered as RST)

| Content | Code | Language / translation | Output inserted by |
|---|---|---|---|
| Task context (`task.yaml: context`) | `tasks.py:172-176` `Task.get_context(language)`: `task.gettext(language, context)` then plugin hook `task_context` (the first hook value replaces it) | task `$i18n` catalog | `templates/task.html:304` `{{ task.get_context(session.language) \| safe }}` (inside `#task_context`); `templates/course_admin/submission.html:86` |
| Problem headers (`problems.<id>.header`) for code, code_single_line, file, multiple_choice, match | `task_problems.py:83,112,149,205,233` | task catalog (`Problem.gettext`, `common/tasks_problems.py:135-139`) | `templates/tasks/{code,single_line_code,file,multiple_choice,match}.html` `{{ header \| safe }}` |
| Multiple-choice choice texts | `task_problems.py:209` (`func=lambda text: ParsableText(gettext(text))`) | task catalog | `templates/tasks/multiple_choice.html:10` `{{ func(choice['text']) \| safe }}` (inside `<label>`) |
| Course description (`course.yaml: description`) | `courses.py:263-266` | course `$i18n` catalog | `templates/course.html:131`, `templates/courselist.html:56` (`\| safe`) |
| Marketplace course description | `marketplace_courses.py:68-75` (per-language dict; the last fallback **parses a language key** of `short_desc`, a bug) | the dict itself | `templates/marketplace_course.html:61` (`\| safe`) |
| Static pages (`STATIC_DIRECTORY/<page>[.<lang>].yaml: content`) | `pages/utils.py:214-243` `ParsableText.rst(content, initial_header_level=2)`. The `.<lang>.yaml` file wins when present. The file is cached by mtime in `INGIniousStaticPage.cache`. | file per language | `templates/static.html:6` `{{ content \| safe }}` |
| Global grader feedback (`submission.text`) | `submission_manager.py:547` | none (raw grader output) | JSON → `task.js` `.html()` |
| Per-problem feedback (`submission.problems[pid]`) | `submission_manager.py:548-567` | none | JSON → `task.js` `.html()` |
| "Feedback is badly formatted." (when `problems[pid]` is neither a str nor a 2-sequence) | `submission_manager.py:563-566`, the result is forced to `'crash'` | UI language | same |
| `scripts/autotest.py:161` | sub-problem headers (offline test tool) | n/a | n/a |

Content that is **not** RST: task/problem/course names, author, tags, the
`feedback_title` string, `custom` values, stdout/stderr, and the MCQ `success_message`/
`error_message`/choice `feedback` *as configured* (those are joined by the MCQ agent into the
problem feedback, which **is** then parsed as RST). The REST API (`pages/api/tasks.py:23-34,92,103`)
returns `original_content()` (raw RST) for the context and the problem fields. `pages/api/submissions.py:49-67`
returns the **rendered HTML** of `feedback`/`problems_feedback`. `plugins/ltibestsubmission`
uses `original_content()`.

`show_everything` (reveals `hidden-until` blocks) is `True` for course staff on the task page
(`pages/tasks.py:237,261`, `is_staff = has_staff_rights_on_course`), always `True` on the
admin submission view (`pages/course_admin/submission.py:56`), and staff-only in the API
(`pages/api/submissions.py:49-52`). Task context/headers/descriptions are always rendered
with `show_everything=False`.

## 4. How grader feedback is rendered (BackendJobDone → browser)

1. **Agent → backend → client**: `BackendJobDone(job_id, result=(result, text), grade,
   problems: Dict[pid, (result, text)], tests, custom, state, archive, stdout, stderr)`
   (`common/messages.py:76-95`). The docker agent fills `text` from the grader's `feedback.text`
   and the problems from `feedback.problems` (`agent/docker_agent/__init__.py:858-888`).
   When the agent cannot read the output, it uses `result="crash"` and
   `text="The grader did not return a readable output : …"`. The client uses
   `("crash", "Backend unavailable, retry later")` / `"Environment not available."`
   (`client/client.py:243,325`). The MCQ agent (`agent/mcq_agent/__init__.py:103-127`)
   builds the problem texts as `"\n\n".join(messages)`, so each message becomes an RST
   paragraph. It replaces the placeholders `_wrong_answer`, `_wrong_answer_multiple` and
   `_correct_answer` with strings translated in `@lang` (the agent's own catalog). The
   global text is `"\n".join([...])` + `"You have {} wrong answer(s)."` etc.
2. **Storage** (`submission_manager.py:55-102`): `status = "done"` if the result is
   success/failed, else `"error"`, plus `result`, `grade`, `text` (raw RST), `problems`
   (raw: `{pid: [result, rst]}`), `tests`, `custom`, `state`, `stdout`, `stderr`. When the
   document is too large: `status="error"`, `text=_("Maximum submission size exceeded. …")`
   (translated in the language of the session that triggered the callback/app context).
   The **raw RST** is stored. Rendering happens at read time, so it depends on the time
   (hidden-until) and the viewer.
3. **Rendering** (`submission_manager.get_feedback_from_submission`, l.540-568):
   * `submission.text = ParsableText(text, "rst", show_everything).parse()`
   * For each problem: if the value is a `str` (old style), it becomes `(submission.result, html)`.
     Otherwise it becomes `(value[0], ParsableText(value[1]).parse())`. On a `TypeError` it
     becomes `('crash', html("Feedback is badly formatted."))`.
4. **JSON** (`pages/tasks.py:275-372` `submission_to_json`). The fields are `status`, `result`,
   `id`, `submitted_on`, `grade` (string), `replace`, `text` (HTML, after the plugin hook
   `feedback_text`), `problems` (`{pid: [result, html]}`), `debug` (admins: the whole Mongo
   document, raw), `title` (an HTML string built from translated templates such as
   `"There are some errors in your answer. Your score is {score}%."` +
   `" [Submission #{id} - <b><time datetime='…'>…</time></b>]"`, then the plugin hook
   `feedback_title`), `input` (when reloading), `tests` (visible tags), and `feedback_script`
   (concatenated JS from the plugin hook `feedback_script`). While the job is waiting:
   `{'status':'waiting','text': translated HTML}`. With SSH debug: `ssh_*` fields.
5. **Browser** (`static/js/task.js`):
   * `waitForSubmission` (l.333-398) polls `POST @action=check` every second. On completion it maps
     the result to an alert type: failed/error/crash → `danger`, success → `success`,
     timeout/overflow/killed → `warning`. It then calls `displayTaskStudentAlertWithProblems`
     and finally runs the `feedback_script` provided by plugins (l.379-380).
   * `displayTaskStudentAlertWithProblems` (l.525-557): `#task_alert.html(getAlertCode(title, text, type, true))`.
     For each problem id known in `problems_types` that has feedback, it calls
     `load_feedback_<type>(pid, [result, html])`, which `.html()`s
     `getAlertCode("", html, alertType, true)` into `#task_alert_<pid>` (the `<div>` at the
     top of each problem template). Per-problem alert type (l.559-566): `success` → success,
     `timeout`/`overflow` → warning, anything else → danger. Then `colorizeStaticCode()`
     (`common.js:46-71`: for each `.code.literal-block`, the first class that
     `CodeMirror.findModeByName` recognises is used with `CodeMirror.colorize`), then
     `MathJax.Hub.Queue(["Typeset", MathJax.Hub])`, then `<time>` elements in `#task_alert` are
     reformatted with `dtf`.
   * `getAlertCode` (l.587-640). With a title, it builds a Bootstrap card
     `card border-{type}` with a header `bg-{type} text-white` holding the title, a dismiss
     button and a `card-body` holding the content. Without a title (problem feedback), it
     builds a two-column card: a left icon column `bg-{type}` showing `&times;` (danger),
     `&#x2713;` (success) or `?`, and the content on the right.
6. **Initial page load**: `task.html` renders no feedback server-side. JS reloads the
   last/selected submission via `@action=load_submission_input` (same JSON, `status:'ok'`).
   The admin submission view (`course_admin/submission.html:146-151`) calls
   `loadOldSubmissionInput` + `waitForSubmission`.

`custom` is never rendered as RST/HTML. It only appears in the admin `debug` JSON and is used
by plugins (scoreboard).

## 5. MathJax and code colouring (client side, required for parity)

* `layout.html:220` loads MathJax 2.7.1 (`TeX-AMS-MML_HTMLorMML`, default delimiters
  `\( \)`/`\[ \]`/`$$`). It typesets the whole page on load and `#task_alert` after each
  feedback (it re-typesets the whole page).
* docutils output for math: role `<span class="math">\(…\)</span>`, directive
  `<div class="math">\n\begin{equation*}\n…\n\end{equation*}\n</div>`.
* Code: `<pre class="code {lang} literal-block">` (for `code-block`, `code` and `sourcecode`
  with a language), `<pre class="code literal-block">` (no language), and
  `<pre class="literal-block">` for `::` literal blocks (these are **not** colourised).
  `<pre class="doctest-block">` is used for doctest blocks. The content is HTML-escaped and
  tabs are expanded to 8 columns by docutils (`tab_width` 8, e.g. `rst-code` output).
  `colorizeStaticCode` also runs on page init (`common.js:12`).

## 6. RST constructs actually used in course material

Survey of `examples/demo-tasks/**` and `infra/tasks/**` (113 YAML files + run scripts +
`task_showcase/rich_feedback/feedback.rst`). Count = number of occurrences:

| Construct | Count | Notes |
|---|---|---|
| `.. class::` | 100 | `text-justify`, `text-muted`, … (applies the class to the next element: `<p class="text-justify">`) |
| `.. container::` | 98 | Bootstrap grid: `row`, `col-xs-8 col-md-9 text-justify`, `col-md-2 text-center` |
| `.. code-block:: <lang>` | 79 | bash, python, c, java, yaml, rst, … ; also empty (`rich_feedback`) |
| `.. raw:: html` | 29 | Font Awesome icons (`<i class="fa fa-comments">`), **inline `<script>` with `document.write(input["@random"])`** (tutorial 07, which needs the global `var input = {"@lang","@username","@random","@state"}` from `task.html:293-300` and synchronous script execution at page load), and `data:` images (container `rst-image`) |
| `.. image::` (+ `:height:`, `:alt:`) | 8 | relative paths such as `$common/inginious.png` (resolved against the task URL `/course/<c>/<t>` → task file route) |
| `.. code::` | 5 | |
| `.. note::`, `tip`, `warning`, `important`, `hint`, `error`, `danger`, `caution`, `attention` | 13 | with and without `:title:` |
| `.. admonition::` + `:class:` (+ `:title:`) | 2 (+ every `rst-msgblock`) | |
| `.. hidden-until::` | 2 | `rich_feedback` |
| `:math:` role | 10 | `:math:`\LaTeX``; the `.. math::` directive is not used |
| `:time:` role | 2 | |
| Sections (`===`, `---`, ``` ``` ```), inline markup (`**`, `*`, ``` `` ```), bullet lists, external links `` `text <url>`_ ``, `#anchor` links, grid and simple tables, literal blocks `::` | many | |
| Container API helpers (run scripts): `feedback-msg` (79, options `-m`, `-a` append, `-i/--id` problem, `-e` backslash escapes, stdin), `rst-code` (11, `get_codeblock`: `.. code-block:: lang` + tab-indented lines), `rst-msgblock` (6, `get_admonition`: `.. admonition:: title` / `.. note::` + `:class: alert alert-{info,danger,warning,success}`), `rst-indent` (6), `rst-image` (6, `get_imageblock`: `.. raw:: html` + base64 `<img>`), `feedback-msg-tpl` (Jinja templates in the container) | | `legacy/base-containers/base/inginious_container_api/rst.py` |

Quirk: `rst-msgblock` gives the classes `alert alert-<x>`, which the converter does not
recognise. A titled block (`.. admonition:: T` + `:class: alert alert-danger`) therefore renders
`class="admonition alert alert-danger alert-info"` and **drops the title**. An untitled block
(`.. note::` + `:class: alert alert-success`) renders `alert alert-success note alert-light`.
The final colour depends on Bootstrap's CSS order (later rules win: `alert-danger` beats
`alert-info`, `alert-light` beats `alert-success`). Pixel parity requires keeping both classes.

## 7. Output sanitization

The new renderer sanitizes its output (allow-list) whatever the source: task and course
content, static pages and grader feedback. The following vectors must be neutralised, and the
tests cover them:

* `.. raw:: html` in author content (used deliberately, e.g. tutorial 07): scripts and event
  handlers are removed, the allowed markup is kept.
* Grader feedback that echoes student input (`rich_feedback/run`:
  ``feedback-msg --id anything -m "… ``$(getinput anything)``"``): any `.. raw:: html` or
  `<script>` coming from such input is sanitized like the rest of the feedback.
* `javascript:` URLs in links.
* Scripts attached to feedback (`feedback_script` plugin hook) are not executed.

`hidden-until` is evaluated at render time only (the raw text is in the DB and in the `debug`
JSON for admins).

## 8. Rendered examples (generated by the real code)

Generated inside the running `frontend` container (python3.14, docutils 0.21.2, no Pygments,
no libtidy) inside `app.test_request_context("/")`. `inginious.frontend.i18n.session` was
replaced by a stub with `language="en"`, because `gettext()` reads `session.language`. Script:
`ParsableText(src, "rst").parse()` (`show_everything=False`), except
`hidden_until_future_show_everything` (`True`), `lti_rewrite` (request
`/?session_id=abc123`), `static_page_level2` (`ParsableText.rst(src, initial_header_level=2)`)
and `html_mode: …` (`ParsableText(src, "html")`). Server timezone is UTC. The French fallback,
checked separately, reads `<b>L'analyse a échoué</b> : <pre>…</pre>`, and `[no content]` is
`[pas de contenu]` in French.

#### `paragraph`

```rst
Hello world.

Second paragraph with <b>html</b> & entities.
```

→ (ends with `\n`)

```html
<p>Hello world.</p>
<p>Second paragraph with &lt;b&gt;html&lt;/b&gt; &amp; entities.</p>
```

#### `bold_italics`

```rst
This is **bold**, *italic* and ``literal --opt``. Also `interpreted`.
```

→ (ends with `\n`)

```html
<p>This is <strong>bold</strong>, <em>italic</em> and <code class="docutils literal">literal <span class="pre">--opt</span></code>. Also <cite>interpreted</cite>.</p>
```

#### `inline_literal_spaces`

```rst
``a  b   c``
```

→ (ends with `\n`)

```html
<p><code class="docutils literal">a&nbsp; b&nbsp;&nbsp; c</code></p>
```

#### `code_role`

```rst
.. role:: python(code)
   :language: python

Inline :python:`print(1)` and :code:`x = 1`.
```

→ (ends with `\n`)

```html
<p>Inline <code class="python">print(1)</code> and <code>x = 1</code>.</p>
```

#### `code_block_lang`

```rst
.. code-block:: python

    def f(x):
        return x < 2
```

→ (ends with `\n`)

```html
<pre class="code python literal-block">
def f(x):
    return x &lt; 2
</pre>
```

#### `code_block_nolang`

```rst
.. code-block::

    plain code
```

→ (ends with `\n`)

```html
<pre class="code literal-block">
plain code
</pre>
```

#### `code_block_empty`

```rst
.. code-block:: java
```

→ (ends with `\n`)

```html
<pre class="code java literal-block">
[no content]
</pre>
```

#### `code_directive`

```rst
.. code:: c

    int main() { return 0; }
```

→ (ends with `\n`)

```html
<pre class="code c literal-block">
int main() { return 0; }
</pre>
```

#### `sourcecode_directive`

```rst
.. sourcecode:: python

    x = 1
```

→ (ends with `\n`)

```html
<pre class="code python literal-block">
x = 1
</pre>
```

#### `literal_block`

```rst
Example::

    for i in range(3):
        print(i)
```

→ (ends with `\n`)

```html
<p>Example:</p>
<pre class="literal-block">
for i in range(3):
    print(i)
</pre>
```

#### `bullet_list`

```rst
- one
- two

  - nested
```

→ (ends with `\n`)

```html
<ul class="simple">
<li>one</li>
<li>two<ul>
<li>nested</li>
</ul>
</li>
</ul>
```

#### `enum_list`

```rst
1. first
2. second

#. auto
```

→ (ends with `\n`)

```html
<ol class="arabic simple">
<li>first</li>
<li>second</li>
<li>auto</li>
</ol>
```

#### `grid_table`

```rst
+-----+-----+
| A   | B   |
+=====+=====+
| 1   | 2   |
+-----+-----+
```

→ (ends with `\n`)

```html
<table class="docutils table table-bordered">
<colgroup>
<col width="50%" />
<col width="50%" />
</colgroup>
<thead class="thead-light">
<tr><th class="head">A</th>
<th class="head">B</th>
</tr>
</thead>
<tbody>
<tr><td>1</td>
<td>2</td>
</tr>
</tbody>
</table>
```

#### `simple_table`

```rst
===  ===
A    B
===  ===
1    2
===  ===
```

→ (ends with `\n`)

```html
<table class="docutils table table-bordered">
<colgroup>
<col width="50%" />
<col width="50%" />
</colgroup>
<thead class="thead-light">
<tr><th class="head">A</th>
<th class="head">B</th>
</tr>
</thead>
<tbody>
<tr><td>1</td>
<td>2</td>
</tr>
</tbody>
</table>
```

#### `list_table`

```rst
.. list-table:: Title
   :header-rows: 1

   * - A
     - B
   * - 1
     - 2
```

→ (ends with `\n`)

```html
<table class="docutils table table-bordered">
<caption>Title</caption>
<colgroup>
<col width="50%" />
<col width="50%" />
</colgroup>
<thead class="thead-light">
<tr><th class="head">A</th>
<th class="head">B</th>
</tr>
</thead>
<tbody>
<tr><td>1</td>
<td>2</td>
</tr>
</tbody>
</table>
```

#### `note`

```rst
.. note::

    This is a note.
```

→ (ends with `\n`)

```html
<div class="admonition note alert alert-light">
This is a note.</div>
```

#### `warning`

```rst
.. warning:: Be careful.
```

→ (ends with `\n`)

```html
<div class="admonition warning alert alert-warning">
Be careful.</div>
```

#### `tip_titled`

```rst
.. tip::
    :title: My title

    Tip body.
```

→ (ends with `\n`)

```html
<div class="admonition tip card mb-3 border-info">
<div class="admonition tip card-header bg-info text-white">
My title</div>
<div class="admonition tip card-body">
Tip body.</div>
</div>
```

#### `danger_titled`

```rst
.. danger::
    :title: Danger!

    Body.
```

→ (ends with `\n`)

```html
<div class="admonition danger card mb-3 border-danger">
<div class="admonition danger card-header bg-danger text-white">
Danger!</div>
<div class="admonition danger card-body">
Body.</div>
</div>
```

#### `generic_admonition`

```rst
.. admonition:: Custom Title
    :class: success

    Body text.
```

→ (ends with `\n`)

```html
<div class="admonition success alert alert-success">
Body text.</div>
```

#### `generic_admonition_title_opt`

```rst
.. admonition:: ignored
    :title: Shown title
    :class: success

    Body text.
```

→ (ends with `\n`)

```html
<div class="admonition success card mb-3 border-success">
<div class="admonition success card-header bg-success text-white">
Shown title</div>
<div class="admonition success card-body">
Body text.</div>
</div>
```

#### `hint`

```rst
.. hint:: hint text
```

→ (ends with `\n`)

```html
<div class="admonition hint alert alert-info">
hint text</div>
```

#### `error_adm`

```rst
.. error:: err text
```

→ (ends with `\n`)

```html
<div class="admonition error alert alert-danger">
err text</div>
```

#### `external_link`

```rst
See `INGInious <https://inginious.org>`_ and https://example.com and `anchor`_.

.. _anchor:

Target para.
```

→ (ends with `\n`)

```html
<p>See <a class="reference external" href="https://inginious.org" target="_blank">INGInious</a> and <a class="reference external" href="https://example.com" target="_blank">https://example.com</a> and <a class="reference internal" href="#anchor">anchor</a>.</p>
<p id="anchor">Target para.</p>
```

#### `relative_link`

```rst
`file <files/a.txt>`_
```

→ (ends with `\n`)

```html
<p><a class="reference external" href="files/a.txt" target="_blank">file</a></p>
```

#### `image`

```rst
.. image:: img.png
   :alt: an image
   :width: 100px
```

→ (ends with `\n`)

```html
<img alt="an image" src="img.png" style="width: 100px;" />
```

#### `figure`

```rst
.. figure:: img.png

   Caption text.
```

→ (ends with `\n`)

```html
<div class="figure">
<img alt="img.png" src="img.png" />
<p class="caption">Caption text.</p>
</div>
```

#### `math_role`

```rst
Inline :math:`a^2 + b^2 = c^2`.
```

→ (ends with `\n`)

```html
<p>Inline <span class="math">\(a^2 + b^2 = c^2\)</span>.</p>
```

#### `math_directive`

```rst
.. math::

    \int_0^1 x\,dx
```

→ (ends with `\n`)

```html
<div class="math">
\begin{equation*}
\int_0^1 x\,dx
\end{equation*}
</div>
```

#### `raw_html`

```rst
.. raw:: html

    <div class="x"><i class="fa fa-comments"></i></div>
```

→ (no trailing newline)

```html
<div class="x"><i class="fa fa-comments"></i></div>
```

#### `inline_html_escaped`

```rst
<script>alert(1)</script>
```

→ (ends with `\n`)

```html
<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>
```

#### `headings`

```rst
Title
=====

Sub
---

text

Sub2
----

more
```

→ (ends with `\n`)

```html
<div class="section" id="title">
<h3>Title</h3>
<div class="section" id="sub">
<h4>Sub</h4>
<p>text</p>
</div>
<div class="section" id="sub2">
<h4>Sub2</h4>
<p>more</p>
</div>
</div>
```

#### `single_title_doc`

```rst
Only Title
==========

text
```

→ (ends with `\n`)

```html
<div class="section" id="only-title">
<h3>Only Title</h3>
<p>text</p>
</div>
```

#### `container`

```rst
.. container:: myclass

    inside
```

→ (ends with `\n`)

```html
<div class="myclass">
inside</div>
```

#### `time_role`

```rst
Due :time:`2024-01-01T10:00:00+00:00`.
```

→ (ends with `\n`)

```html
<p>Due <time datetime="2024-01-01T10:00:00+00:00">
2024-01-01T10:00:00+00:00</time>.</p>
```

#### `hidden_until_past`

```rst
.. hidden-until:: 2000-01-01 10:00:00

    Secret visible.
```

→ (ends with `\n`)

```html
<div class="compound">
<p>Secret visible.</p>
</div>
```

#### `hidden_until_future`

```rst
.. hidden-until:: 2999-01-01 10:00:00

    Secret hidden.
```

→ (ends with `\n`)

```html
<div class="admonition caution alert alert-warning">
A part of this feedback is hidden until 2999-01-01T10:00:00+00:00. Please come back later and reload the submission to see the full feedback.</div>
```

#### `syntax_error_title_underline`

```rst
Title
==

text
```

→ (ends with `\n`)

```html
<p>Title
==</p>
<p>text</p>
```

#### `syntax_error_unknown_directive`

```rst
.. foo:: bar

    baz
```

→ (ends with `\n`)

```html
<div class="system-message">
<p class="system-message-title">System Message: ERROR/3 (<tt class="docutils">&lt;string&gt;</tt>, line 1)</p>
<p>Unknown directive type &quot;foo&quot;.</p>
<pre class="literal-block">
.. foo:: bar

    baz
</pre>
</div>
```

#### `syntax_error_inline`

```rst
*unclosed emphasis
```

→ (ends with `\n`)

```html
<p><a href="#system-message-1"><span class="problematic" id="problematic-1">*</span></a>unclosed emphasis</p>
<div class="system-message" id="system-message-1">
<p class="system-message-title">System Message: WARNING/2 (<tt class="docutils">&lt;string&gt;</tt>, line 1); <em><a href="#problematic-1">backlink</a></em></p>
Inline emphasis start-string without end-string.</div>
```

#### `syntax_error_bad_table`

```rst
+---+
| a |
+--
```

→ (ends with `\n`)

```html
<div class="system-message">
<p class="system-message-title">System Message: ERROR/3 (<tt class="docutils">&lt;string&gt;</tt>, line 1)</p>
<p>Malformed table.</p>
<pre class="literal-block">
+---+
| a |
+--
</pre>
</div>
<div class="system-message">
<p class="system-message-title">System Message: WARNING/2 (<tt class="docutils">&lt;string&gt;</tt>, line 4)</p>
Blank line required after table.</div>
```

#### `include_disabled`

```rst
.. include:: /etc/passwd
```

→ (ends with `\n`)

```html
<div class="system-message">
<p class="system-message-title">System Message: WARNING/2 (<tt class="docutils">&lt;string&gt;</tt>, line 1)</p>
<p>&quot;include&quot; directive disabled.</p>
<pre class="literal-block">
.. include:: /etc/passwd
</pre>
</div>
```

#### `line_block`

```rst
| line one
| line two
```

→ (ends with `\n`)

```html
<div class="line-block">
<div class="line">line one</div>
<div class="line">line two</div>
</div>
```

#### `definition_list`

```rst
term
    definition
```

→ (ends with `\n`)

```html
<dl class="docutils">
<dt>term</dt>
<dd>definition</dd>
</dl>
```

#### `field_list_docinfo`

```rst
:author: me

text
```

→ (ends with `\n`)

```html
<p>text</p>
```

#### `block_quote`

```rst
para

    quoted
```

→ (ends with `\n`)

```html
<p>para</p>
<blockquote>
quoted</blockquote>
```

#### `footnote`

```rst
Text [#]_.

.. [#] Note.
```

→ (ends with `\n`)

```html
<p>Text <a class="footnote-reference" href="#footnote-1" id="footnote-reference-1">[1]</a>.</p>
<table class="docutils footnote" frame="void" id="footnote-1" rules="none">
<colgroup><col class="label" /><col /></colgroup>
<tbody valign="top">
<tr><td class="label"><a class="fn-backref" href="#footnote-reference-1">[1]</a></td><td>Note.</td></tr>
</tbody>
</table>
```

#### `csv_table`

```rst
.. csv-table::
   :header: a, b

   1, 2
```

→ (ends with `\n`)

```html
<table class="docutils table table-bordered">
<colgroup>
<col width="50%" />
<col width="50%" />
</colgroup>
<thead class="thead-light">
<tr><th class="head">a</th>
<th class="head">b</th>
</tr>
</thead>
<tbody>
<tr><td>1</td>
<td>2</td>
</tr>
</tbody>
</table>
```

#### `substitution`

```rst
|x| here

.. |x| replace:: replaced
```

→ (ends with `\n`)

```html
<p>replaced here</p>
```

#### `empty`

```rst

```

→ (no trailing newline)

```html

```

#### `doctest`

```rst
>>> 1+1
2
```

→ (ends with `\n`)

```html
<pre class="doctest-block">
&gt;&gt;&gt; 1+1
2
</pre>
```

#### `hidden_until_future_show_everything`

```rst
.. hidden-until:: 2999-01-01 10:00:00

    Secret hidden.
```

→ (ends with `\n`)

```html
<div class="admonition caution alert alert-warning">
The feedback below will be hidden to the students until <time datetime="2999-01-01T10:00:00+00:00">
2999-01-01T10:00:00+00:00</time>.</div>
<div class="compound">
<p>Secret hidden.</p>
</div>
```

#### `lti_rewrite`

```rst
`rel <files/a.txt>`_ and `abs <https://x.org/>`_

.. image:: img.png
```

→ (ends with `\n`)

```html
<p><a class="reference external" href="asset/files/a.txt?session_id=abc123" target="_blank">rel</a> and <a class="reference external" href="https://x.org/" target="_blank">abs</a></p>
<img alt="img.png" src="asset/img.png?session_id=abc123" />
```

#### `html_mode: <p>unclosed <b>bold`

```rst
<p>unclosed <b>bold
```

→ (no trailing newline)

```html
<b>Parsing failed</b>: <pre>&lt;p&gt;unclosed &lt;b&gt;bold</pre>
```

#### `html_mode: <script>alert(1)</script><p onclick='x()'>hi</p>`

```rst
<script>alert(1)</script><p onclick='x()'>hi</p>
```

→ (no trailing newline)

```html
<b>Parsing failed</b>: <pre>&lt;script&gt;alert(1)&lt;/script&gt;&lt;p onclick=&#x27;x()&#x27;&gt;hi&lt;/p&gt;</pre>
```

#### `html_mode: <non existing tag></...>`

```rst
<non existing tag></...>
```

→ (no trailing newline)

```html
<b>Parsing failed</b>: <pre>&lt;non existing tag&gt;&lt;/...&gt;</pre>
```

#### `html_mode: plain text`

```rst
plain text
```

→ (no trailing newline)

```html
<b>Parsing failed</b>: <pre>plain text</pre>
```

#### `static_page_level2`

```rst
Title
=====

text

Sub
---

x
```

→ (ends with `\n`)

```html
<div class="section" id="title">
<h2>Title</h2>
<p>text</p>
<div class="section" id="sub">
<h3>Sub</h3>
<p>x</p>
</div>
</div>
```

#### `note_two_paras`

```rst
.. note::

    First para.

    Second para.
```

→ (ends with `\n`)

```html
<div class="admonition note alert alert-light">
<p>First para.</p>
<p class="last">Second para.</p>
</div>
```

#### `rst-msgblock with title, class danger (container API get_admonition)`

```rst


.. admonition:: Oops
	:class: alert alert-danger

	Something failed
```

→ (ends with `\n`)

```html
<div class="admonition alert alert-danger alert-info">
Something failed</div>
```

#### `rst-msgblock without title, class success (container API get_admonition)`

```rst


.. note:: 
	:class: alert alert-success

	All good
```

→ (ends with `\n`)

```html
<div class="admonition alert alert-success note alert-light">
All good</div>
```

#### `rst-code (container API get_codeblock, tab-indented)`

```rst


.. code-block:: python

	print(1)
	if x:
	    y
```

→ (ends with `\n`)

```html
<pre class="code python literal-block">
print(1)
if x:
    y
</pre>
```

#### `rst-image (container API get_imageblock)`

```rst


.. raw:: html

	<img src="data:image/png;base64,iVBORw0KGgo=">
```

→ (no trailing newline)

```html
<img src="data:image/png;base64,iVBORw0KGgo=">
```

#### `class_directive`

```rst
.. class:: text-muted

    A paragraph with a custom class.
```

→ (ends with `\n`)

```html
<p class="text-muted">A paragraph with a custom class.</p>
```

#### `admonition_class_danger`

```rst
.. admonition:: T
    :class: danger

    body
```

→ (ends with `\n`)

```html
<div class="admonition danger alert alert-danger">
body</div>
```

#### `note_custom_class`

```rst
.. note::
    :class: success

    body
```

→ (ends with `\n`)

```html
<div class="admonition success note alert alert-success">
body</div>
```

#### `anchor_link`

```rst
`anchor <#task_alert>`_
```

→ (ends with `\n`)

```html
<p><a class="reference external" href="#task_alert">anchor</a></p>
```

#### `mailto`

```rst
Contact me@example.com
```

→ (ends with `\n`)

```html
<p>Contact <a class="reference external" href="mailto:me&#64;example.com" target="_blank">me&#64;example.com</a></p>
```

#### `image_target`

```rst
.. image:: a.png
   :target: https://x.org
```

→ (ends with `\n`)

```html
<a class="reference external image-reference" href="https://x.org" target="_blank">
<img alt="a.png" src="a.png" />
</a>
```

#### `raw_role`

```rst
.. role:: raw-html(raw)
   :format: html

X :raw-html:`<br/>` Y
```

→ (ends with `\n`)

```html
<p>X <span class="raw-html"><br/></span> Y</p>
```

#### `transition`

```rst
a

----

b
```

→ (ends with `\n`)

```html
<p>a</p>
<hr class="docutils" />
<p>b</p>
```

#### `severe_error_inconsistent_titles (exception -> fallback)`

```rst
A
=====

B
-----

C
=====

D
~~~~~
```

→ (no trailing newline)

```html
<b>Parsing failed</b>: <pre>A
=====

B
-----

C
=====

D
~~~~~
</pre>
```

#### `hidden_until_bad_date`

```rst
x

.. hidden-until:: notadate

    secret
```

→ (ends with `\n`)

```html
<p>x</p>
<div class="system-message">
<p class="system-message-title">System Message: ERROR/3 (<tt class="docutils">&lt;string&gt;</tt>, line 3)</p>
<p>Unknown date format in the &quot;hidden-until&quot; directive; notadate</p>
<pre class="literal-block">
.. hidden-until:: notadate
</pre>
</div>
```

#### `note_without_content`

```rst
.. note::
```

→ (ends with `\n`)

```html
<div class="system-message">
<p class="system-message-title">System Message: ERROR/3 (<tt class="docutils">&lt;string&gt;</tt>, line 1)</p>
<p>Content block expected for the &quot;note&quot; directive; none found.</p>
<pre class="literal-block">
.. note::
</pre>
</div>
```

## 9. Requirements for the rewrite

1. **Same input language and output contract.** Task/course YAML and grader feedback stay
   in RST, so the new app must render docutils-compatible RST to HTML **with the same
   markup and classes** as above (Bootstrap 4 alert/card/table classes, `code … literal-block`,
   `docutils literal`, `section` divs with `h3` as the first level, `<time>`). The options
   are: (a) keep a docutils-based Python micro-service/worker that ports `parsable_text.py`
   verbatim (the safest for parity), or (b) a TypeScript RST renderer that passes the
   golden examples in §8 byte-for-byte or modulo whitespace. Either way, the §8 corpus plus
   all `infra/tasks/**` and `examples/demo-tasks/**` contexts/headers must be golden tests.
2. Implement every override: admonition mapping (first mapped class wins, default `info`,
   `note`→`light` alert / `default` card, `:title:` → card, the generic admonition argument
   is dropped, specific directives accept `:title:`/`:class:`/`:name:`), `container` without the
   `container` class, `class` directive, table classes plus `thead-light` and no `border`,
   `<code>` literals, `target="_blank"` on non-`#` links, `:time:` role,
   `hidden-until` (date formats of `parse_date`, server-local naive dates, staff
   caution with `<time>`, student message with ISO string, error on a bad date),
   `code-block` with empty content → `[no content]` (translated), `include`/file insertion
   disabled, `raw` enabled, docinfo field list at the top swallowed.
3. Header levels: start at `h3` (`h2` for static pages). No doc-title promotion.
4. Math: emit `\( \)` spans / `equation*` divs and run MathJax (or KaTeX with the same
   delimiters) after the initial render **and after every feedback update**.
5. Code highlighting: client-side, keyed on the `code <lang> literal-block` classes (the
   CodeMirror mode-name lookup, e.g. `python`, `c`, `java`, `bash`). Plain `literal-block`
   is not highlighted.
6. Error handling: inline system-message `div`s for WARNING+ (same structure), and on a
   SEVERE error or exception the translated fallback `<b>Parsing failed</b>: <pre>{escaped}</pre>`.
   Unlike legacy, handle a non-string feedback gracefully (no 500).
7. LTI: when rendering for an LTI session, rewrite relative `href`/`src` (no netloc, including
   `#anchors`) to `asset/<url>?session_id=<id>` relative to the LTI page, or provide an
   equivalent mechanism that makes task files reachable inside the LTI iframe.
8. Feedback pipeline: store the raw RST (DB format unchanged: `text` str, `problems` `{pid:
   [result, rst]}` or legacy `{pid: str}`), render at read time with
   `show_everything = staff`, and return HTML in the submission JSON/API (`feedback`,
   `problems_feedback` in `/api/v0/.../submissions`). Keep the MCQ placeholders and the
   `"\n\n"` joining (done by the agent). Per-problem alerts go above each problem. The alert
   colour mapping per result is as in §4.5, and the title strings are translated per §4.4.
9. **Raw HTML and scripts.** Some task contexts contain `<script>` (tutorial 07:
   synchronous `document.write` using the global `input` object). Svelte `{@html}` does
   **not** execute scripts, and the new app sanitizes all rendered HTML (§7), feedback
   included. Document how such tasks are handled and test the vectors of §7.
10. Cache rendered HTML per (source hash, language, show_everything, LTI flag) and
    invalidate it on task file change. `hidden-until` makes the output time-dependent, so
    exclude sources that contain it, or include "now ≥ date" in the key.
11. Translation of the source: apply the course/task gettext catalog (see `i18n.md`)
    **before** RST parsing for context, headers, choices and course description.
    Feedback is not translated by the frontend.
