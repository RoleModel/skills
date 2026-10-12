# Fixing Tests

Documented fixes for system tests running on `capybara-playwright-driver`. Match the failure to a row in the index, then apply that section's fix. Some fixes rely on a helper method. Each one's definition sits in its section under **Helper**, which names the file it belongs in (`spec/support/playwright_helper.rb` unless stated otherwise); add it only if it isn't already defined there. The base module (`supports_javascript?`, `pw_page`, `click_text`, `screenshot`) is in `initial-migration-steps.md`, Step 6.

## Symptom Index

| Symptom | Section |
| --- | --- |
| `Capybara::ElementNotFound` / `expected to find text` right after `visit`, a click, or a form submit | [Missing Waits](#missing-waits) |
| Database assertion fails right after a form submit, but the UI eventually updates | [Missing Waits](#missing-waits) |
| Content inside a `turbo_frame` never updates after a click | [Turbo Frame Navigation](#turbo-frame-navigation) |
| Record created in a `let` is missing from the rendered page | [Lazy `let` Records](#lazy-let-records) |
| Old flash still matched, or click fails with `... intercepts pointer events` from an alert | [Flash Message Accumulation](#flash-message-accumulation) |
| Assertion on a spinner/loading indicator flakes | [Transient Loading States](#transient-loading-states) |
| `Unable to find button` in a multi-step form or wizard | [Buttons in Multi-Step Forms](#buttons-in-multi-step-forms) |
| Timeout asserting content inside `within_window` | [New Windows and Tabs](#new-windows-and-tabs) |
| Delete/confirm action does nothing, or `Capybara::ModalNotFound` | [Confirmation Dialogs](#confirmation-dialogs) |
| JS handler doesn't react to `fill_in` (validation, live preview, counters) | [Keyboard Events](#keyboard-events) |
| Search/autocomplete results never appear after `fill_in` | [Debouncing and Throttling](#debouncing-and-throttling) |
| `fill_in` hits a placeholder before a widget (maps, places, rich editor) loads | [Async Component Loading](#async-component-loading) |
| Clicking an `<option>` doesn't change the select; date-picker year doesn't stick | [Select and Option Elements](#select-and-option-elements) |
| Element exists in the DOM but isn't found as visible | [Element Visibility](#element-visibility) |
| `Capybara::Ambiguous` or `strict mode violation ... resolved to N elements` | [Ambiguous Matches](#ambiguous-matches) |
| `drag_to` does nothing, or items land in the wrong order | [Drag and Drop](#drag-and-drop) |
| `undefined method 'execute_cdp'` | [Browser Timezone Override](#browser-timezone-override) |
| `have_http_status` / `status_code` not supported by driver | [HTTP Status Codes](#http-status-codes) |
| `undefined method 'rack_mock_session'` | [Cookies](#cookies) |
| Download never appears; filesystem polling helper times out | [File Downloads](#file-downloads) |

---

## Missing Waits

The most common breakage. `capybara-lockstep` synchronized every action with in-flight requests; without it, the test can act before the page catches up. Assert on visible content right after any action that triggers navigation or async rendering — Capybara retries the assertion until it passes or times out.

```ruby
# Before
visit reports_path
click_on 'New report'

# After
visit reports_path
expect(page).to have_content 'Reports'
click_on 'New report'
```

Apply after `visit`, form submits, opening panels/modals, and any click that triggers async rendering. After a form submit, assert the UI **before** checking the database, so the request has finished:

```ruby
click_on 'Save'
expect(page).to have_content 'Saved successfully'
expect(record.reload.name).to eq('New Name')
```

For a condition Capybara can't assert on (e.g. a background job's DB write), use `wait_until`:

```ruby
wait_until { SomeModel.where(status: 'done').exists? }
```

**Helper** — add to `PlaywrightHelper` if it isn't already there:

```ruby
# For conditions Capybara can't assert on, such as database state.
def wait_until(timeout = Capybara.default_max_wait_time)
  Timeout.timeout(timeout) { sleep 0.1 until yield }
end
```

## Turbo Frame Navigation

If a frame-targeted click doesn't update content:

1. Add `expect(page).to have_content(expected_content)` after the click.
2. If the link/form must navigate the whole page, add `data: { turbo_frame: '_top' }` to it in the view.

## Lazy `let` Records

`let` is lazy — the record isn't created until the test first references it. When that first reference comes after `visit`, the page rendered without the record. Use `let!` so it exists before the page loads.

```ruby
# Broken — user is created at the expectation, after the page already rendered
let(:user) { create(:user) }
it 'shows the user', :js do
  visit people_path
  expect(page).to have_content user.name
end

# Fixed
let!(:user) { create(:user) }
```

This isn't driver-specific; a test with this bug was passing by accident before (e.g. a `before` block happened to reference the record).

## Flash Message Accumulation

Selenium was slow enough that flashes auto-dismissed between actions. Under Playwright an old flash can still be on the page — matched instead of the new one, or covering the next button. Clear flashes between sequential actions:

```ruby
click_on 'Approve'
expect(page).to have_content 'Approved'
clear_flash_messages
click_on 'Publish'
```

Pass a selector if the app doesn't use `.alert`: `clear_flash_messages('.flash')`.

**Helper** — add to `PlaywrightHelper` if it isn't already there:

```ruby
def clear_flash_messages(selector = '.alert')
  return unless supports_javascript?

  page.execute_script("document.querySelectorAll('#{selector}').forEach(el => el.remove())")
end
```

## Transient Loading States

Spinners can appear and disappear between Playwright's checks. Don't assert them — assert the final state.

```ruby
# Fragile
expect(page).to have_css('.loading-spinner')

# Robust
expect(page).to have_content 'Results loaded'
```

## Buttons in Multi-Step Forms

In wizards or conditionally rendered UIs, assert the button exists before clicking it:

```ruby
expect(page).to have_button('Next question')
click_on 'Next question'
```

## New Windows and Tabs

Opening a tab is slower. This is one of the few places a longer `wait:` is correct:

```ruby
within_window(new_window) do
  expect(page).to have_content('Expected content', wait: 10)
end
```

## Confirmation Dialogs

Playwright does not auto-accept dialogs.

**`@rolemodel/turbo-confirm` (DOM modal):** wrap the trigger in `accept_turbo_confirm`, which clicks the confirm button once the modal appears. Pass the button text if it isn't `"Yes, I'm sure"`.

```ruby
accept_turbo_confirm do
  click_on 'Delete'
end
```

**Helper** — add to `PlaywrightHelper` if it isn't already there:

```ruby
# @rolemodel/turbo-confirm renders a DOM modal; click its confirm button after the trigger.
def accept_turbo_confirm(button_text = "Yes, I'm sure")
  yield if block_given?
  return unless supports_javascript?

  expect(page).to have_button(button_text)
  click_on button_text
end
```

**Native `window.confirm`:** use Capybara's built-ins.

```ruby
accept_confirm { click_on 'Delete' }
dismiss_confirm { click_on 'Delete' }
```

## Keyboard Events

Playwright's `fill` sets the value and dispatches `input` — it does not fire `keyup`/`keydown`. **Fix the app, not the test:** `input` is the correct event for value changes and works for real users too.

```javascript
// Before
data-action="keyup->password-complexity#validatePassword"

// After
data-action="input->password-complexity#validatePassword"
```

## Debouncing and Throttling

Selenium typed keystroke by keystroke, which spaced out debounced handlers. Playwright sets values instantly, so the test may move on before the handler fires.

**Preferred — shorten the debounce in test:**

```slim
/ Layout head (non-production only)
- unless Rails.env.production?
  meta name="RAILS_ENV" content=Rails.env
```

```javascript
const railsEnv = document.querySelector('meta[name="RAILS_ENV"]')?.content
const debounceWait = railsEnv === 'test' ? 1 : 600
```

**If app code can't change** — wait on the result:

```ruby
fill_in 'Search', with: 'query'
expect(page).to have_content 'Search results'
```

## Async Component Loading

Widgets that load a library and swap a placeholder for a real element can be interacted with too early. Give the component a `data-loaded` attribute that flips to `true` once initialized, and wait on it:

```html
<div class="places-field" data-loaded="false">Loading...</div>
<!-- after init -->
<div class="places-field" data-loaded="true"><input ...></div>
```

```ruby
expect(page).to have_selector('.places-field[data-loaded="true"]')
fill_in 'Address', with: '123 Main St'
```

## Select and Option Elements

```ruby
# Before — Selenium
find('select').click
find('option', text: 'January').click

# After
select 'January', from: 'Month'
# or
find('option', text: 'January').select_option
```

For year inputs in custom date pickers, confirm with Enter:

```ruby
find('input.cur-year').set('2025').send_keys(:enter)
```

## Element Visibility

Playwright's visibility rules are stricter. If the element is intentionally present but not visible (opacity, off-screen), say so:

```ruby
expect(page).to have_link('Create shift', href: path, visible: false)
```

## Ambiguous Matches

Resolve in this order of preference:

1. **`within`** — scope to a form section, panel, or modal.

   ```ruby
   within '.side-panel__body' do
     fill_in 'Name', with: 'value'
   end
   ```

2. **Specific attribute selector** — `find("filter-control[displayname='Roles']")`
3. **`data-testid`** — when nothing else is unique. Values must be unique per **page**, not per partial; a partial rendered in a loop needs a record-specific value:

   ```slim
   div data-testid=dom_id(record)
   ```

   ```ruby
   find("[data-testid='#{dom_id(record)}']")
   ```

   To use `data-testid` with `click_on`/`fill_in` locators, set `Capybara.test_id = 'data-testid'` (a shared support change — report it rather than making it from a sub-agent).
4. **Specific click methods** — `click_button` / `click_link` / `click_text` instead of `click_on`.
5. **`match: :first`** — last resort.

## Drag and Drop

`element.drag_to(target)` is unreliable for SortableJS and similar libraries that need a realistic mouse sequence. Use `pw_drag_element`, which moves the mouse in steps and targets just below the target's center so drops land *after* it:

```ruby
pw_drag_element(find('.task', text: 'First'), find('.task', text: 'Third'))
expect(page).to have_css('.task:last-child', text: 'First')
```

**Helper** — add to `PlaywrightHelper` if it isn't already there:

```ruby
# SortableJS and similar libraries need a real mouse-move sequence; drag_to is unreliable.
def pw_drag_element(source, target)
  return source.drag_to(target) unless supports_javascript?

  source.native.scroll_into_view_if_needed
  from_x, from_y = pw_drag_point(source.native)
  to_x, to_y = pw_drag_point(target.native)

  pw_page.mouse.move(from_x, from_y)
  pw_page.mouse.down
  pw_page.mouse.move(to_x, to_y, steps: 50)
  sleep 0.2 # let SortableJS finish processing before releasing
  pw_page.mouse.up
end

# 55% down rather than center, so SortableJS inserts *after* the target when dragging downward.
def pw_drag_point(native_element)
  box = native_element.bounding_box
  [box['x'] + (box['width'] / 2), box['y'] + (box['height'] * 0.55)]
end
```

## Browser Timezone Override

```ruby
# Before — Selenium CDP
page.driver.browser.execute_cdp('Emulation.setTimezoneOverride', timezoneId: 'America/New_York')
# cleanup required after test

# After — browser_timezone helper method
browser_timezone('America/New_York')
```

**Helper** — add to `spec/support/capybara_drivers.rb` if it isn't already there:

```ruby
def browser_timezone(timezone)
  return unless supports_javascript?
  page.driver.with_playwright_page do |pw|
    pw.add_init_script(script: <<~JS)
      Object.defineProperty(Intl, 'DateTimeFormat', {
        value: function() {
          return {
            resolvedOptions: function() { return { timeZone: '#{timezone}' }; }
          };
        }
      });
    JS
  end
end
```

No cleanup needed — Playwright creates a fresh browser context per test.

## HTTP Status Codes

`have_http_status` only works under `rack_test`. Under Playwright, request the path directly:

```ruby
# Before
visit path
expect(page).to have_http_status(200)

# After
expect(response_status(path)).to eq(200)
```

**Helper** — add to `PlaywrightHelper` if it isn't already there:

```ruby
def response_status(path)
  server = Capybara.current_session.server
  pw_page.request.get("http://#{server.host}:#{server.port}#{path}").status
end
```

## Cookies

```ruby
# Before
page.driver.browser.rack_mock_session.cookie_jar['session_id']

# After — works under both drivers
get_cookie('session_id')
```

**Helper** — add to `PlaywrightHelper` if it isn't already there:

```ruby
def get_cookie(name)
  return page.driver.browser.rack_mock_session.cookie_jar[name] unless supports_javascript?

  pw_page.context.cookies.find { |cookie| cookie['name'] == name }&.dig('value')
end
```

## File Downloads

Replace filesystem polling with Playwright's download event. `expect_download` asserts the filename and returns the file's contents, then removes it.

```ruby
# Before
DownloadHelper.clear_downloads
click_on 'Export'
DownloadHelper.wait_for_download
expect(DownloadHelper.downloads).to include('report.csv')

# After
csv = expect_download('report.csv') { click_on 'Export' }
expect(csv).to include('Total')
```

Slow exports may pass `wait:` in seconds: `expect_download('report.csv', wait: 30) { ... }`.

**Helper** — add to `PlaywrightHelper` if it isn't already there:

```ruby
# Runs the block, waits for the download it triggers, asserts its filename,
# and returns the file's contents. The saved file is removed afterward.
# DOWNLOAD_PATH is defined in spec/support/capybara_drivers.rb.
def expect_download(filename, wait: nil, &block)
  FileUtils.mkdir_p(DOWNLOAD_PATH)
  download = pw_page.expect_download(timeout: wait && wait * 1000, &block)
  path = File.join(DOWNLOAD_PATH, download.suggested_filename)
  download.save_as(path)

  expect(download.suggested_filename).to eq(filename)
  File.read(path)
ensure
  FileUtils.rm_f(path) if path
end
```

---

## Writing New Tests

Not a fix — guidance for authoring new system specs.

Tag with `:js` only when the test needs JavaScript (Stimulus, Turbo Frames, web components, downloads). Untagged tests run on `rack_test`, which is faster and more reliable.

```ruby
it 'shows the index page' do
  visit people_path
  expect(page).to have_content 'People'
end

it 'filters results dynamically', :js do
  visit people_path
  select 'Active', from: 'Status'
  expect(page).to have_content 'Filtered results'
end
```

Write new JS tests with the patterns above from the start: assert after every navigation, use `let!` for records the page must show, and reach for `PlaywrightHelper` instead of driver internals.
