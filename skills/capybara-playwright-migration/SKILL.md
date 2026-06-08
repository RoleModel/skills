---
name: capybara-playwright-migration
description: >
  Use this skill when migrating existing Selenium-based system tests to capybara-playwright-driver,
  when writing new system tests that use Playwright, or when debugging Playwright test behavior
  in a Capybara/RSpec environment. Triggers on: "migrate to playwright", "convert selenium tests",
  "playwright driver", "system test with playwright", or any debugging of JS-driven test failures
  after a Playwright migration.
---

# Capybara → Playwright Migration & Authoring Guide

You are helping migrate Selenium-based Capybara tests to `capybara-playwright-driver`, or writing new Playwright-backed system tests. Follow every section in order for a migration; for new tests jump to "Writing New Tests".

---

## 1. Infrastructure Changes

### Gems

```ruby
# Gemfile — add
gem 'capybara-playwright-driver', '~> 0.5'
gem 'playwright-ruby-client'       # often already present for PDF generation

# Gemfile — remove
gem 'selenium-webdriver'
gem 'capybara-lockstep'            # if present
```

Run `bundle install` after updating.

### NPM

```bash
yarn add playwright
yarn playwright install chromium   # or: npx playwright install chromium
```

Add to `bin/setup` and CI setup steps. In Docker test stages:

```dockerfile
RUN yarn run playwright install chromium
```

### Driver Registration (`spec/support/capybara_drivers.rb`)

Replace Selenium driver config with:

```ruby
BROWSER_WINDOW_SIZE = [1400, 1400].freeze

BROWSER_OPTIONS = [
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--force-prefers-reduced-motion',
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  '--no-sandbox',
  '--disable-features=AutofillServerCommunication',
].freeze

def create_driver(app, options = {})
  default_options = {
    args: BROWSER_OPTIONS,
    browser_type: :chromium,
    viewport: { width: BROWSER_WINDOW_SIZE[0], height: BROWSER_WINDOW_SIZE[1] },
    downloadsPath: DownloadHelper::DOWNLOAD_PATH,
    headless: true,
    reducedMotion: 'reduce',
    timeout: ENV.fetch('CAPYBARA_TIMEOUT', 20).to_i,
    default_timeout: ENV.fetch('CAPYBARA_TIMEOUT', 20).to_i,
    default_navigation_timeout: ENV.fetch('CAPYBARA_NAV_TIMEOUT', ENV.fetch('CAPYBARA_TIMEOUT', 20)).to_i,
  }
  Capybara::Playwright::Driver.new(app, **default_options.merge(options))
end

Capybara.register_driver :playwright_headless do |app|
  create_driver(app)
end

Capybara.register_driver :chrome do |app|
  create_driver(app, headless: false)
end

Capybara.register_driver :firefox do |app|
  create_driver(app, browser_type: :firefox)
end

Capybara.threadsafe = true   # required for parallel test isolation
Capybara.default_max_wait_time = ENV.fetch('CAPYBARA_TIMEOUT', 20).to_i

RSpec.configure do |config|
  config.before(:each, type: :system) { driven_by :rack_test }
  config.before(:each, :js,     type: :system) { driven_by :playwright_headless }
  config.before(:each, :chrome, type: :system) { driven_by :chrome }
  config.before(:each, :firefox, type: :system) { driven_by :firefox }

  # CI: force all system tests through the JS driver
  if ENV['CAPYBARA_DRIVER'].present?
    config.define_derived_metadata { |m| m[ENV['CAPYBARA_DRIVER'].to_sym] = true }
  end
end
```

IMPORTANT: Do NOT use Playwright's `slowMo` option. It artificially delays
every browser action and masks race conditions. It may make tests pass
initially, but you'll pay for it later with flaky tests. Fix timing issues
properly with explicit waits instead.

**Separate navigation timeout from element timeout.** Full page navigations inherently take longer than waiting for an element to appear. Use a higher `default_navigation_timeout` (e.g., 5s) than the general element `timeout` (e.g., 3s) in CI:

```yaml
# CI env vars
CAPYBARA_TIMEOUT: 3
CAPYBARA_NAV_TIMEOUT: 5
```

### Remove capybara-lockstep

- Remove `gem 'capybara-lockstep'` from Gemfile
- Remove `= capybara_lockstep if defined?(Capybara::Lockstep)` from your HTML layout head
- Remove any `after(:each)` hooks that call `Capybara::Lockstep.synchronize`
- Remove any helpers that called `CapybaraLockstep.startWork` / `CapybaraLockstep.stopWork`

Playwright's built-in auto-waiting replaces lockstep synchronization.

---

## 2. Accessing the Playwright Page Object

When you need Playwright-native capabilities not exposed through Capybara, access the underlying page:

```ruby
def pw_page
  page.driver.with_playwright_page do |playwright_page|
    return playwright_page
  end
end
```

