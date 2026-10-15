# Language selection and internationalisation

- **ID**: AUTH-10
- **Actors**: anonymous, any logged-in user
- **Routes**: any `INGIniousPage` route with `?lang=<code>`; POST `/preferences/profile` (`language`)
- **Depends on**: AUTH-04, AUTH-11, AUTH-18
- **Legacy code**: `legacy/inginious/frontend/i18n/__init__.py:L13-L38`, `legacy/inginious/frontend/pages/utils.py:L33-L39` (`_pre_check`), `legacy/inginious/frontend/user_manager.py:L184-L193`, `legacy/inginious/frontend/app.py:L114,L179`, templates `layout.html:L8,L23-L31,L78-L95,L170-L177,L226`, catalogs `legacy/inginious/frontend/i18n/<lang>/LC_MESSAGES/messages.{po,mo}`

## Use case
Visitors read the UI in their language: detected from the browser at first visit, switchable via
`?lang=` (language menu for anonymous users) and stored per user in the profile.

## Preconditions
None.

## Main flow
1. Available languages (`available_languages`, ordered): `en` English, `de` Deutsch, `el` ελληνικά, `es` Español, `fr` Français, `he` עִבְרִית, `nl` Nederlands, `nb_NO` Norsk (bokmål), `pt` Português, `vi` Tiếng Việt. Gettext catalogs `messages` per language; English = identity.
2. On every request of a page deriving from `INGIniousPage` (`_pre_check`):
   - if `request.args['lang']` is an available code → `session.language = lang` (persisted in the session);
   - elif `session.language` is empty → `session.language = request.accept_languages.best_match(available_languages, default='en')` (e.g. `Accept-Language: de` → `de`, `nb-NO` → `nb_NO`).
   - Unknown `?lang=xx` is ignored.
3. On login `session.language = user.language` (user preference overrides the anonymous choice).
4. Changing the language in the profile (AUTH-11) updates `users.language` and `session.language`.
5. Translation function `_()` (global builtin and Jinja global) uses `session.language`; also used for e-mails (language of the requester's session).
6. Right-to-left: templates check `_("__is_rtl") == "true"` (Hebrew catalog) and load `bootstrap-rtl.min.css`, `INGInious-rtl.css`, `bootstrap-rtl.min.js` (or `all-minified-rtl.js`).
7. Client side: `moment.locale(session.language)` and `Intl.DateTimeFormat` initialised in `layout.html`.

## Alternative / error flows
- Pages that are not `INGIniousPage` (maintenance, some plugin pages) do not run `_pre_check`.
- `<html lang="en">` is hard-coded whatever the language (legacy bug; rewrite should set the real one).
- The anonymous language menu label is `_("English")` — i.e. the translation of the word "English" in the current catalog (shows "Norsk (bokmål)" for nb_NO, but "English" in German because the string is untranslated there).
- Some strings are formatted before translation and are never translated (e.g. reset card header, AUTH-08), some are not wrapped at all ("Invalid reset hash.").
- Plugins may add their own translations (not covered here).

## UI elements
- Anonymous sidebar: collapsible "(globe icon `fa-globe`) <current language name>" entry (`#collapseLang`) listing every language as `<a href="?lang=<code>">{code} ({name})</a>` — note the link drops all other query parameters of the current URL.
- Logged-in users have no language menu (profile select only).
- Profile select `language` (AUTH-11) with options `code` → `name`.

## Data
- `sessions.language` (str, `""` until first request), `users.language` (str, default `"en"`).
- No config key (languages are fixed in code).

## Permissions & security
- The language is changed by a POST to `/language` (origin check, CORE-04; GET has no effect); only codes of the available languages are accepted and the return target is restricted to same-site paths.

## Acceptance tests
- First request with `Accept-Language: de` → German UI ("Einloggen"); session `language:'de'`.
- `GET /courselist?lang=fr` → French UI; next request without `lang` stays French.
- `?lang=xx` → unchanged language.
- Anonymous fr session, login as user with `language:'en'` → UI in English.
- Profile language change to `fr` → `users.language:'fr'`, UI French immediately.
- `?lang=he` → RTL stylesheets loaded.
- Messages in e-mails/flash alerts follow the session language (e.g. "Profil mis à jour.").
