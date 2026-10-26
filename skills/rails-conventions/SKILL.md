---
name: rails-conventions
description: >-
  RoleModel's Rails conventions where they differ from what an agent writes by default: flash wording, the status for failed saves, Simple Form for every form, how route concerns pass the parent type, and two gotchas (`params.expect` with nested attributes, and Lexxy rich-text change events). Use when writing or reviewing a Rails controller, route, form, or view in a RoleModel app. Also use when the user says things like "add a controller for", "build the form for", "add routes for", "add comments to", "why isn't my nested form saving", or "review this controller".
metadata:
  triggers: "rails controller, controller action, routes.rb, route concern, rails form, simple form, simple_form_for, flash message, params.expect, strong params, nested attributes, lexxy, rails view"
---

# Rails Conventions

This skill only covers what an agent got wrong without it in baseline tests. Everything else is standard Rails 8 practice, which the agent already follows. Where a project's own code or `docs/conventions/` disagrees, follow the project.

## Rules

- **Flash wording:** `notice: 'Successfully Created Widget'`, `'Successfully Updated Widget'`, `'Successfully Deleted Widget'`. Use `alert:` for failures.
- **Failed saves:** `render :new, status: :unprocessable_content`, never `:unprocessable_entity`, which is the deprecated name for the same 422.
- **Forms:** always `simple_form_for` and `simple_fields_for`, never `form_with` or `form_for`. Non-model forms use a symbol: `simple_form_for :search, url: widgets_path, method: :get`, which nests params under `:search`.
- **Route concerns pass the parent type with `parent_resource.name.classify`**, not a hard-coded string or a concern option:

  ```ruby
  concern :commentable do
    resources :comments, commentable_type: parent_resource.name.classify
  end
  ```

  The controller turns it back into the record with `resource_for(:commentable_type)` from `rolemodel_rails`, called only on collection actions. Read `polymorphic-parent-resources` before writing that controller.
- **Dynamic forms** (dependent selects, conditional fields) use the `turbo_form` gem. Read `dynamic-forms`.
- **Mounted engines that expose data or controls** (Sidekiq Web, PgHero, Blazer) go behind an admin-only route constraint, and dev-only engines (Letter Opener Web) mount only outside production. This one is a safety rule, kept even though the baseline tests didn't cover it.

## Gotchas

- **`params.expect` needs double brackets for nested attributes.** `parts_attributes: [[:id, :name, :_destroy]]` matches the indexed hash that `fields_for` submits. The single-bracket form `parts_attributes: %i[id name _destroy]` silently drops every nested record under `expect`, though it works under `permit`.
- **Lexxy rich-text fields report edits with a `lexxy:change` event.** Anything that reacts to form edits by listening for `change` or `input` (auto-save, unsaved-changes warnings, dynamic form triggers) must listen for `lexxy:change` too, or edits in the editor are missed.
