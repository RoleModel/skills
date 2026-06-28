# Fixing Tests

Read this when converting existing Selenium test patterns to Playwright equivalents, or when a specific test is failing and you suspect a pattern mismatch.

---

## Timing Issues After Removing capybara-lockstep

The most common migration breakage. capybara-lockstep synchronized every action with in-flight requests. Without it, you need explicit waits. Symptoms: assertions that pass then immediately fail, or elements not found after navigation.

Fix: add `expect(page).to have_content(...)` or `expect(page).to have_selector(...)` immediately after any action that triggers async work.

## Duplicate `data-testid` Values

Playwright raises `Playwright::Error` when a selector matches multiple elements. Review all `data-testid` assignments — ensure they are unique per page, not just per template partial.

## Turbo Frame Navigation

Playwright may not wait for Turbo Frame responses automatically. If a frame-targeted link click doesn't update content:

1. Add `expect(page).to have_content(expected_content)` after the click
2. If the form/button must navigate the top-level frame, add `data: { turbo_frame: '_top' }` in the view

## `let` vs `let!` in JS Tests

Use `let!` (not `let`) for factory records that must exist when the browser renders the page.

```ruby
# Broken — Playwright renders the page before :active_record_callbacks fires,
# so the record doesn't exist yet
let(:user) { create(:user) }
it 'shows the user', :js do
  visit people_path
  expect(page).to have_content user.name  # user may not exist yet
end

# Fixed
let!(:user) { create(:user) }
```

## Flash Message Accumulation

When a test performs multiple sequential actions that each produce a flash message, the old flash may still be in the DOM when the test looks for the new one — or it may obscure the next button to click. Selenium was slow enough that flash auto-dismiss usually happened between actions. Add a helper to clear flash messages between sequential operations:

```ruby
def clear_flash_messages
  return unless supports_javascript?
  page.execute_script("document.querySelectorAll('.alert').forEach(el => el.remove());")
end
```

## Don't Assert Transient Loading States

Loading spinners and progress indicators may appear and disappear within a single Playwright frame. Don't assert their appearance — only assert the final state:

```ruby
# Fragile — may never catch the spinner
expect(page).to have_css('.loading-spinner')
expect(page).to have_no_css('.loading-spinner')

# Robust — just wait for the final state
expect(page).to have_content 'Results loaded'
```

## Assert Button Existence Before Clicking in Multi-Step Forms

In multi-step wizards or conditionally-rendered UIs, buttons may not exist in the DOM yet when Playwright tries to click. Always assert presence first:

```ruby
# Fragile
click_on 'Next question'

# Robust
expect(page).to have_button('Next question')
click_on 'Next question'
```

## New Window / Tab Operations Need Higher Wait Times

Opening a new browser tab in Playwright is inherently slower. Use explicit `wait:` overrides when asserting content in new windows:

```ruby
within_window(new_window) do
  expect(page).to have_content('Expected content', wait: 10)
end
```

## Confirmation Dialogs

If your app uses the '@rolemodel/turbo-confirm' package, triggering should be wrapped in a block that calls `accept_turbo_confirm` to click the confirmation button after the dialog appears.
This is necessary because Playwright does not automatically handle DOM-based modals like Selenium did.
Additionally, Playwright does not auto-accept browser dialogs.

**Turbo confirm modals** (DOM-based, not native browser dialogs):

```ruby
# Before
click_on 'Delete'

# After — wrap the triggering action in a block, then accept
accept_turbo_confirm do
  click_on 'Delete'
end
```

`accept_turbo_confirm` should yield the block, then click the "Yes, I'm sure" button (or equivalent):

```ruby
def accept_turbo_confirm(button_text = "Yes, I'm sure")
  yield if block_given?
  return unless supports_javascript?
  expect(page).to have_button(button_text)
  click_on button_text
end
```

**Native browser confirms** (`window.confirm`): use Capybara's built-in:

```ruby
accept_confirm { click_on 'Delete' }
dismiss_confirm { click_on 'Delete' }
```

## Explicit Waits After Navigation

`capybara-lockstep` synchronized Capybara with all in-flight XHR/Turbo requests automatically. Playwright's auto-waiting is DOM-driven but does not know about application-level request completion the same way.
Add an explicit content assertion after any action that triggers navigation or async rendering:

```ruby
# Before
visit reports_path
# ... immediately interact with page

# After
visit reports_path
expect(page).to have_content 'Reports'   # wait for page to fully render
# ... now safe to interact
```

Apply this pattern after:

- `visit` calls
- Form submissions — assert the flash message or resulting page content **before** checking the database
- Opening panels/modals — assert that panel content is visible before interacting with it
- Any `click_on` that triggers async rendering

