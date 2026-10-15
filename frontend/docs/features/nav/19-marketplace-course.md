# Marketplace course detail page and import

- **ID**: NAV-19
- **Actors**: superadmin
- **Routes**: GET /marketplace/<courseid>; POST /marketplace/<courseid> (field `new_courseid`)
- **Depends on**: NAV-18 (`import_course`, JSON format)
- **Legacy code**: `legacy/inginious/frontend/pages/marketplace_course.py:L16-L61`, `templates/marketplace_course.html:L1-L71`, `pages/marketplace.py:L65-L101`

## Use case
Before importing, a superadmin reads the full description, license and authors of a
marketplace course, then imports it under a chosen id.

## Preconditions
Superadmin; marketplace reachable.

## Main flow
1. GET: non-superadmin → 403 "You're not allowed to do that". `get_marketplace_course(courseid)`; any error (unknown id, network error) → 404 "Course unavailable.".
2. Render: title/h2 = localised name; breadcrumb marketplace icon (`/marketplace`) › name; left column h3 "Information" + table rows (only when non-empty): "Language(s)", "License", "Maintainer(s)", "Author(s)", "Link" (anchor `target="_blank"` to the git link); content: errors, `#course_description` = rendered rst description (`| safe`), form with input `new_courseid` (placeholder "New course id") and button "Import course".
3. POST: same rights check and lookup; if `new_courseid` in form → `import_course` (NAV-18 steps); `ImportCourseException` → message shown in alert-danger; success → 302 **`/course/<new_courseid>`** (differs from NAV-18 which redirects to `/admin/<id>`). Other exceptions are not caught (500).

## Alternative / error flows
- Unknown marketplace id → 404 "Course unavailable." (e.g. `/marketplace/foo`).
- POST without `new_courseid` → page re-rendered.

## Data
Same as NAV-18.

## Permissions & security
Superadmin only. The remote rst description is rendered as sanitized HTML. The external link is only shown when it is an `https` URL and opens in a new tab with `rel="noopener noreferrer"`.

## Acceptance tests
- superadmin GET /marketplace/demo-tasks → name "Demo tasks", info table with license/authors/link, description rendered.
- GET /marketplace/foo → 404 "Course unavailable.".
- POST `new_courseid=navmarket` → clone + course.yaml rewritten, redirect to /course/navmarket.
- POST with an existing id → "Course with id <id> already exists.".
- Non-superadmin GET/POST → 403.
