---
name: polymorphic-parent-resources
description: Serve a child resource that hangs off many different parents — comments, reports, duplications, attachments — from a single Rails controller, using a route concern plus `resource_for` from the rolemodel_rails gem. Use when a child resource needs to attach to several parent models, when about to write a second or third namespaced controller that differs only by its parent (`Articles::CommentsController`, `Widgets::CommentsController`), when a route concern passes a `*_type` route default such as `commentable_type` or `reportable_type`, when a controller looks up its parent with a hard-coded `Parent.find(params[:parent_id])` that now needs to support more parents, or when consolidating duplicated per-parent controllers.
metadata:
  triggers: "polymorphic parent, polymorphic association controller, comments on multiple models, commentable, reportable, duplicatable, attachable, commentable_type, reportable_type, parent_resource.name.classify, resource_for, rolemodel_rails, one controller many parents, duplicate controllers per parent, namespaced controller per parent, shared child controller, route concern parent type, consolidate controllers"
---

# Polymorphic Parent Resources

## Overview

Apps accumulate child resources that hang off many different parents — `comments`, `generated_reports`, `duplications`, `attachments`. The naive approaches both scale badly:

- **A namespaced controller per parent** (`Articles::CommentsController`, `Widgets::CommentsController`, `Accounts::CommentsController`) — identical code, N copies, N sets of specs.
- **Non-RESTful actions bolted onto each parent controller** (`ArticlesController#add_comment`) — breaks REST and spreads comment logic across the app.

This pattern uses one route concern plus one controller to serve every parent. The parent's class name travels as a **route default**, and `resource_for` turns it back into the record.

## When to Use

- A child resource belongs to two or more parent models (or will soon)
- About to duplicate a controller whose only difference is which parent it loads
- Consolidating existing per-parent controllers — see `references/retrofit.md`

**When not to use:** a child with exactly one parent and no plans for more. A plain nested controller with `Parent.find(params[:parent_id])` is clearer. Reach for this pattern at the second parent, not in anticipation of one.

## Prerequisite: rolemodel_rails >= 2.4.0

`resource_for` ships in **rolemodel_rails 2.4.0**. Most existing projects are on older versions. Check before writing code that depends on it:

```bash
bundle info rolemodel_rails    # confirm >= 2.4.0
```

If the test fails, **bump the gem** — that is the fix. Only if the version is pinned for an unrelated reason, add the equivalent locally and delete it when the gem is upgraded:

```ruby
# app/controllers/concerns/resource_for.rb
# TEMPORARY: remove once rolemodel_rails >= 2.4.0 — provided by the gem's engine
module ResourceFor
  extend ActiveSupport::Concern

  private

  def resource_for(type_symbol)
    params[type_symbol].safe_constantize.find(params[params[type_symbol].foreign_key])
  end
end
```

No `include` is needed with the gem — the engine adds `resource_for` to every controller via `ActiveSupport.on_load(:action_controller_base)`.

## The Pattern

### 1. Models

The child holds the polymorphic association; each parent declares the inverse.

```ruby
class Comment < ApplicationRecord
  belongs_to :commentable, polymorphic: true
end

class Article < ApplicationRecord
  has_many :comments, as: :commentable, dependent: :destroy
end
```

### 2. Routing

Declare the child inside a route concern and pass the parent's class name as a route default. `parent_resource` is available inside a concern block and refers to whichever resource applied it.

```ruby
concern :commentable do
  resources :comments, commentable_type: parent_resource.name.classify
end

concern :reportable do
  resources :generated_reports, only: %i[show create], reportable_type: parent_resource.name.classify
end

shallow do
  resources :accounts do
    resources :articles, concerns: %i[commentable reportable] do
      resources :widgets, concerns: %i[commentable reportable]
    end
  end
end
```

### 3. Controller

One controller serves every parent. Under `shallow`, only the collection actions carry the parent id, which drives the `only:`/`except:` split.

