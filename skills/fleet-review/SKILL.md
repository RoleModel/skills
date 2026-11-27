---
name: fleet-review
description: Runs a multi-agent code review of the current branch and shows progress on a live localhost dashboard. Use when asked to "run fleet review", "fleet review this branch", or "run a fleet review against main".
disable-model-invocation: true
metadata:
  author: rolemodelsoftware
  version: "1.0"
  triggers: "run fleet review, fleet review this branch, run a fleet review against main"
---

# Fleet review

Core roles always run on Sonnet high. Opus selects conditional roles, including security, and chooses the lowest suitable reviewer tier for each. In order of increasing expected quality, the tiers are Terra high, Sonnet medium, Terra xhigh, and Sonnet high. Sonnet medium is the default when the tier is uncertain. Sol checks the findings, Astra gives a second opinion on referrals, and Sonnet deduplicates the report. Start the runner, wait for it, and relay its report without editing the branch.

The runner requires Node.js, Git, authenticated `claude` and `codex` CLIs with access to the configured models, and `longrun` for the dashboard session. Resolve `R` to the absolute path of [scripts/runner.mjs](scripts/runner.mjs) relative to this skill file. Run commands from the repository root. Set `R` in each shell that needs it.

1. **Check the diff.** Run `node "$R" preflight`. If the user named a base, add `--base <ref>` to both `preflight` and `start`. Otherwise the runner detects the default branch. If preflight exits non-zero, relay its message and stop.

2. **Check for an active run.** Run `node "$R" status`. If its phase is `starting`, `triage`, `review`, `validate` or `final`, share its live view URL and ask before replacing it.

3. **Start it.** Stop any finished run's live view, then start the new run and open it in the browser:

   ```bash
   longrun down --name fleet-review 2>/dev/null || true
   longrun open --name fleet-review -- node "$R" start
   ```

   Add `--base <ref>` to the end of the second command if the user named a base branch. The output includes `URL: http://localhost:…`. Tell the user in one line that the review started and give them that URL. If tmux fails in a sandbox, rerun `longrun` with escalated permissions.

4. **Wait for it.** Use your harness's background command and wait tools if available. Otherwise call `node "$R" wait --timeout 45` and retry while it exits with code 2. The review usually takes 10 to 30 minutes.

5. **Relay the report.** Share the report from `wait`, including any failure message and the live view URL. The dashboard stays up for two hours after the review finishes. `longrun down --name fleet-review` stops it sooner.

## Gotchas

- The diff includes staged, unstaged, and eligible untracked files and is shared with both model providers. Check for secrets or files outside the review scope before starting.
- `wait` exit code 2 means the run is still in progress. The run's diff, prompts, raw output, and report are saved under the Git directory at the printed `Run dir` path.
- When installing the skill, copy the entire folder so the runner can find its dashboard, roles, and prompts.

The role roster is in [scripts/roles.json](scripts/roles.json), prompts are in [templates](templates), and model choices, efforts, and timeouts are at the top of the runner.
