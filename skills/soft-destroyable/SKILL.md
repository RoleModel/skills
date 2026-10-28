---
name: soft-destroyable
description: Soft-delete ActiveRecord models with the `SoftDestroyable` concern installed by the rolemodel_rails `rolemodel:soft_destroyable` generator, including cascading soft deletes and restores across associations. Use when making a model soft-deletable, deleting or restoring a soft-destroyable record, querying around deleted records, or testing a soft-destroyable model.
metadata:
  triggers: "soft delete, soft destroy, soft_destroy, soft_destroyable, SoftDestroyable, deleted_at, kept, only_deleted, restore, cascade_soft_destroy, archive record, a soft destroyable"
---

# Soft Destroyable

`app/models/concerns/soft_destroyable.rb` marks records deleted by setting a `deleted_at` timestamp instead of removing rows. If the concern isn't there, run `bin/rails g rolemodel:soft_destroyable`.

## Making a model soft-destroyable

1. Add a nullable `deleted_at` datetime column (the generator doesn't add one).
2. Include the concern, and cascade to any associations that should go and come back with the parent:

```ruby
class Estimate < ApplicationRecord
  include SoftDestroyable

  has_many :line_items
  cascade_soft_destroy :line_items   # each associated model must also include SoftDestroyable
end
```

## Rules

- **Never add a `default_scope`.** The concern raises if you do. Scope explicitly with `Estimate.kept` / `Estimate.only_deleted`, including in associations and policy scopes.
- **Call `soft_destroy!`, not `destroy`.** `destroy` still hard-deletes. `soft_destroy!` raises `ActiveModel::ValidationError` if the update fails. `soft_destroy` returns falsy instead.
- **Restores match on timestamp.** `restore!` clears `deleted_at` and restores cascaded children *soft-destroyed at the same moment*. Children deleted earlier on their own stay deleted. Restore failures only surface at the top level.
- `soft_destroyed?` reports the state. The class-level `soft_destroy` / `restore(timestamp)` act on relations.
- If assigned attributes include `_soft_destroy`, every other attribute is dropped and only `_soft_destroy` is assigned. The model must define a `_soft_destroy=` writer, or that assignment raises `ActiveModel::UnknownAttributeError`.

## Testing

Use the shared example installed at `spec/support/shared_examples/soft_destroyable_behavior.rb`:

```ruby
RSpec.describe Estimate do
  it_behaves_like 'a soft destroyable', :estimate,
                  factory_traits: [:with_line_items],
                  dependent_destroy_relations: [:line_items]
end
```

The factory (plus traits) must build records that have the cascaded associations populated, or the dependent examples have nothing to check.