```ruby
# Form submission: assert UI before database
click_on 'Save'
expect(page).to have_flash_notice('Saved successfully')  # first
expect(record.reload.name).to eq('New Name')             # then
```

## Fill-In and Keyboard Events

Playwright's `fill` programmatically sets values and dispatches `input` events — it does **not** simulate native keystrokes or fire `keyup`/`keydown` events.

**Fix the app code, not the tests.** If Stimulus controllers or JS handlers listen on `keyup`/`keydown`, change them to listen on `input` instead. This is the correct fix — `input` is the standard event for value changes:

```javascript
// Before — breaks with Playwright
data-action="keyup->password-complexity#validatePassword"

// After — works with both Playwright and real users
data-action="input->password-complexity#validatePassword"
```

## JS Debouncing and Throttling

Selenium simulates individual keystrokes with natural delays between them, which naturally spaces out debounced/throttled handlers. Playwright sets values instantly, so debounced handlers may fire only once (or not at all) before the test moves on.

**Best fix — reduce debounce in test environment:**

```javascript
// Read Rails env from a <meta> tag in the HTML head
const debounceWait = getRailsEnv() === 'test' ? 1 : 600
```

```slim
/ In your layout head (non-production only)
- unless Rails.env.production?
  meta name="RAILS_ENV" content=Rails.env
```

If you can't modify the app code, add explicit waits in the test after filling in debounced fields:

```ruby
fill_in 'Search', with: 'query'
expect(page).to have_content 'Search results'  # wait for debounce to fire
```

## Async Component Loading (`data-loaded` Pattern)

Components that load JS libraries asynchronously and swap a placeholder for a real element (e.g., Google Places, map widgets, rich editors) can cause Playwright to interact with the placeholder before the real component mounts.

**Add a `data-loaded` attribute to the component** that transitions from `false` to `true` when the library finishes initializing:

```jsx
// Placeholder
<div class="places-field" data-loaded="false">Loading...</div>

// After library loads
<div class="places-field" data-loaded="true">
  <input ... />
</div>
```

**Wait for it in tests:**

```ruby
expect(page).to have_selector('.places-field[data-loaded="true"]')
fill_in 'Address', with: '123 Main St'
```

## Select / Option Elements

Playwright handles `<select>` dropdowns differently from Selenium:

```ruby
# Before — Selenium: click the select, then click the option
find('select').click
find('option', text: 'January').click

# After — Playwright: use select_option directly on the option
find('option', text: 'January').select_option

# Or use Capybara's select helper (still works)
select 'January', from: 'Month'
```

For year inputs in custom date pickers, confirm with Enter after setting:

```ruby
find('input.cur-year').set('2025').send_keys(:enter)
```

## Element Visibility

Playwright's visibility model is stricter than Selenium's. Elements hidden via CSS `opacity`, `visibility`, or off-screen positioning that Selenium found may require `visible: false`:

```ruby
# If an assertion fails on a technically-present-but-not-visible element
expect(page).to have_link('Create shift', href: path, visible: false)
```

## Element Scoping (Ambiguity Resolution)

Playwright raises on ambiguous matches. Resolve in this order of preference:

1. **`within` block** — most explicit, best for form sections, panels, modals

   ```ruby
   within '.side-panel__body' do
     fill_in 'Name', with: 'value'
   end
   ```

2. **Specific attribute selector** — when `within` doesn't apply

   ```ruby
   find("filter-control[displayname='Roles']")
   ```

3. **`data-testid`** — ideal when elements don't have other unique attributes

   ```ruby
   find('[data-testid="person-search-results-polled"]')
   ```

4. **`click_button` / `click_link` / `click_text` over `click_on`** — use the specific method to avoid ambiguity.

5. **`match: :first`** — last resort only; prefer one of the above

## When to use `:js`

Tag with `:js` only when the test requires JavaScript (Stimulus controllers, Turbo frames, web components, downloads, etc.). Non-JS tests using `:rack_test` are faster and more reliable — don't add `:js` by default.

```ruby
# No JS needed — use rack_test (default)
it 'shows the index page' do
  visit people_path
  expect(page).to have_content 'People'
end

# JS needed — tag with :js
it 'filters results dynamically', :js do
  visit people_path
  select 'Active', from: 'Status'
  expect(page).to have_content 'Filtered results'
end
```

## Wait Patterns

Let Capybara's implicit wait handle most cases. Add explicit assertions only when:

- Waiting for async content to appear after a user action
- Waiting for a background request to complete before reading the DB
- A page or component hasn't fully rendered before the next interaction

