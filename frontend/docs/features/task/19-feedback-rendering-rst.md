# Feedback and statement rendering (RST → HTML, `ParsableText`)

- **ID**: TASK-19
- **Actors**: student/staff (readers), task authors and grading scripts (writers)
- **Routes**: used by the task page (context, headers, choices), `@action=check` / `load_submission_input` (feedback), course/admin pages
- **Depends on**: TASK-01, TASK-09
- **Legacy code**: `legacy/inginious/frontend/parsable_text.py:L1-L332`, `submission_manager.py:L540-L568`, `static/js/task.js:L524-L557`, `static/js/common.js` (`colorizeStaticCode`)

## Use case
Statements and feedback are written in reStructuredText with INGInious extensions (Bootstrap
alerts/cards, time-locked content, code blocks, dates) so that authors can produce rich, styled
feedback from grading scripts.

## Main flow
1. `ParsableText(content, mode="rst"|"html", show_everything=False).parse()` (cached per object):
   - `html` mode: `tidylib.tidy_fragment(content)`;
   - `rst` mode: `docutils.core.publish_parts(source, writer=_CustomHTMLWriter(), settings_overrides={initial_header_level: 3, doctitle_xform: False, syntax_highlight: 'none', force_show_hidden_until: show_everything, raw_enabled: True, file_insertion_enabled: False, math_output: 'MathJax /this/does/not/need/to/exist.js', line_length_limit: len(string)})` → returns `parts['body_pre_docinfo'] + parts['fragment']`;
   - any exception → `"<b>Parsing failed</b>: <pre>{html-escaped source}</pre>"` (docutils warnings/errors are otherwise rendered inline as `system-message` divs).
2. Feedback: `get_feedback_from_submission(sub, show_everything=is_staff)` parses `sub.text` and each `sub.problems[pid][1]`; old-style string problem feedback `problems[pid] = "text"` is converted to `(submission.result, html)`; malformed entries → `("crash", "Feedback is badly formatted.")`.
3. Client: inserts HTML with jQuery `.html()`, then `colorizeStaticCode()` (CodeMirror runmode on `pre code` blocks with `language-*`/class), `MathJax.Hub.Queue(["Typeset"])`, and converts `<time datetime=…>` text with the browser's `Intl.DateTimeFormat` (`dtf`).

## Custom directives / roles / writer behaviour
| Construct | Output |
|---|---|
| `.. note::`, `attention`, `caution`, `danger`, `error`, `hint`, `important`, `tip`, `warning` (no `:title:`) | `<div class="alert alert-<cls>">…</div>` with mapping note→`light` (`default`→`light`), attention/caution/important/warning→`warning`, danger/error→`danger`, hint/tip→`info` |
| same with `:title: T` option | `<div class="card mb-3 border-<cls>"><div class="card-header bg-<cls>[ text-white]">T</div><div class="card-body">…</div></div>` (`text-white` except for default/light/secondary; note → `default`) |
| `.. admonition:: Title` + `:class: success\|info\|primary\|secondary\|light\|dark\|danger\|warning` (+ optional `:title:`) | class from `:class:` (`admonition-<x>` prefix stripped), default `info`; the argument title node is **dropped** (only `:title:` creates a card header) |
| `.. hidden-until:: <date> [time]` + content | if date ≤ now (UTC) or `show_everything`: content (`compound`), preceded for staff by a caution "The feedback below will be hidden to the students until :time:`<iso>`."; else a caution "A part of this feedback is hidden until <iso>. Please come back later and reload the submission to see the full feedback." Date parsed by `parse_date` (ISO or `%d/%m/%Y…`, server tz); bad date → docutils error |
| `.. code-block:: <lang>` | `<pre class="code <lang> literal-block">` (no server highlighting); empty block → content "[no content]" |
| `:time:`\`<iso>\`` role | `<time datetime="<iso>"><iso></time>` (reformatted client-side) |
| `.. raw:: html` | **enabled** (the resulting HTML is sanitized) |
| `.. container:: a b` | `<div class="a b">` (the `container` class is removed) |
| `.. class:: x` | adds class to the next element |
| tables | `<table class="docutils table table-bordered <table_style>">`, `<thead class="thead-light">` |
| inline literal ``` `` ``` | `<code class="docutils literal">` (`code` role → `<code>` without class) |
| links | `target="_blank"` for every non-`#` href; in LTI mode (`?session_id=` in the request) relative `href`/`src` are rewritten to `asset/<url>?session_id=<sid>` |
| math | MathJax markup `\(…\)` |
| `.. include::` etc. | file insertion disabled |

