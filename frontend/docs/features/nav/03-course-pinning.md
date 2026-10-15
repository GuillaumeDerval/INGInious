# Pin / unpin a course (favourites on My courses)

- **ID**: NAV-03
- **Actors**: student, tutor, course admin, superadmin
- **Routes**: POST /mycourses with form field `pinning_courseid` (AJAX, JSON response)
- **Depends on**: NAV-02
- **Legacy code**: `legacy/inginious/frontend/pages/mycourses.py:L33-L56`, `user_manager.py:L505-L518`, `static/js/mycourses.js:L8-L75`, `templates/mycourses.html:L54-L96,L130-L138`

## Use case
A user with many courses marks up to 6 of them as favourites so they appear as cards at the
top of "My courses".

## Preconditions
Logged in. The UI only offers pin buttons for courses listed in /mycourses.

## Main flow
1. User clicks the star button of a course item (or of a pinned card). JS `course_pin` prevents the link navigation and sends `POST /mycourses` with body `pinning_courseid=<courseid>` (`application/x-www-form-urlencoded`, built by string interpolation, not URL-encoded).
2. Server: `pinned = users.pinned_courses` filtered to ids of currently **loadable** courses (`Course.get_all()`).
3. If `courseid` ∉ `pinned` (pin):
   - if `len(pinned) == 6` → JSON `{"error": "Maximum number of pins"}` (HTTP 200);
   - else `users.update({username}, {$addToSet: {pinned_courses: courseid}})`, then `Course.get(courseid)` and JSON response:
     `{"courseid", "is_lti", "lti_url", "name" (translated), "path": "/course/<id>", "description": "<rendered rst html>"}`.
4. Else (unpin): `users.update({username, pinned_courses: courseid}, {$pull: {pinned_courses: courseid}})` → JSON `{"courseid": courseid}`.
5. Client:
   - response falsy or with `error` → show `.max_pin_alert` ("You are not allowed to have more than 6 pinned courses.") for 3 s then fade out;
   - pin (button icon was `fa-star-o`): icon → `fa-star text-warning`; clone hidden template `#hidden_pin_card`, set id `pinned-<id>`, button `data-course-id`, **append `data["name"]` as HTML** into `.pin_title`, set href to `data["path"]`; add class `is_pinned` to the list item; hide `#no_pin_message`;
   - unpin: icon → `fa-star-o`; if clicked on the pinned card, also reset the star of the list item; remove `#pinned-<id>`; remove `is_pinned`; show `#no_pin_message` if no `.course_card` remains (note: the hidden template itself has class `course_card`, so the message is in practice never re-shown until reload — legacy bug).
   - HTTP error → `.pin_alert` for 3 s.

## Alternative / error flows
- Pinning an id that is not a loadable course → rejected, nothing stored (JS shows `.pin_alert`).
- Pinning a course that is not one of the user's courses (e.g. `navclosed` for a student) is refused, nothing stored.
- The max check counts only loadable courses, so the stored array can exceed 6 entries.

## Data
- `users.pinned_courses: array<string>` (mongoengine `ListField(StringField())`, default `[]`), `$addToSet` / `$pull`.

## Permissions & security
- Only modifies the caller's own document. The request is a POST protected by the app's origin check.
- The course name returned in JSON is inserted as text, never as HTML.
- The course to pin must be one of the user's own courses (as listed on My courses); other values are refused (HTTP 404) without being stored.

## Acceptance tests
- nav_alice pins `navopen` via the star: DB `pinned_courses` = `["navopen"]`, card "NAV Open course" appears under "My pinned courses" without reload, list item gets `is_pinned`, "no pins" message hidden; after reload the card and the filled star persist.
- Clicking the star again (list or card) → `$pull`, card removed, star empty.
- With 6 valid pins, a 7th pin returns `{"error": "Maximum number of pins"}` and shows the max-pin alert; DB unchanged.
- Response JSON for pin contains keys `courseid, is_lti, lti_url, name, path, description` (e.g. navlti: `is_lti: true, lti_url: "https://lms.example.org/course/1"`).
- POST `pinning_courseid=doesnotexist` → rejected, nothing stored.
- Unpin response is `{"courseid": "<id>"}`.
