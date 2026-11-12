# Data safety

The user picks one data mode before the run starts. Every browser action in the run follows it, in the main agent and in every section mapper.

| Mode | Submit forms | Create records | Change or delete records the run created | Change or delete existing records |
|------|--------------|----------------|------------------------------------------|-----------------------------------|
| **Protect existing data** (default) | yes | yes | yes | **no** |
| **Allow changes to existing data** | yes | yes | yes | yes, local host only |
| **Read-only** | no | no | no | no |

"Allow changes" is refused on a hosted test environment. Offer "Protect" instead.

## Always off, in every mode

- Signing out, or changing the signed-in user's own email, password, or roles.
- Anything that leaves the app: sending email, invitations, or notifications to real addresses; pushing to an external system (ERP sync, payment, webhooks); publishing or sharing a public link. If a form's purpose is to send something, document it and don't submit it.
- Bulk actions ("delete all", "archive selected", imports) unless every affected row is in the ledger.
- Changing organization-wide settings, permissions, or other users.

## Marking created records

Every record the run creates gets the run marker at the start of its name or title field: `QA Map <run-id>` (for example `QA Map 20261112-1430 Widget`). If the form has no name-like field, put the marker in the first free-text field. Records created inside a ledger record (a line item on a QA Map order) count as created by the run.

Right after a create succeeds, append one line to the ledger, `tmp/app-map/<run-id>/ledger/<section>.jsonl`:

```json
{"model":"Widget","id":"812","name":"QA Map 20261112-1430 Widget","url":"/widgets/812","section":"widgets","role":"admin","createdFrom":"/widgets/new"}
```

`model` is the record's class name and `id` is the identifier from its URL. Cleanup uses these to find the record.

## What counts as changing existing data

Before clicking a control, decide whether it changes a record the run doesn't own. Treat it as a change when any of these are true:

- It submits a form whose action is PATCH, PUT, or DELETE on a record outside the ledger.
- It has `data-turbo-method` or `data-method` other than GET, or `data-turbo-confirm`/`data-confirm`.
- Its label is a verb of change: Save, Update, Delete, Remove, Archive, Restore, Duplicate onto, Move, Reorder, Approve, Reject, Cancel (an order or job), Reset, Revoke, Disconnect, Toggle, Enable, Disable.
- It's a drag, inline edit, toggle, or autosaving field on an existing record.

In Protect mode, open such a control to document it (open the modal, read the confirm dialog's text), then back out: dismiss the dialog, press Cancel, or navigate away. Never press the final confirm.

## Cleanup

At the end of the run, show the user the merged ledger (model, name, URL, role) and ask whether to delete those records. On yes, delete them from the Rails console, not the browser:

1. Write `$RUN/cleanup.rb` with one `[model, id]` pair per ledger record, children before their parents. For each pair, find the record (use the lookup the app's controller uses when the id is a slug), skip it unless one of its attributes contains the run marker `QA Map <run-id>`, then call `destroy`. Print one line per record: destroyed, missing, skipped (no marker), or failed with `errors.full_messages`.
2. Run it against the database the app under test uses: `bin/rails runner $RUN/cleanup.rb`, with the same `RAILS_ENV` as the running server.
3. Report each record that wasn't destroyed, with its URL. Ask before deleting a skipped record by any other means.

Use `destroy`, never `delete` or `delete_all`, so callbacks and `dependent:` associations run. A record created inside a ledger record (an unmarked line item on a marked order) goes with its parent. List any that remain afterward.

On a hosted test environment, this machine's console reaches the wrong database. Give the user `cleanup.rb` to run in that environment's console, and don't run it yourself.

Records whose names carry the `QA Map` marker but are missing from the ledger come from a crashed run. List them and ask about them separately.
