# frozen_string_literal: true

require 'json'
require 'fileutils'

module UiQa
  OUT_DIR = ENV.fetch('UI_QA_OUT', Rails.root.join('tmp/ui-qa/scratch').to_s)
  FROZEN_AT = Time.zone.parse(ENV.fetch('UI_QA_TIME', '2026-03-17 10:00:00'))
  VIEWPORTS = {
    desktop: { width: 1400, height: 900 },
    mobile: { width: 375, height: 667 }
  }.freeze
  STUBBED_FONTS = 'https://fonts.googleapis.com/'
  TURBO_BUSY_JS = '() => document.querySelector("[aria-busy=true], .turbo-progress-bar") !== null'
  LAYOUT_CHECKS_JS = File.read(File.expand_path('layout_checks.js', __dir__))
  PAGE_FACTS_JS = <<~JS
    () => {
      const focused = document.activeElement;
      const focusY = focused && focused !== document.body ? focused.getBoundingClientRect().top + window.scrollY : null;
      return { scroll_width: document.documentElement.scrollWidth, viewport_width: window.innerWidth, focus_y: focusY };
    }
  JS
  SETTLED_JS = <<~JS
    () => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))
  JS
  SETTLE_CSS = <<~CSS
    *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
  CSS

  def ui_qa_page
    page.driver.with_playwright_page { |playwright_page| return playwright_page }
  end

  def capture(name, mobile: true, reload: false, mask: [], hide: [])
    UiQa.events << { 'type' => 'capture', 'name' => name }
    viewports = mobile ? VIEWPORTS : VIEWPORTS.slice(:desktop)
    viewports.each do |viewport, size|
      resize_to(size, reload: reload && viewport != :desktop)
      write_capture("#{name}@#{viewport}", mask:, hide:)
    end
  ensure
    resize_to(VIEWPORTS[:desktop], reload:) if mobile
  end

  def self.events
    @events ||= []
  end

  def self.reset_sequences
    connection = ActiveRecord::Base.connection
    connection.tables.each { |table| connection.reset_pk_sequence!(table) }
  end

  def self.in_flight
    @in_flight ||= {}.compare_by_identity
  end

  def self.watch(page)
    watch_requests(page)
    page.on('console', ->(message) { record_console(message) })
    page.on('pageerror', ->(error) { record('pageerror', error.message) })
    page.on('response', ->(response) { record_error_response(response) })
  end

  def self.watch_requests(page)
    page.on('request', ->(request) { track_request(request) })
    page.on('requestfinished', ->(request) { in_flight.delete(request) })
    page.on('requestfailed', lambda { |request|
      in_flight.delete(request)
      record_failed_request(request)
    })
  end

  def self.track_request(request)
    in_flight[request] = true unless request.url.start_with?(STUBBED_FONTS)
  end

  def self.record(type, text)
    events << { 'type' => type, 'text' => text }
  end

  def self.record_console(message)
    return unless message.type == 'error'
    return if message.location['url'].to_s.start_with?(STUBBED_FONTS)

    record('console', message.text)
  end

  def self.record_failed_request(request)
    return if request.url.start_with?(STUBBED_FONTS)

    record('requestfailed', "#{request.method} #{path_of(request.url)} #{request.failure}")
  end

  def self.record_error_response(response)
    return if response.status < 400

    record('http', "#{response.status} #{response.request.method} #{path_of(response.url)}")
  end

  def self.path_of(url)
    uri = URI.parse(url)
    uri.host.in?(%w[127.0.0.1 localhost]) ? uri.request_uri : url
  rescue URI::InvalidURIError
    url
  end

  def self.finish(example)
    FileUtils.mkdir_p(OUT_DIR)
    exception = example.exception
    result = {
      'status' => exception ? 'failed' : 'passed',
      'error' => exception && "#{exception.class}: #{exception.message.lines.first(3).join.strip}".truncate(400),
      'line' => exception && exception.backtrace&.find { |line| line.include?('_spec.rb') },
      'events' => events
    }
    File.write(File.join(OUT_DIR, 'result.json'), JSON.pretty_generate(result))
  end

  private

  def resize_to(size, reload:)
    ui_qa_page.set_viewport_size(size)
    ui_qa_page.reload if reload
    ui_qa_page.evaluate('() => window.dispatchEvent(new Event("resize"))')
  end

  def settle_page
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 10
    quiet_since = nil
    loop do
      quiet = UiQa.in_flight.empty? && !turbo_busy?
      quiet_since = quiet ? (quiet_since || Process.clock_gettime(Process::CLOCK_MONOTONIC)) : nil
      break if quiet_since && Process.clock_gettime(Process::CLOCK_MONOTONIC) - quiet_since > 0.3
      break if Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline

      sleep 0.05
    end
    ui_qa_page.evaluate(SETTLED_JS)
  end

  def turbo_busy?
    ui_qa_page.evaluate(TURBO_BUSY_JS)
  rescue Playwright::Error
    true
  end

  def write_capture(key, mask:, hide:)
    FileUtils.mkdir_p(OUT_DIR)
    ui_qa_page.mouse.move(0, 0)
    settle_page
    style = SETTLE_CSS + hide.map { |selector| "#{selector} { visibility: hidden !important; }" }.join("\n")
    ui_qa_page.screenshot(
      path: File.join(OUT_DIR, "#{key}.png"),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      style:,
      mask: mask.map { |selector| ui_qa_page.locator(selector) }
    )
    write_page_facts(key)
  end

  def write_page_facts(key)
    File.write(File.join(OUT_DIR, "#{key}.aria.yml"), ui_qa_page.locator('body').aria_snapshot)
    facts = ui_qa_page.evaluate(PAGE_FACTS_JS).merge('issues' => ui_qa_page.evaluate(LAYOUT_CHECKS_JS))
    File.write(File.join(OUT_DIR, "#{key}.json"), JSON.generate(facts))
  end
end

Capybara.register_driver(:ui_qa) do |app|
  Capybara::Playwright::Driver.new(
    app,
    browser_type: :chromium,
    headless: ENV['UI_QA_HEADED'].nil?,
    viewport: UiQa::VIEWPORTS[:desktop],
    reducedMotion: 'reduce',
    args: ['--force-device-scale-factor=1', '--hide-scrollbars']
  )
end

RSpec.configure do |config|
  config.include UiQa, :ui_qa
  config.include ActiveSupport::Testing::TimeHelpers, :ui_qa

  config.around(:each, :ui_qa) do |example|
    FFaker::Random.seed = 42 if defined?(FFaker)
    Faker::Config.random = Random.new(42) if defined?(Faker)
    srand(42)
    UiQa.reset_sequences
    travel_to(UiQa::FROZEN_AT) { example.run }
  end

  config.before(:each, :ui_qa) do
    driven_by(:ui_qa)
    ui_qa_page.set_viewport_size(UiQa::VIEWPORTS[:desktop])
    ui_qa_page.clock.set_fixed_time(UiQa::FROZEN_AT)
    UiQa.watch(ui_qa_page)
  end

  config.after(:each, :ui_qa) do |example|
    UiQa.finish(example)
    if ENV['UI_QA_HEADED']
      puts "\nui-qa: browser left open at #{page.current_url}. Press Enter to finish."
      $stdin.gets
    end
  end
end