Headers start at `<h3>` (`initial_header_level: 3`); a title at the top is kept in the body (`doctitle_xform: False`).

## Verified output (excerpt, `rich_feedback/feedback.rst`, student)
```html
<div class="section" id="global-feedback-title">
<h3>Global feedback title</h3>
<p>… <a class="reference external" href="https://inginious.org" target="_blank">INGInious</a> and an <a class="reference external" href="#task_alert">anchor</a>.</p>
<div class="admonition note alert alert-light">
Note without title -&gt; <code class="docutils literal">alert <span class="pre">alert-light</span></code>.</div>
<div class="admonition note card mb-3 border-default">
<div class="admonition note card-header bg-default">
Note with title</div>
<div class="admonition note card-body">
Card …</div>
</div>
<div class="admonition success alert alert-success">
Admonition with class success.</div>          <!-- the argument title is NOT displayed -->
<div class="admonition primary card mb-3 border-primary">
<div class="admonition primary card-header bg-primary text-white">
Card title from option</div> …
<div class="compound">
<p>PAST-HIDDEN-UNTIL: …</p>
</div>
<div class="admonition caution alert alert-warning">
A part of this feedback is hidden until 2099-12-31T23:59:59+00:00. Please come back later and reload the submission to see the full feedback.</div>
<pre class="code python literal-block">
def f(x): …
</pre>
<pre class="code c literal-block">
[no content]
</pre>
<p>Submitted at <time datetime="2024-05-01T12:00:00+00:00">
2024-05-01T12:00:00+00:00</time>.</p>
<table class="docutils table table-bordered"> <colgroup>…</colgroup> <thead class="thead-light"> …
<div class="row">
<div class="col-md-6">
Left column.</div> …
<p class="text-muted">A paragraph with a custom class.</p>
<span id="raw-html-proof" class="badge badge-dark">raw html is enabled</span><p>Math: <span class="math">\(a^2 + b^2 = c^2\)</span></p>
</div>
```
Staff (`show_everything=True`) instead get, for the future block:
`<div class="admonition caution alert alert-warning">The feedback below will be hidden to the students until <time datetime="2099-12-31T23:59:59+00:00">…</time>.</div><div class="compound"><p>FUTURE-HIDDEN-UNTIL: …</p></div>`.
Note the compact paragraphs (first paragraph of an admonition/container has no `<p>`), the
admonition classes keep `admonition <type>` and every inner div repeats them.

## Alternative / error flows
- Invalid RST → inline docutils error boxes (`<div class="system-message">`), not an exception.
- `hidden-until` relies on the **time of rendering**: reloading the submission after the date reveals the content.

## UI elements
Bootstrap alerts/cards inside the result card and per-problem cards.

## Data
Feedback stored **raw** (RST) in `submissions.text` and `submissions.problems.<pid>[1]`; rendered on every read.

## Permissions & security
- Rendered statements and feedback are sanitized before display: raw HTML from task authors, grading scripts or echoed student input cannot run scripts.
- No server-provided script is evaluated by the page.

## Acceptance tests
- `task_showcase/rich_feedback` (any input) as student: global feedback contains `<h3>`, `alert alert-light` (note), cards for titled admonitions, `alert alert-success` for the generic admonition, `PAST-HIDDEN-UNTIL` visible, `FUTURE-HIDDEN-UNTIL` absent and replaced by the "A part of this feedback is hidden until 2099-12-31T23:59:59…" caution, a `<pre class="code python literal-block">`, an empty code block "[no content]", `<time datetime="2024-05-01T12:00:00+00:00">`, a bordered table with `thead-light`, `div.row > div.col-md-6` ×2, `#raw-html-proof` span, external link with `target="_blank"`, `#task_alert` anchor without target.
- Same as admin: `FUTURE-HIDDEN-UNTIL` visible with the staff caution.
- Problem feedback `anything` success card, `second` danger card containing a warning alert.
- Context of `rich_feedback` renders a note card and a tip alert and a grid table.
- Unit tests: each directive → expected HTML fragment (snapshot), parse failure fallback.
