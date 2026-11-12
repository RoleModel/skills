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
{"type":"Widget","name":"QA Map 20261112-1430 Widget","url":"/widgets/812","section":"widgets","role":"admin","createdFrom":"/widgets/new"}
```

## What counts as changing existing data

Before clicking a control, decide whether it changes a record the run doesn't own. Treat it as a change when any of these are true:

- It submits a form whose action is PATCH, PUT, or DELETE on a record outside the ledger.
- It has `data-turbo-method` or `data-method` other than GET, or `data-turbo-confirm`/`data-confirm`.
- Its label is a verb of change: Save, Update, Delete, Remove, Archive, Restore, Duplicate onto, Move, Reorder, Approve, Reject, Cancel (an order or job), Reset, Revoke, Disconnect, Toggle, Enable, Disable.
- It's a drag, inline edit, toggle, or autosaving field on an existing record.

In Protect mode, open such a control to document it (open the modal, read the confirm dialog's text), then back out: dismiss the dialog, press Cancel, or navigate away. Never press the final confirm.

## Cleanup

At the end of the run, show the user the merged ledger (type, name, URL, role) and ask whether to delete those records. On yes, delete each one through the app's own delete control as the role that created it, and document that delete flow if it isn't documented yet. Report any record that couldn't be deleted, with its URL. Records whose names carry the `QA Map` marker but are missing from the ledger come from a crashed run. List them and ask about them separately.
