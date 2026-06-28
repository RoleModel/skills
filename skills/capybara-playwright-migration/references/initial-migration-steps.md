# Initial Migration Steps

Follow these steps in order when migrating a project from Selenium to Playwright. Complete all steps before moving on to refactoring individual tests.

---

## Step 1: Update Gems

```ruby
# Gemfile — add
gem 'capybara-playwright-driver', '~> 0.5'
gem 'playwright-ruby-client'       # often already present for PDF generation

# Gemfile — remove
gem 'selenium-webdriver'
gem 'capybara-lockstep'            # if present
```

Run `bundle install` after updating.

## Step 2: Install Playwright via NPM

```bash
yarn add playwright
yarn playwright install chromium   # or: npx playwright install chromium
```

Add to `bin/setup` and CI setup steps. In Docker test stages:

```dockerfile
RUN yarn run playwright install chromium
```

## Step 3: Register the Playwright Driver (`spec/support/capybara_drivers.rb`)

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

def enable_browser_error_logging
  page.driver.with_playwright_page do |pw|
    pw.on('console', lambda { |msg|
      puts "\e[31mBROWSER ERROR: #{msg.text}\e[0m" if msg.type == 'error'
    })
  end
end

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
```

## Step 4: Remove capybara-lockstep

- Remove `gem 'capybara-lockstep'` from Gemfile
- Remove `= capybara_lockstep if defined?(Capybara::Lockstep)` from your HTML layout head
- Remove any `after(:each)` hooks that call `Capybara::Lockstep.synchronize`
- Remove any helpers that called `CapybaraLockstep.startWork` / `CapybaraLockstep.stopWork`

Playwright's built-in auto-waiting replaces lockstep synchronization.

## Step 5: Update CI Configuration

Update the system tests job to use the shared flow with Playwright and set env variables for capybara timeouts.

```yaml
# .github/workflows/ci.yml — system tests job
env:
  CAPYBARA_TIMEOUT: 3
  CAPYBARA_NAV_TIMEOUT: 5

# Existing code...

- name: Run shared flow
  uses: RoleModel/actions/system-tests@v3
  input:
    web-driver: playwright
```

Remove:

- `WD_CHROME_PATH` environment variable
- `selenium-webdriver` setup steps
- Any step that used `browser-actions/setup-chrome` for Selenium

## Step 6: Create PlaywrightHelper (`spec/support/playwright_helper.rb`)

Create a helper module for Playwright-specific utilities that don't fit in Capybara's API. Include it in RSpec configuration for system tests.

```ruby
# frozen_string_literal: true

module PlaywrightHelper
  include CapybaraHelper

  def pw_page
    page.driver.with_playwright_page do |page|
      return page
    end
  end

  def screenshot(filename = nil, directory: 'tmp/screenshots', print_message: true, **options)
    timestamp = Time.current.strftime('%Y-%m-%d_%H-%M-%S')
    description = RSpec.current_example.full_description.tr(' ', '_')
    filename ||= "#{description}_#{timestamp}"

    FileUtils.mkdir_p(directory)

    if options[:fullPage] && pw_page.locator('body').present?
      pw_page.locator('body').evaluate("element => element.style.overflow = 'visible'")
    end

    pw_page.screenshot(path: "#{directory}/#{filename}.png", animations: 'disabled', **options)

    puts "Screenshot saved to \e[4;96m#{directory}/#{filename}.png\e[0m" if print_message # rubocop:disable RSpec/Output
  end

  def click_text(text)
    return click_on(text) unless supports_javascript?

    pw_page.get_by_text(text).click
  end
end
```