> **Scope the parent `before_action` — never run it on member actions.** When a concern with member actions is applied to more than one parent, Rails draws `/comments/:id` once per parent and only the first keeps the route name; the rest are unreachable duplicates. So every member request resolves with the **first-drawn** parent's `*_type` default regardless of the record's real parent. `params[:commentable_type]` is therefore present but wrong on member actions. Member actions do not need it: find the child by `params[:id]` and reach the parent through its own association.

```ruby
class CommentsController < ApplicationController
  before_action :set_commentable, only: %i[index new create]
  before_action :set_comment, except: %i[index new create]

  def index
    @comments = policy_scope(@commentable.comments)
  end

  def new
    @comment = authorize @commentable.comments.build
  end

  def create
    @comment = authorize @commentable.comments.build(comment_params)

    if @comment.save
      redirect_to [@commentable, :comments], notice: 'Successfully Created Comment'
    else
      render :new, status: :unprocessable_content
    end
  end

  private

  def set_commentable
    # Pass the symbol declared in the routing concern
    @commentable = resource_for(:commentable_type)
  end

  def set_comment
    # Member actions find the child directly and reach the parent through its own association
    @comment = authorize Comment.find(params[:id])
  end

  def comment_params
    params.expect(comment: %i[body])
  end
end
```

`resource_for` returns the record itself, so it composes with authorization and presentation:

```ruby
def set_resource
  @resource = authorize resource_for(:resource_type)
end
```

### 4. Views

Polymorphic routing keeps paths parent-agnostic — one set of views serves every parent: `= simple_form_for [@commentable, @comment] do |f|`.

## Guarding User-Supplied Types

Route defaults are merged into `params` last, so a route-supplied type **cannot** be overridden by a query string or request body. If a type ever arrives from user input instead, allowlist it before calling `resource_for` — `safe_constantize` will resolve any constant in the app.

```ruby
REPORTABLE_TYPES = %w[Article Widget].freeze

before_action :verify_reportable_type, :set_reportable, only: %i[create]

private

def verify_reportable_type
  return if REPORTABLE_TYPES.include?(params[:reportable_type])

  redirect_back_or_to root_url, alert: 'Invalid Request'
end
```

Do this even for route-supplied types: it documents which parents the controller actually supports and fails loudly when a new route wires up a parent the controller cannot handle.

## Gotchas

| Symptom | Cause | Fix |
| --- | --- | --- |
| `NoMethodError` on `nil` inside `resource_for` | `safe_constantize` returned `nil` — unknown or misspelled constant in the `*_type` default | Fix the route default; allowlist the type |
| Unexplained 404 on every member action (`show`, `edit`, `update`, `destroy`) | The parent `before_action` ran on a shallow member route: the `*_type` default is inherited from the first-drawn parent, whose id param is absent, so `find(nil)` raises | Scope the parent `before_action` to `%i[index new create]` |
| Member action behaves as though the child belongs to the wrong parent | Same cause — `params[:commentable_type]` on a shallow member route is always the first-drawn parent | Never read the `*_type` param on member actions; use `@comment.commentable` |
| `ActiveRecord::RecordNotFound` (404) on a collection action | Id did not resolve — same behavior as any `find` | Expected; nothing to fix |
| Wrong id param looked up for a namespaced parent | The class name is demodulized to derive the id param, so `Inventory::Widget` looks for `params[:widget_id]` | Expected; avoid two namespaced parents that demodulize to the same name |
| `resource_for` undefined in an API controller | Included via `on_load(:action_controller_base)`, so `ActionController::API` does not get it | Include the concern explicitly in the API base class |
| `resource_for` undefined everywhere | rolemodel_rails < 2.4.0 | Bump the gem — see prerequisite above |

## Retrofitting an Existing App

To find and consolidate duplicated per-parent controllers already in a project, read `references/retrofit.md`. It covers the audit commands, the consolidation order, and how to keep specs and routes green through the change.

## Related Skills

- **rails-conventions** — route concern, flash, and failed-save conventions
- **tdd** — request and system specs for the consolidated controller