```ruby
# Implicit wait — Capybara retries for up to default_max_wait_time
expect(page).to have_content 'Success'  # retries until found or timeout

# Custom polling — for conditions Capybara can't assert
def wait_until(timeout = 10)
  Timeout.timeout(timeout) { sleep 0.1 until yield }
end

wait_until { SomeModel.where(status: 'done').exists? }
```

## Drag and Drop (SortableJS / Complex DnD)

Capybara's `element.drag_to(target)` is unreliable under Playwright for libraries like SortableJS that depend on precise mouse movement sequences. Use Playwright's low-level mouse API instead:

```ruby
# PlaywrightHelper
def pw_drag_element(source_element, target_element)
  return source_element.drag_to(target_element) unless supports_javascript?

  source_element.native.scroll_into_view_if_needed
  from_x, from_y = element_center(source_element.native)
  to_x, to_y = element_center(target_element.native)

  click_and_drag(source_element, target_element)
end

private

def element_center(native_element)
  box = native_element.bounding_box
  # Target 55% down (not center) so SortableJS inserts *after* the target
  # when dragging downward across group boundaries
  [(box['x'] + box['width'] / 2), (box['y'] + box['height'] * 0.55)]
end

def click_and_drag(source, target)
  pw_page.mouse.move(from_x, from_y)
  pw_page.mouse.down
  pw_page.mouse.move(to_x, to_y, steps: 50)  # steps: smooth movement
  sleep 0.2  # let SortableJS finish processing before releasing
  pw_page.mouse.up
end
```

## Browser Timezone Override

```ruby
# Before — Selenium CDP
page.driver.browser.execute_cdp('Emulation.setTimezoneOverride', timezoneId: 'America/New_York')
# cleanup required after test

# After — browser_timezone helper method
browser_timezone('America/New_York')

# PlaywrightHelper
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

## HTTP Status Code Checks

```ruby
# Before — only worked with rack_test driver
visit path
expect(page).to have_http_status(200)

# After — use Playwright's request API (works with JS driver)
def response_status(path)
  host = Capybara.current_session.server.host
  port = Capybara.current_session.server.port
  page.driver.with_playwright_page { |pw| pw.request.get("http://#{host}:#{port}#{path}").status }
end

it 'serves the file', :js do
  expect(response_status(file_path)).to eq(200)
end
```

## Cookie Access

```ruby
# Before — rack session
page.driver.browser.rack_mock_session.cookie_jar['session_id']

# After — Playwright browser context
def get_cookie(name)
  return page.driver.browser.rack_mock_session.cookie_jar[name] unless supports_javascript?
  cookie = page.driver.with_playwright_page { |pw| pw.context.cookies.find { |c| c['name'] == name } }
  cookie&.dig('value')
end
```

## `data-testid` Selectors

Configure Capybara to recognize `data-testid` if it isn't already:

```ruby
Capybara.configure { |config| config.test_id = 'data-testid' }

# Usage in views
div data-testid=dom_id(record) do
  # ...
end

# Usage in tests
find("[data-testid='#{dom_id(record)}']")
# or with a helper:
find(data_test(record))
```

Make all `data-testid` values unique on the page — Playwright will raise if it finds multiple matches.

## File Downloads

If the app is testing file downloads, switch to Playwright's download event API instead of polling the filesystem.

**Old approach — polling the filesystem:**

```ruby
DownloadHelper.clear_downloads
click_on 'Export'
DownloadHelper.wait_for_download
expect(DownloadHelper.downloads).to include('report.csv')
```

**New approach — Playwright's download event API:**

```ruby
expect_download('report.csv') do
  click_on 'Export'
end
```

Implementation using `playwright_page.expect_download`:

```ruby
DOWNLOAD_PATH = Rails.root.join("tmp/downloads/test#{ENV.fetch('TEST_ENV_NUMBER', '')}").to_s

def expect_download(filename, wait: nil, &block)
  file_path = "#{DOWNLOAD_PATH}/#{filename}"
  FileUtils.mkdir_p(DOWNLOAD_PATH)
  timeout = wait ? wait * 1000 : nil

  page.driver.with_playwright_page do |playwright_page|
    download = playwright_page.expect_download(timeout:, &block)
    download.save_as(File.join(DOWNLOAD_PATH, download.suggested_filename))
  end

  expect(File).to exist(file_path)
  FileUtils.rm_f(file_path)
end
```

Key details:

- Include `TEST_ENV_NUMBER` in the download path for parallel test isolation
- Pass `downloadsPath:` to the driver options so Playwright knows where to save
- Inspect file content by reading the path before cleanup:

  ```ruby
  page.driver.with_playwright_page do |playwright_page|
    download = playwright_page.expect_download(&block)
    download.save_as(path)
  end
  File.read(path)
  ```
