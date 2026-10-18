---
name: turbo-modals
description: Open forms and content in a modal or side panel using RoleModel's Turbo Frame modal pattern, as installed by the rolemodel_rails `rolemodel:turbo:modals` generator. Use when adding a modal or panel, linking to an action that should open in one, rendering a form inside one, or debugging a modal that won't open, won't close after save, re-animates on validation errors, or renders the wrong layout.
metadata:
  triggers: "modal, panel, turbo frame modal, modal_link_to, panel_link_to, link_to_top, layout: 'modal', layout: 'panel', modal_header, modal_footer, panel_header, turbo:frame-missing, unprocessable_content, modal won't close, modal layout"
---

# Turbo Modals

A modal (or panel) is an ordinary controller action rendered with the `modal` (or `panel`) layout into the matching `turbo_frame_tag 'modal'` (or `'panel'`) that lives in the application layout. There is no modal-specific JavaScript to write.

Check the app has the pattern installed before using it: `app/views/layouts/modal.html.slim` and `app/helpers/turbo_frame_link_helper.rb` exist. Panels also need `app/views/layouts/panel.html.slim`. If they're missing, run `bin/rails g rolemodel:turbo:modals` (add `--panels` for panels).

## Opening one

```slim
/ link_to_top breaks out of the frame
= modal_link_to 'New Widget', new_widget_path
= panel_link_to 'Details', widget_path(widget)
= link_to_top 'Leave the modal', widgets_path
```

These are `link_to` with `data: { turbo_frame: 'modal' | 'panel' | '_top' }`.

## The controller rules

1. **Render with the layout explicitly:** `render layout: 'modal'`. Do that on the error path too.
2. **Validation errors respond with `status: :unprocessable_content` (422).** Turbo needs it to re-render the form, and the layout reads it to keep the modal open without re-animating.
3. **Success redirects.** The redirected page has no `modal` frame, so the installed `turbo:frame-missing` handler turns it into a full-page `replace` visit, which closes the modal and refreshes the page underneath.
4. **Never call the `layout` class method** in a controller or any of its ancestors. It overrides the Turbo-Rails layout mechanics the pattern depends on. For an alternate app layout, create a layout-only subclass of `ApplicationController` named after the layout (e.g. `FullscreenController`) and inherit from it.

```ruby
class WidgetsController < ApplicationController
  def new
    @widget = authorize Widget.new
    render layout: 'modal'
  end

  def create
    @widget = authorize Widget.new(widget_params)

    if @widget.save
      redirect_to @widget, notice: 'Successfully Created Widget'
    else
      render :new, status: :unprocessable_content, layout: 'modal'
    end
  end
end
```

## The view

The modal layout gives you `:modal_header` and `:modal_footer` slots (panels have `:panel_header`). The footer renders **outside** the `<form>`, so a submit button there must name the form with `form:`:

```slim
= content_for :modal_header do
  h2 Edit Widget

= content_for :modal_footer do
  = button_tag 'Save', class: 'btn btn--primary', form: dom_id(@widget, :edit)

= simple_form_for @widget do |f|
  = f.input :name
```

For a `new` template the form id is `dom_id(@widget)` (e.g. `new_widget`). Inside the form builder, use `f.submit form: f.id`. The layout already adds Cancel and close buttons.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Modal re-animates or closes on a validation error | The error path isn't returning 422 |
| Save does nothing / the form stays open | The success path renders instead of redirecting |
| Footer button doesn't submit | `form:` is missing or doesn't match the form's id |
| Page opens full-screen instead of in the modal | The link is missing `turbo_frame`, or the action didn't `render layout: 'modal'` |
| Wrong layout inside the frame | A `layout` class method somewhere in the controller's ancestry |

Background reading: [TurboFrame Modals – The Definitive Guide](https://medium.com/@outlawandy/turbo-frame-modals-869801e37591).
