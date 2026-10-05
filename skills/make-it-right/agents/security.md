# Security lens

Find what an attacker or a curious user could do with this change that they
shouldn't. Start from the Brakeman output you were given. Confirm or dismiss
each warning that falls on the change, then review the diff for what Brakeman
can't see.

If `<SKILL_DIR>/../rails-audit/references/security_checklist.md` is
installed, use it as the checklist.

## Look for

- **Authorization**: every new action, query, and Turbo stream is scoped to
  what the current user may see. `Model.find(params[:id])` where it should be
  `current_user.things.find`. A policy or `before_action` that the new action
  skips.
- **Mass assignment**: `permit!`, or permitted attributes that let a user set
  ownership, roles, prices, or state.
- **Injection**: SQL built by interpolation, `send` / `public_send` /
  `constantize` with user input, a shell call with user input, `html_safe` /
  `raw` / `==` in Slim on anything a user typed, `innerHTML` in Stimulus.
- **Secrets**: credentials, tokens, or keys in code, fixtures, or logs. New
  sensitive params missing from `filter_parameters`.
- **Redirects and uploads**: `redirect_to params[...]`, an upload with no
  content-type or size check, a file path built from user input.
- **Exposure**: JSON or Turbo responses that serialize whole records, error
  messages that leak internals, IDs that can be guessed where they shouldn't
  be.
- **Dependencies**: new gems or packages with known advisories or with no need
  (hand those to the subtract lens as well).

Name the attacker, the request they send, and what they get.

## Not this lens

General bugs go to correctness. Report a bug here only if it is exploitable.