Use `pw_page` sparingly — prefer Capybara's API when it works. Use it for: screenshots, timezone injection, cookie inspection, HTTP status checks, drag-and-drop mouse events, and download interception.

---

## 3. Test Pattern Transformations

### 3.1 Confirmation Dialogs

Playwright does not auto-accept browser dialogs. You must explicitly handle them.

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

### 3.2 Explicit Waits After Navigation

`capybara-lockstep` synchronized Capybara with all in-flight XHR/Turbo requests automatically. Playwright's auto-waiting is DOM-driven but does not know about application-level request completion the same way. Add an explicit content assertion after any action that triggers navigation or async rendering:

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

### 3.3 File Downloads

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

### 3.4 Fill-In and Keyboard Events

Playwright's `fill` programmatically sets values and dispatches `input` events — it does **not** simulate native keystrokes or fire `keyup`/`keydown` events.

**Fix the app code, not the tests.** If Stimulus controllers or JS handlers listen on `keyup`/`keydown`, change them to listen on `input` instead. This is the correct fix — `input` is the standard event for value changes:

```javascript
// Before — breaks with Playwright
data-action="keyup->password-complexity#validatePassword"

// After — works with both Playwright and real users
data-action="input->password-complexity#validatePassword"
```

Only as a temporary workaround, you can dispatch events manually in tests:
```ruby
fill_in 'Search', with: 'query'
page.driver.with_playwright_page { |pw| pw.dispatch_event(':focus', 'keyup') }
```

But prefer fixing the source code to use `input` events.

### 3.5 JS Debouncing and Throttling

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

### 3.6 Async Component Loading (`data-loaded` Pattern)

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

### 3.7 Select / Option Elements

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

### 3.8 Text-Based Clicking

`click_on` uses Capybara's element-type heuristics. Playwright may be stricter about clicking non-interactive elements (spans, divs with text). For reliable text-based clicking:

```ruby
def click_text(text)
  return click_on(text) unless supports_javascript?
  page.driver.with_playwright_page { |pw| pw.get_by_text(text).click }
end
```

### 3.9 Drag and Drop (SortableJS / Complex DnD)

Capybara's `element.drag_to(target)` is unreliable under Playwright for libraries like SortableJS that depend on precise mouse movement sequences. Use Playwright's low-level mouse API instead:

```ruby
def pw_drag_element(source_element, target_element)
  return source_element.drag_to(target_element) unless supports_javascript?

  source_element.native.scroll_into_view_if_needed
  from_x, from_y = element_center(source_element.native)
  to_x, to_y = element_center(target_element.native)

  pw_page.mouse.move(from_x, from_y)
  pw_page.mouse.down
  pw_page.mouse.move(to_x, to_y, steps: 50)  # steps: smooth movement
  sleep 0.2  # let SortableJS finish processing before releasing
  pw_page.mouse.up
end

private

def element_center(native_element)
  box = native_element.bounding_box
  # Target 55% down (not center) so SortableJS inserts *after* the target
  # when dragging downward across group boundaries
  [(box['x'] + box['width'] / 2), (box['y'] + box['height'] * 0.55)]
end
```

### 3.10 Browser Timezone Override

```ruby
# Before — Selenium CDP
page.driver.browser.execute_cdp('Emulation.setTimezoneOverride', timezoneId: 'America/New_York')
# cleanup required after test

# After — Playwright init script (auto-clears between tests)
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

### 3.11 HTTP Status Code Checks

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

### 3.12 Cookie Access

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

### 3.13 Element Visibility

Playwright's visibility model is stricter than Selenium's. Elements hidden via CSS `opacity`, `visibility`, or off-screen positioning that Selenium found may require `visible: false`:

```ruby
# If an assertion fails on a technically-present-but-not-visible element
expect(page).to have_link('Create shift', href: path, visible: false)
```

### 3.14 Element Scoping (Ambiguity Resolution)

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
4. **`click_button` / `click_link` over `click_on`** — when both links and buttons share text (e.g., "Update"), use the specific method to avoid ambiguity
5. **`match: :first`** — last resort only; prefer one of the above

### 3.15 Screenshots

```ruby
def screenshot(filename = nil, directory: 'tmp/screenshots', **options)
  timestamp = Time.current.strftime('%Y-%m-%d_%H-%M-%S')
  filename ||= "#{RSpec.current_example.full_description.tr(' ', '_')}_#{timestamp}"
  FileUtils.mkdir_p(directory)

  page.driver.with_playwright_page do |pw|
    # For full-page screenshots, make body scrollable
    pw.locator('body').evaluate("el => el.style.overflow = 'visible'") if options[:fullPage]
    pw.screenshot(path: "#{directory}/#{filename}.png", animations: 'disabled', **options)
  end
