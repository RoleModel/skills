---
name: dynamic-forms
description: Build forms that change as they are filled in — cascading or dependent dropdowns, conditional fields and sections, option lists that depend on another field, STI type switches — with the turbo_form gem. Use when a form must update without a full page reload, when adding or changing a dynamic form, or when touching existing `turbo_fetch` routes, actions, or `turbo-form`/`turbo-fetch` Stimulus wiring.
metadata:
  triggers: "dynamic form, dependent dropdown, cascading dropdown, conditional field, conditional section, dynamic options, update form on change, turbo_form, dynamic: true, dynamic_trigger, dynamic_action, expect_dynamic_form_request, turbo_fetch, turbo-fetch, turbo-form controller"
---

# Dynamic Forms

The [turbo_form](https://github.com/OutlawAndy/turbo_form) gem is RoleModel's mechanism for dynamic form interaction. Every new dynamic form uses it. Do not write a `turbo_fetch` route, controller action, `.turbo_stream` view, or Stimulus controller for a form that turbo_form can drive.

The gem's [README](https://github.com/OutlawAndy/turbo_form#readme) is the API documentation. Read it before writing or changing a dynamic form. This skill does not restate it.

## Setup

Check the `Gemfile` for `turbo_form`. If it is missing, add it and run `bin/rails generate turbo_form:install`, then draw the `:turbo_form` route concern on the resource:

```ruby
resources :products, concerns: :turbo_form
```

The engine defines the concern and the controller behavior. Do not define a `:turbo_form` or `:turbo_fetch` concern in `config/routes.rb`.

## Shape

```slim
= simple_form_for @product, dynamic: true do |f|
  = f.association :category, input_html: { dynamic_trigger: true }
  = f.association :subcategory, collection: @product.category&.subcategories || []
```

The trigger re-renders the page through its own `new` or `edit` action with the submitted values assigned, so `@product.category` is the category just picked and its subcategories fill the second select. The options, conventions, `dynamic_action:` for custom Turbo Stream responses, and `expect_dynamic_form_request` for system tests are all in the README.

## Existing `turbo_fetch` code

Older apps wire dynamic forms by hand: a `turbo_fetch` route concern, a `turbo_fetch` controller action, a `turbo_fetch.turbo_stream` view, a Stimulus controller registered as `turbo-form` or `turbo-fetch` (installed by `rolemodel_rails`, and unrelated to the turbo_form gem despite the name), and `expect_turbo_form_request` or `expect_turbo_fetch_request` in specs. That pattern is superseded. Do not extend it. When a change touches one of these forms, convert it to turbo_form and delete the route, action, view, and spec helper usage it no longer needs.
