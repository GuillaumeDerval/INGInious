# Outgoing e-mail (SMTP via Flask-Mail)

- **ID**: CORE-05
- **Actors**: anonymous (triggers registration / lost-password mails)
- **Routes**: POST `/register` (fields `register=...` or `lostpasswd=...`)
- **Depends on**: AUTH-07 (registration/activation), password reset feature, CORE-04
- **Legacy code**: `legacy/inginious/frontend/flask/mail.py:1-3`, `legacy/inginious/frontend/app.py:89-100,174-175`, `legacy/inginious/frontend/pages/register.py:61-160`

## Use case
INGInious sends transactional e-mails so that users with local (password) accounts can activate
their account and recover a lost password. Mail is the only outbound notification channel; no other
feature (submissions, course registration, admin actions) sends e-mail.

## Preconditions
- `smtp` block configured (`host`, `port` mandatory; `starttls`, `usessl`, `username`, `password`, `sendername` optional) — `app.py:89-100`.
- `allow_registration: true` (otherwise `/register` is 403 and no mail can be triggered).

## Main flow
1. At startup `mail = flask_mail.Mail()` is bound with `mail.init_app(flask_app)` (`app.py:175`) using Flask config
   `MAIL_SERVER, MAIL_PORT, MAIL_USE_TLS (starttls), MAIL_USE_SSL (usessl), MAIL_USERNAME, MAIL_PASSWORD, MAIL_DEFAULT_SENDER (sendername, default "no-reply@ingnious.org")`.
2. Sending is **synchronous** inside the request: `mail.send(Message(recipients=[(realname, email)], subject, body))` opens one SMTP connection per mail
   (STARTTLS/SSL/login as configured), plain-text body only, sender = `MAIL_DEFAULT_SENDER`.
3. **Registration mail** (`register.py:94-110`), after the user document is inserted (with `activate` hash):
   - Subject: "Welcome on INGInious" (translated in the session language)
   - Body: `"Welcome on INGInious !\n\nTo activate your account, please click on the following link :\n" + <base_url> + "/register?activate=" + activate_token`
   - Recipient: `("<realname>", "<email>")`. Success message: "You are succesfully registered. An email has been sent to you for activation."
4. **Password recovery mail** (`register.py:134-154`), after setting `users.reset` to a new hash on the user whose `email` equals the submitted `recovery_email`:
   - Subject: "INGInious password recovery"
   - Body: `"Dear {realname},\n\nSomeone (probably you) asked to reset your INGInious password. If this was you, please click on the following link :\n" + <base_url> + "/register?reset=" + reset_token`
   - Recipient: `(user.realname, recovery_email)`. Success message: "An email has been sent to you to reset your password."
5. Tokens: generated with a CSPRNG and carrying an expiry (AUTH-07, AUTH-08).
6. Verified with Mailpit (scratch frontend container configured with `smtp: {host: mailpit, port: 1025, sendername: 'Core Test <core@inginious.local>'}`, user `core_mail2`, deleted afterwards):
   - From `Core Test <core@inginious.local>`, To `Core Mail Two <core_mail2@example.com>`, subjects "Welcome on INGInious" / "INGInious password recovery".
   - Headers: `Content-Type: text/plain; charset="utf-8"`, `Content-Transfer-Encoding: 7bit`, `Mime-Version: 1.0`, `Message-Id: <...@hostname>`, `Date`.
   - Text: `Welcome on INGInious !\r\n\r\nTo activate your account, please click on the following link :\r\nhttp://localhost:18081/register?activate=<128 hex>\r\n` (no HTML part).

## Alternative / error flows
- SMTP failure during registration (`register.py:111-116`): the freshly inserted user is **deleted** (`User.objects(username=...).delete()`), message "Something went wrong while sending you activation email. Please contact the administrator.", log `inginious.register - ERROR - Couldn't send email : <exception>`.
  Verified on the shared legacy instance (whose running process has no `smtp` config, so Flask-Mail defaults to `localhost:25`): `Couldn't send email : [Errno 111] Connection refused` and the user `core_mail1` was not kept.
- SMTP failure during password recovery (`register.py:155-158`): legacy shows "Something went wrong while sending you reset email. Please contact the administrator."; the new app sends this mail in the background, logs the failure and shows the normal success message. The `reset` token stays in the DB in both cases.
- Unknown recovery e-mail: same success message as for a known one, no mail sent (AUTH-08).
- Invalid e-mail format (regex `register.py:126-129`): "Invalid email format.".
- No `smtp` key: no startup error; every send fails as above.

## UI elements
- Messages displayed in `register.html` as dismissible `alert-success` / `alert-danger` boxes.

## Data
- `users.activate` (string hash, removed on activation), `users.reset` (string hash), see AUTH-07 / password reset.
- Config `smtp.*` (`docs/reference/config.md` §4).

## Permissions & security
- Links are built from the configured public base URL (`base_url`, else the deployment origin `ORIGIN`/`APP_ORIGIN`), never from the request `Host` / `X-Forwarded-Host` headers (the request origin is only used when the request host is `localhost`); without any of them no mail is sent and an error is logged.
- Registration and lost-password mails are rate-limited per client (10 per 15 minutes).
- A slow SMTP server only delays the request concerned, not the whole site.
- Mail body is plain text (no HTML part); recipient headers are encoded by the mail library.

## Acceptance tests
- With SMTP pointing to Mailpit: POST `/register` with valid data -> Mailpit receives exactly one message, From = configured `sendername`, To = `"<realname>" <email>`, Subject "Welcome on INGInious", plain-text body ending with `<base>/register?activate=<hash>` where `<hash>` equals `users.activate`.
- POST `/register` `lostpasswd=1&recovery_email=<existing>` -> one mail "INGInious password recovery" starting "Dear <realname>," and containing `<base>/register?reset=<hash>` equal to `users.reset`.
- Language: with session language `fr`, subject/body are the French translations.
- SMTP down: registration shows the "Something went wrong while sending you activation email" error and no user document remains; lost password still shows the success message and the failure is logged.
- `sendername` absent -> sender `no-reply@ingnious.org` (legacy default; consider fixing the typo, documented).
- `starttls: true` -> STARTTLS used; `usessl: true` -> implicit TLS; `username`/`password` -> AUTH LOGIN.
- Test: a forged `Host` header does not change the link host when `base_url` is configured.