end
```

---

## 4. Writing New Playwright Tests

### When to use `:js`

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

### `data-testid` Selectors

Configure Capybara to recognize `data-testid`:
```ruby
Capybara.configure { |config| config.test_id = 'data-testid' }
```

Add `data-testid` attributes to elements that need stable test targeting:
```ruby
# In views
div data-testid=dom_id(record) do
  # ...
end

# In tests
find("[data-testid='#{dom_id(record)}']")
# or with a helper:
find(data_test(record))
```

Make all `data-testid` values unique on the page — Playwright will raise if it finds multiple matches.

### Wait Patterns

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

### Browser Error Logging

Enable during debugging to surface JS console errors:

```ruby
def enable_browser_error_logging
  page.driver.with_playwright_page do |pw|
    pw.on('console', lambda { |msg|
      puts "\e[31mBROWSER ERROR: #{msg.text}\e[0m" if msg.type == 'error'
    })
  end
end
```

Or enable via env var in the driver's `before(:each, :js)` hook:
```ruby
enable_browser_error_logging if ENV['LOG_BROWSER_ERRORS'] == 'true'
```

### Parallel Test Isolation

- Scope download paths with `TEST_ENV_NUMBER`: `tmp/downloads/test#{ENV.fetch('TEST_ENV_NUMBER', '')}`
- Set `Capybara.threadsafe = true`
- Use `let!` (not `let`) for factory records that must exist when the browser renders the page

---

## 5. Common Pitfalls

### Timing Issues After Removing capybara-lockstep

The most common migration breakage. capybara-lockstep synchronized every action with in-flight requests. Without it, you need explicit waits. Symptoms: assertions that pass then immediately fail, or elements not found after navigation.

Fix: add `expect(page).to have_content(...)` or `expect(page).to have_selector(...)` immediately after any action that triggers async work.

### Duplicate `data-testid` Values

Playwright raises `Playwright::Error` when a selector matches multiple elements. Review all `data-testid` assignments — ensure they are unique per page, not just per template partial.

### Turbo Frame Navigation

Playwright may not wait for Turbo Frame responses automatically. If a frame-targeted link click doesn't update content:
1. Add `expect(page).to have_content(expected_content)` after the click
2. If the form/button must navigate the top-level frame, add `data: { turbo_frame: '_top' }` in the view

### `let` vs `let!` in JS Tests

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

### Form ID / Button `form:` Attribute Mismatch

If a submit button outside a `<form>` tag uses `form: dom_id(record)` but the form element has a different id, Playwright will not submit the form. Ensure the `id` on the `<form>` exactly matches the `form:` attribute on the button.

### Flash Message Accumulation

When a test performs multiple sequential actions that each produce a flash message, the old flash may still be in the DOM when the test looks for the new one — or it may obscure the next button to click. Selenium was slow enough that flash auto-dismiss usually happened between actions. Add a helper to clear flash messages between sequential operations:

```ruby
def clear_flash_messages
  return unless supports_javascript?
  page.execute_script("document.querySelectorAll('.alert').forEach(el => el.remove());")
end
```

### Don't Assert Transient Loading States

Loading spinners and progress indicators may appear and disappear within a single Playwright frame. Don't assert their appearance — only assert the final state:

```ruby
# Fragile — may never catch the spinner
expect(page).to have_css('.loading-spinner')
expect(page).to have_no_css('.loading-spinner')

# Robust — just wait for the final state
expect(page).to have_content 'Results loaded'
```

### Assert Button Existence Before Clicking in Multi-Step Forms

In multi-step wizards or conditionally-rendered UIs, buttons may not exist in the DOM yet when Playwright tries to click. Always assert presence first:

```ruby
# Fragile
click_on 'Next question'

# Robust
expect(page).to have_button('Next question')
click_on 'Next question'
```

### New Window / Tab Operations Need Higher Wait Times

Opening a new browser tab in Playwright is inherently slower. Use explicit `wait:` overrides when asserting content in new windows:

```ruby
within_window(new_window) do
  expect(page).to have_content('Expected content', wait: 10)
end
```

### Ensure `:js` Tag on All JS-Dependent Tests

Every test that clicks buttons relying on Turbo, Stimulus, or any JS behavior must be tagged `:js`. Without it, Capybara uses `rack_test` which doesn't execute JavaScript. Don't rely on inherited metadata from parent `describe` blocks — be explicit.

---

## 6. CI Configuration

```yaml
# .github/workflows/ci.yml — system tests job

- name: Setup Node
  uses: actions/setup-node@v4

- name: Install JS dependencies
  run: yarn install

- name: Install Playwright browsers
  run: yarn playwright install chromium

- name: Run system tests
  env:
    CAPYBARA_DRIVER: js   # forces all system tests through Playwright
  run: bundle exec rspec spec/system
```

Remove:
- `WD_CHROME_PATH` environment variable
- `selenium-webdriver` setup steps
- Any step that used `browser-actions/setup-chrome` for Selenium
