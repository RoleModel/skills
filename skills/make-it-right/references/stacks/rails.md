# Rails stack map

Selected in step 1 when the `Gemfile` names `rails`. The principle files state
rules any stack can apply and cite the headings here for this stack's
spellings. A project's own rules override anything on this page. Cite a
default from "Org defaults" as `rails stack map: <heading>`.

## Where names hide

Rails finds code by name. Grep a name as a method, a string, a symbol, and a
path fragment: `data-controller` / `data-action` values, partial and template
names, `send` / `public_send` / `constantize`, route helpers, i18n keys,
callbacks, job class names, and factory names.

## Stdlib does it

Ruby core and ActiveSupport: `Array#sum`, `group_by`, `tally`, `each_slice`,
`Hash#dig`, `presence`, `in?`, `Comparable`, `Enumerable`, `Date` and `Time`
math, `to_sentence`, `truncate`, `pluralize`.

## Framework does it

Associations, validations, `delegate`, `normalizes`, enums, `has_secure_token`,
`has_rich_text`, counter caches, scopes, `ActiveJob` retries, Turbo frames and
streams, and Stimulus values, outlets, targets, and classes.

## Already in the project

Concerns, helpers, view components, design-system classes, factories, and the
gems in the `Gemfile`. Search for reuse by what the code does: for a cache key,
a freshness check, or a broadcast, grep `maximum(:updated_at)`, `cache_key`,
`broadcast_`.

## Layers

- Request layer: controllers, which read `params`, `request`, and
  `current_user`.
- Presentation: views, helpers, presenters, view components, and Stimulus
  controllers.
- Domain: models and plain Ruby objects. Framework request objects don't
  belong here.

## Security sinks

- Authorization: `Model.find(params[:id])` where `current_user.things.find`
  was meant; a policy or `before_action` the new action skips; a Turbo stream
  broadcast to a channel wider than the viewer.
- Mass assignment: `permit!`, or permitted attributes that let a user set
  ownership, roles, prices, or state.
- Injection: SQL built by interpolation; `send` / `public_send` /
  `constantize` with user input; a shell call with user input; `html_safe` /
  `raw` / `==` in Slim on anything a user typed; `innerHTML` in Stimulus.
- Log filter: new sensitive params missing from `filter_parameters`.
- Redirects: `redirect_to params[...]`.
- Exposure: `to_json` or `render json:` on whole records; Turbo responses that
  include what the viewer can't see.

## Scanners left to CI

Brakeman and `bundler-audit`.

## Test levels

| Seam | Local name | Lives in |
|---|---|---|
| User-facing flow | system spec | `spec/system` |
| Boundary with no UI | request spec | `spec/requests` |
| Domain unit | model spec, or a plain unit spec | `spec/models`; `spec/lib`, `spec/services` for plain objects |

Test conventions skill: `tdd/SKILL.md` (see "Leans on") for FactoryBot,
`let`, and Capybara. Freeze the clock with `travel_to(Time.current.noon)`
(needs `ActiveSupport::Testing::TimeHelpers` included in the RSpec config). Disabled tests look like
`skip`, `pending`, `xit`. A weak assertion looks like `have_content` on text
that renders regardless. Groups and cases are `describe` / `context` / `it`.

## Framework tests to delete

`is_expected.to belong_to(:account)` and plain `presence` / `uniqueness` /
`length` matchers with no condition; that `has_secure_password`, Devise,
Pundit's DSL, `enum`, or `normalizes` does what its docs say; that a route
exists, a controller renders a template, or a factory is valid.

## Contracts to match

Permitted params against the keys the client sends; a JSON response against
every caller of that URL; `data-<controller>-<name>-value` attributes against
the controller's `static values`; a partial's `locals:` against each `render`.

## Data

- The schema snapshot is `db/schema.rb`, or `db/structure.sql` when
  `schema_format` is `:sql`. Restore it from the base and add the migration's
  lines by hand.
- A not-null constraint is `null: false`; a rollback is `down`.
- A callback that fires before commit is `after_save` where `after_commit`
  was meant.
- A hidden one-to-many wants a `has_many` table.
- Enums: integer-backed, or missing `validate: true`, breaks "Org defaults".

## Org defaults

RoleModel's defaults where the project says nothing.

- **Partials declare their locals.** Every partial starts with a strict-locals
  comment, including partials that take none: `-# locals: (widget:, size: 48)`
  or `-# locals: ()`.
- **Enums are string-backed and validated.**
  `enum :role, { user: 'user', admin: 'admin' }, validate: true`. Integer
  enums and enums without `validate: true` are findings in new code.
- **Data for each variant lives in one place.** When several variants share a
  shape (payment providers, report types), each variant's links, labels, and
  copy go in `config/<area>/*.yml`, read into a `Data.define` value object
  with `all` and `find`. Views read attributes off the object and don't branch
  on the variant's key.
- **Models return domain values; helpers present them.** Labels, rounding for
  display, and the shape a chart wants go in a helper or presenter. A model
  method that only views call is the sign.
- **`db/schema.rb` shows only the change's migrations.** Reordered columns or
  tables from another branch are noise.
- **Migrations.** A data migration defines the models it uses inside the
  migration class. Never edit a deployed migration. An unreleased one may be
  replaced, under a new version.

## Boot and data

Boot with `bin/dev` or `Procfile.dev`, or the `run` skill. Seed with
`bin/rails db:seed`; build records with `bin/rails runner` and FactoryBot. Dev
credentials live in seeds and docs.

## Linters and check

Prefer the project's `bin/check` or equivalent. Otherwise: lint with
`bundle exec rubocop -A`, run files with `bundle exec rspec <files>`, and the
full suite with `bundle exec turbo_tests` where installed, else
`bundle exec rspec`.

## Leans on

Siblings live at `<SKILL_DIR>/../<name>` or `.claude/skills/<name>`. Step 1
checks each once and passes the ones present as `Also read`.

| Path | For |
|---|---|
| `tdd/SKILL.md` | coverage, and step 5's proving specs |
| `ux-review/SKILL.md` | ui-ux |
| `rails-audit/references/security_checklist.md` | security |
| `rails-audit/references/poro_patterns.md`, `code_smells.md` | maintainable, as reading guides |

`rails-conventions/SKILL.md` reaches conventions through Rule sources.
