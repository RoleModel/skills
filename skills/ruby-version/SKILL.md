---
name: ruby-version
description: Verify what Ruby versions actually exist and install a specific Ruby via rbenv. Use BEFORE asserting that any Ruby version does or doesn't exist (e.g., "Ruby 4.0 isn't out yet", "the latest Ruby is 3.x", "Ruby X.Y.Z doesn't exist"). Also use when the user asks "what's the latest Ruby", "is Ruby X out", "does Ruby X.Y exist", "install Ruby", "switch to Ruby X", "what Ruby is installed", or mentions a specific Ruby version you're unsure about. Also use when changing a project's Ruby version ("bump Ruby", "upgrade Ruby to X", editing `.ruby-version`). Claude's training data may be out of date — run `check.sh` first.
license: MIT
metadata:
  triggers:
    - latest ruby
    - ruby version
    - install ruby
    - ruby X.Y exists
    - newest ruby
    - current ruby
    - switch ruby
    - rbenv
    - ruby-build
    - bump ruby
    - upgrade ruby
    - .ruby-version
---

# ruby-version

Checks which Ruby versions exist, installs one through rbenv, and walks through changing a project's Ruby version.

## When to invoke this skill

**Mandatory: run `check.sh` before making any claim about whether a specific Ruby version exists, has been released, or is the latest.** Claude's training cutoff lags real Ruby releases — guessing is the failure mode this skill exists to prevent.

Also invoke when the user:
- Asks what Ruby versions are installed.
- Asks for the latest stable Ruby.
- Wants to install a specific Ruby (`install.sh`).
- Changes a project's Ruby version (see "Changing a project's Ruby version").

## Scripts

### `scripts/check.sh`

Prints:
- The latest stable MRI Ruby known to local ruby-build.
- All Ruby versions currently installed via rbenv.
- The ruby-build version (so staleness is visible — if it's months old, "latest" may lag reality).

```bash
bash skills/ruby-version/scripts/check.sh
```

No arguments. Exits non-zero with a remediation hint if `rbenv` or `ruby-build` is missing.

**How to read the output:** The line beginning `latest-stable:` is the highest stable MRI release ruby-build knows about. Treat that as ground truth over any version number you recall from training data. The `installed:` block is what the user has on this machine; an empty list means none installed via rbenv.

### `scripts/install.sh <version>`

Installs a specific Ruby via rbenv + ruby-build. Validates the version exists in ruby-build's known list first.

```bash
bash skills/ruby-version/scripts/install.sh 3.4.2
```

Does **not** set the version as global or local. After install, suggest the user run `rbenv global <version>` or `cd <project> && rbenv local <version>` based on their intent.

If the requested version isn't in `rbenv install -l`, the script prints a hint to upgrade ruby-build (`brew upgrade ruby-build`) rather than failing silently.

## Changing a project's Ruby version

After `check.sh` confirms the version exists, update every place the project pins Ruby:

- `.ruby-version`
- `RUBY_VERSION` in `Dockerfile`
- the `RUBY VERSION` line in `Gemfile.lock`: with the new Ruby active, run `bundle update --ruby`, which changes only that line

Search the repo for the old version to find any others.

Then check every `ruby/setup-ruby` step in `.github/workflows/`, not only the workflows that ran on your PR. Some workflows run only when their own file changes, so a green PR does not prove their pin works.

The action can install only the Ruby versions listed in `ruby-builder-versions.json` at the release it pins. If the pin is a floating tag such as `v1`, leave it: it always gets the newest release. For any other pin, this command prints `true` if the pinned release lists the new version:

```bash
gh api -H "Accept: application/vnd.github.raw" \
  "repos/ruby/setup-ruby/contents/ruby-builder-versions.json?ref=<pin>" \
  | jq -e --arg v <version> '.ruby | index($v) != null'
```

`<pin>` is the text after `@` in the workflow: a tag such as `v1.338.0`, or a commit SHA. If the command prints `false`, change the pin to the newest `ruby/setup-ruby` release in the same form (a tag for a tag, that release's SHA for a SHA), and run the command again. If the newest release still prints `false`, stop and tell the user that setup-ruby does not support this Ruby yet.

## Gotchas

- If a workflow fails with `Unknown version <version> for ruby on <runner>`, its `ruby/setup-ruby` pin is older than that Ruby. Run the pin check above.

## Assumptions

- macOS with Homebrew, rbenv, and ruby-build installed.
- The pin check needs `gh` (signed in) and `jq`.
- Scripts are bash (not Ruby) so they work even when Ruby is missing or broken.

## Anti-patterns

- Do not assert "Ruby X doesn't exist yet" from memory. Run `check.sh`.
- Do not have `install.sh` auto-set global or local Ruby — that's a user decision.
- Do not install gems, run other Bundler commands, or manage gemsets as part of a Ruby bump. This skill only checks Ruby versions, installs Ruby, and updates a project's Ruby pins.
