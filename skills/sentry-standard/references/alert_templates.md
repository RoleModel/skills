# Alert rule templates (RoleModel Sentry Standard v1)

All alerts route to the app's team Slack channel (teams map to Linear teams; ask the user
for the channel if unknown). Create rules with the `sentry` CLI — always run with
`--dry-run` first. If a payload is rejected, check the current shape with
`sentry schema --search 'alert'`.

## Finding the Slack integration ID (needed by every action)

```sh
sentry api 'organizations/rolemodel-software/integrations/?provider_key=slack' --json
```

Use the returned integration `id` as `workspace` (issue alerts) / `integrationId`
(metric alert triggers).

## 1. New issue → Slack (issue alert)

```sh
sentry alert issues create rolemodel-software/{PROJECT_SLUG} \
  --name 'New Issue → Slack' \
  --condition '{"id":"sentry.rules.conditions.first_seen_event.FirstSeenEventCondition"}' \
  --action '{"id":"sentry.integrations.slack.notify_action.SlackNotifyServiceAction","workspace":"{SLACK_INTEGRATION_ID}","channel":"#{TEAM_CHANNEL}","tags":""}' \
  --action-match any \
  --frequency 1440 \
  --environment production \
  --owner 'team:{TEAM_ID}'
```

Note: do **not** add an issue-category filter — cron monitor failures and uptime
failures also surface as issues, and this rule is what routes them to Slack.

## 2. Regression → Slack (issue alert)

Same as rule 1 with:

```sh
  --name 'Regression → Slack' \
  --condition '{"id":"sentry.rules.conditions.regression_event.RegressionEventCondition"}' \
```

## 3. Error-volume spike (metric alert)

Compute the threshold first: average hourly error count over the last 30 days × 10
(minimum 50). Get the baseline with `sentry explore` (dataset errors, `count()`,
period 30d) and divide by 720 hours.

```sh
sentry alert metrics create rolemodel-software \
  --name 'Error volume spike' \
  --dataset errors \
  --query 'event.type:error' \
  --aggregate 'count()' \
  --time-window 60 \
  --environment production \
  --project {PROJECT_SLUG} \
  --trigger '{"label":"critical","alertThreshold":{10X_HOURLY_BASELINE},"actions":[{"type":"slack","targetType":"specific","targetIdentifier":"#{TEAM_CHANNEL}","integrationId":{SLACK_INTEGRATION_ID}}]}' \
  --owner 'team:{TEAM_ID}'
```

## 4 & 5. Cron and uptime failures

Cron monitor failures and uptime downtime create **issues** (category `cron` /
`uptime`), so they route through rule 1 automatically. The skill's job is
validation, not new rules:

- Every cron monitor has `failure_issue_threshold` set (1 is the standard) so
  failures actually create issues. Fix:
  `sentry api organizations/rolemodel-software/monitors/{MONITOR_SLUG}/ -X PUT -F 'config[failure_issue_threshold]=1'`
  (merge with the existing `config` object — fetch it first, PUT the full config back).
- The uptime monitor exists and is active:
  `sentry api organizations/rolemodel-software/uptime/` (verify endpoint shape with
  `sentry schema --search uptime` before creating one).
