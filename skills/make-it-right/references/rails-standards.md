# RoleModel Rails standards

Defaults the standards lens applies when the project's docs and the matching
skills say nothing. Cite a finding as `rails-standards: <heading>`.

## Partials declare their locals

Every partial starts with a strict-locals comment, including partials that
take none:

```slim
-# locals: (client:, size: 48)
-# locals: ()
```

## Enums are string-backed

```ruby
enum :role, { user: 'user', admin: 'admin' }, validate: true
```

Integer enums and enums without `validate: true` are findings in new code.

## Data for each variant lives in one place

When several variants share a shape (payment providers, AI clients, report
types), each variant's links, labels, and copy go in `config/<area>/*.yml`,
read into a `Data.define` value object with `all` and `find`. Views read
attributes off the object. They don't branch on the variant's key, and code
doesn't keep a parallel hash constant.

## `db/schema.rb` shows only the change's migrations

The schema diff holds what this change's migrations add, and nothing else. A
local dump that reorders columns, or adds tables from other branches, is
noise: restore `schema.rb` from the base and add the migration's lines by
hand.

## Migrations

Never edit a migration that has been deployed. An unreleased migration may be
replaced, but give the replacement a new version, so a database that ran the
old one still runs the new one.
