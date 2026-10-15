# Lost password and password reset

- **ID**: AUTH-08
- **Actors**: anonymous (user who forgot their password)
- **Routes**: POST `/register` (field `lostpasswd`), GET `/register?reset=<hash>`, POST `/register` (field `resetpasswd`)
- **Depends on**: AUTH-07 (same page, same guards), SMTP
- **Legacy code**: `legacy/inginious/frontend/pages/register.py:L47-L59` (`get_reset_data`), `L120-L160` (`lost_passwd`), `L162-L185` (`reset_passwd`), `L187-L207` (POST dispatch), template `templates/register.html:L57-L102`

## Use case
A local-account user who forgot their password requests a reset link by e-mail and sets a new password.

## Preconditions
- `allow_registration: true`, visitor not logged in (else 403 "You're not allow to register.").
- SMTP configured.

## Main flow
1. On `/register` (or via "Lost password?" link → `/register#lostpasswd`), the user enters `recovery_email` and clicks "Reset my password" (`name="lostpasswd"`).
2. Validate format with the same e-mail regex as registration (on the raw value, **not** sanitized) → else "Invalid email format.".
3. `reset` = new token from a CSPRNG, valid one hour; `users.findOneAndUpdate({email: recovery_email (exact, case-sensitive)}, {$set:{reset}})`. The answer is the same whether or not the address is known; the mail is only sent when an account uses it.
4. Send mail: To `(realname, recovery_email)`, Subject "INGInious password recovery", body:
   ```
   Dear <realname>,

   Someone (probably you) asked to reset your INGInious password. If this was you, please click on the following link :
   <base_url>/register?reset=<token>
   ```
   Success (green): "An email has been sent to you to reset your password."
5. User opens `GET /register?reset=<token>`: token well-formed, not expired and `users.findOne({reset: token})` found → the page shows only a card "Set new password for <realname> [<username>]" with `passwd`, `passwd2`, hidden `reset`, button "Set new password" (`name="resetpasswd"`). Not found → red "Invalid reset hash." (not translated) + normal register/lost forms.
6. POST `resetpasswd`: `get_reset_data(form)` again (hash must still exist), then:
   - `len(passwd) < 6` → "Password too short." (reset card shown again)
   - `passwd != passwd2` → "Passwords don't match !" (reset card shown again)
   - `users.findOneAndUpdate({reset}, {$set:{password: argon2id-…}, $unset:{reset:1, activate:1}})`, all sessions of the user are closed → green "Your password has been successfully changed." and the normal register/lost forms.
7. User signs in with the new password.

## Alternative / error flows
- Reset POST with unknown hash → red "Invalid reset hash." and the register/lost forms.
- Reusing a consumed link → "Invalid reset hash.".
- The reset mail is sent in the background: an SMTP failure is logged (`Couldn't send email : <ex>`), the answer stays the success message and the `reset` token remains stored. "Something went wrong while sending you reset email. Please contact the administrator." is only shown when no public base URL is configured to build the link.
- Requesting twice overwrites the previous hash (only the last link works).
- Missing form fields → 400.
- Users created by external auth without password can also get a reset link (they have an e-mail) → this sets a password.

## UI elements
- "Lost password ?" column (`id="lostpasswd"`): label "Email address :", text input `recovery_email`, warning button "Reset my password" (`fa-undo`).
- Reset card: header "Set new password for {realname} [{username}]" (formatted *before* translation → never translated), labels "Password (min. 6 characters) :", "Confirm password :", button "Set new password".

## Data
- `users.reset`: token string (same format as `activate`, AUTH-07), set on request, unset on success. `users.activate` also unset on success (reset activates an unactivated account), `users.password` replaced by `argon2id-…`.
- Config: `allow_registration`, `smtp`.

## Permissions & security
- The answer does not reveal whether an e-mail address is registered.
- Reset links are built from the configured public base URL (`base_url`, else the deployment origin), never from the request `Host` header (except for `localhost` development).
- Reset tokens come from a CSPRNG, expire after one hour and are single-use.
- A successful reset closes all sessions of the user.
- Feature only available when `allow_registration` is true (deliberately couples lost-password to self-registration).
- Reset requests are protected by the origin check (CORE-04); lost-password requests are rate-limited per client (10 per 15 minutes, shared with registration).
- Lookup by exact e-mail string: the user must type the e-mail exactly as stored (registration lower-cased the domain).

## Acceptance tests
- `recovery_email=bad` → "Invalid email format."; unknown e-mail → same success message, no mail sent, nothing stored; e-mail with wrong local-part case (`auth_r@x.org` for stored `Auth_R@x.org`) → treated as unknown.
- Valid request → `users.reset` set; Mailpit message "INGInious password recovery" containing `register?reset=<that token>`.
- `GET /register?reset=<token>` → card "Set new password for <realname> [<username>]" with hidden `reset` input = token; `?reset=bogus` or an expired token → "Invalid reset hash.".
- POST short password → "Password too short." and the reset card still displayed; mismatch → "Passwords don't match !" and card displayed.
- Valid POST → "Your password has been successfully changed."; `reset` and `activate` removed; other sessions of the user closed; login with new password works; second use → "Invalid reset hash.".
- Logged-in user → 403 on all of the above.
