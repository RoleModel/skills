# frozen_string_literal: true

# Builds the page the agent publishes as an Artifact: the verdict and findings first, then
# before/after screenshots for every capture that differs. Writes tmp/ui-qa/report/index.html
# plus WebP images beside it.

require 'json'
require 'cgi'
require 'fileutils'
require 'time'
require 'vips'

class UiQaReport
  PIXEL_THRESHOLD = 24
  KIND_ORDER = %w[bug unexpected intended note].freeze
  VERDICTS = {
    'looks_right' => 'Looks right',
    'needs_work' => 'Needs work',
    'blocked' => 'Blocked'
  }.freeze
  STATUS_LABELS = {
    'changed' => 'Changed',
    'new' => 'New on this branch',
    'head_only' => 'Head only',
    'missing_on_head' => 'Missing on this branch',
    'unchanged' => 'Unchanged'
  }.freeze

  DARK_TOKENS = <<~CSS
    --bg: #121417; --surface: #1b1e22; --fg: #e8eaed; --muted: #9aa1aa; --line: #2e3238; --accent: #7cb7e0;
    --on-accent: #121417;
    --bug: #f2877c; --bug-bg: #3a1d1a; --unexpected: #f0b45e; --unexpected-bg: #362813;
    --intended: #6fcf97; --intended-bg: #16301f; --note: #9aa1aa; --note-bg: #24282d; --new: #7cb7e0;
    color-scheme: dark;
  CSS

  STYLE = <<~CSS.freeze
    /* One reading column: verdict and findings first, then a card per screen with its own view toggle. */
    :root {
      --bg: #f5f6f7; --surface: #ffffff; --fg: #17191c; --muted: #5d636b; --line: #dcdfe3;
      --accent: #1f5f8b; --on-accent: #ffffff;
      --bug: #b42318; --bug-bg: #fdecea; --unexpected: #a15c07; --unexpected-bg: #fdf3e2;
      --intended: #1e7a46; --intended-bg: #e7f5ec; --note: #5d636b; --note-bg: #eef0f2; --new: #1f5f8b;
      --font-body: "IBM Plex Sans", system-ui, sans-serif;
      --font-mono: "IBM Plex Mono", ui-monospace, monospace;
    }
    @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { #{DARK_TOKENS} } }
    :root[data-theme="dark"] { #{DARK_TOKENS} }
    body { background: var(--bg); color: var(--fg); font: 15px/1.55 var(--font-body); }
    main { max-width: 1200px; margin: 0 auto; display: grid; gap: 40px; padding-block: 32px 64px;
      padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
    h1, h2, h3 { text-wrap: balance; margin: 0; }
    h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.01em; }
    h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    code { font-family: var(--font-mono); font-size: 0.92em; }
    .top { display: grid; gap: 14px; }
    .eyebrow { margin: 0; font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
    .verdict { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
    .verdict p { margin: 0; font-size: 17px; max-width: 65ch; }
    .pill { font-weight: 600; font-size: 13px; padding: 4px 12px; border-radius: 99px; background: var(--note-bg); color: var(--note); }
    .verdict--looks_right .pill { background: var(--intended-bg); color: var(--intended); }
    .verdict--needs_work .pill { background: var(--unexpected-bg); color: var(--unexpected); }
    .verdict--blocked .pill { background: var(--bug-bg); color: var(--bug); }
    .intent { margin: 0; max-width: 70ch; color: var(--muted); }
    .intent b { color: var(--fg); font-weight: 600; margin-right: 6px; }
    .tally { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 14px; color: var(--muted); }
    .tally b { color: var(--fg); font-variant-numeric: tabular-nums; }
    .findings, .captures, .notes { display: grid; gap: 14px; }
    .finding-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .finding { display: grid; grid-template-columns: 96px 1fr; gap: 12px; padding: 12px 16px; background: var(--surface);
      border: 1px solid var(--line); border-left: 4px solid var(--note); border-radius: 6px; }
    .finding--bug { border-left-color: var(--bug); }
    .finding--unexpected { border-left-color: var(--unexpected); }
    .finding--intended { border-left-color: var(--intended); }
    .kind { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--note); padding-top: 2px; }
    .finding--bug .kind { color: var(--bug); }
    .finding--unexpected .kind { color: var(--unexpected); }
    .finding--intended .kind { color: var(--intended); }
    .finding-body { min-width: 0; display: grid; gap: 4px; }
    .finding-body p { margin: 0; }
    .finding-title { font-weight: 600; }
    .finding-detail { color: var(--muted); }
    .cap-link { font-family: var(--font-mono); font-size: 12px; color: var(--accent); justify-self: start; }
    .not-covered h3 { font-size: 14px; }
    .not-covered ul { margin: 6px 0 0; padding-left: 20px; color: var(--muted); }
    .card { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 16px; display: grid; gap: 12px; scroll-margin-top: 16px; }
    .card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
    .card-head h3 { font-size: 15px; }
    .status { font-size: 13px; color: var(--muted); }
    .card--new .status { color: var(--new); }
    .card--missing_on_head .status { color: var(--bug); }
    .tabs { margin-left: auto; display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    .tabs button { font: inherit; font-size: 13px; padding: 5px 12px; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
    .tabs button + button { border-left: 1px solid var(--line); }
    .tabs button[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); }
    .tabs button:focus-visible, .slider input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .view--side { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    figure { margin: 0; min-width: 0; display: grid; gap: 4px; align-content: start; }
    figcaption { font-size: 12px; color: var(--muted); }
    figure img { width: 100%; border: 1px solid var(--line); border-radius: 4px; display: block; }
    .solo { max-width: 900px; }
    .slider { position: relative; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
    .slider img { display: block; width: 100%; }
    .slider-head { position: absolute; inset: 0; clip-path: inset(0 0 0 var(--split)); }
    .slider::after { content: ""; position: absolute; top: 0; bottom: 0; left: var(--split); width: 2px; background: var(--accent); pointer-events: none; }
    .slider input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: ew-resize; margin: 0; }
    .hint { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
    .aria summary, .unchanged summary { cursor: pointer; font-size: 13px; color: var(--muted); }
    .aria pre { margin: 8px 0 0; padding: 12px; background: var(--bg); border-radius: 4px; overflow-x: auto; font: 12px/1.5 var(--font-mono); }
    .aria .add { color: var(--intended); }
    .aria .del { color: var(--bug); }
    .aria .hunk { color: var(--muted); }
    .thumbs { margin-top: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .notes ul { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
    .notes code { overflow-wrap: anywhere; }
    @media (max-width: 700px) {
      .view--side { grid-template-columns: 1fr; }
      .finding { grid-template-columns: 1fr; gap: 4px; }
      .tabs { margin-left: 0; }
    }
  CSS

  SCRIPT = <<~JS
    document.querySelectorAll('.card').forEach((card) => {
      const buttons = card.querySelectorAll('.tabs button');
      buttons.forEach((button) => {
        button.addEventListener('click', () => {
          buttons.forEach((other) => other.setAttribute('aria-pressed', other === button));
          card.querySelectorAll('.view').forEach((view) => {
            view.hidden = !view.classList.contains('view--' + button.dataset.view);
          });
        });
      });
      const range = card.querySelector('.slider input');
      if (range) range.addEventListener('input', () => range.parentElement.style.setProperty('--split', range.value + '%'));
    });
  JS

  def initialize(run_dir, out_dir, probes_dir = nil)
    @run = run_dir
    @probes = probes_dir && JSON.parse(File.read(File.join(probes_dir, 'data.json')))['captures']
    @probes_dir = probes_dir
    @out = out_dir
    @data = JSON.parse(File.read(File.join(run_dir, 'data.json')))
    verdict_path = File.join(run_dir, 'verdict.json')
    @verdict = File.exist?(verdict_path) ? JSON.parse(File.read(verdict_path)) : {}
  end

  def call
    FileUtils.rm_rf(@out)
    FileUtils.mkdir_p(File.join(@out, 'img'))
    File.write(File.join(@out, 'index.html'), page)
    puts File.join(@out, 'index.html')
  end

  private

  def captures
    @data['captures']
  end

  def findings
    Array(@verdict['findings']).sort_by { |finding| KIND_ORDER.index(finding['kind']) || KIND_ORDER.size }
  end

  def h(text)
    CGI.escapeHTML(text.to_s)
  end

  def anchor(key)
    "cap-#{key.gsub(/[^a-zA-Z0-9-]/, '-')}"
  end

  def webp(source, name)
    return unless File.exist?(source)

    Vips::Image.new_from_file(source).write_to_file(File.join(@out, 'img', "#{name}.webp"), Q: 80)
    "img/#{name}.webp"
  end

  def highlight(key)
    base, head = padded(*%w[base head].map { |side| Vips::Image.new_from_file(File.join(@run, side, "#{key}.png")) })
    name = "#{anchor(key)}-changes.webp"
    changed_in_red(base, head).write_to_file(File.join(@out, 'img', name), Q: 80)
    "img/#{name}"
  end

  def changed_in_red(base, head)
    mask = ((base - head).abs > PIXEL_THRESHOLD).bandbool(:or)
    tinted = (head * 0.35) + [255 * 0.65, 40 * 0.65, 40 * 0.65]
    faded = (head * 0.45) + (255 * 0.55)
    mask.ifthenelse(tinted, faded).cast(:uchar)
  end

  def padded(*images)
    width = images.map(&:width).max
    height = images.map(&:height).max
    images.map do |image|
      image = image.flatten(background: 255) if image.has_alpha?
      image.colourspace(:srgb).cast(:short).gravity('north-west', width, height, extend: :white)
    end
  end

  def page
    <<~HTML
      <title>#{h(@verdict['title'] || "UI QA #{File.basename(@run)}")}</title>
      <meta name="claude:viewport-fit-sides" content="cover">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
      <style>#{STYLE}</style>
      <main>
        #{header}
        #{findings_section}
        #{captures_section}
        #{footer}
      </main>
      <script>#{SCRIPT}</script>
    HTML
  end

  def header
    verdict = @verdict['verdict'] || 'pending'
    <<~HTML
      <header class="top">
        <p class="eyebrow">#{h(sha('base_sha') || 'no base')} → #{h(sha('head_sha'))} · #{h(run_time)}</p>
        <h1>#{h(@verdict['title'] || 'UI QA')}</h1>
        <div class="verdict verdict--#{h(verdict)}">
          <span class="pill">#{h(VERDICTS.fetch(verdict, 'Not judged yet'))}</span>
          <p>#{h(@verdict['headline'])}</p>
        </div>
        #{"<p class=\"intent\"><b>Intent</b> #{h(@verdict['intent'])}</p>" if @verdict['intent']}
        #{tally}
      </header>
    HTML
  end

  def sha(file)
    path = File.join(@run, file)
    File.read(path).strip[0, 9] if File.exist?(path)
  end

  def run_time
    Time.strptime(File.basename(@run)[0, 15], '%Y%m%d-%H%M%S').strftime('%b %-d, %Y %-l:%M %p')
  rescue ArgumentError
    File.basename(@run)
  end

  def tally
    counts = captures.group_by { |capture| capture['status'] }.transform_values(&:size)
    items = STATUS_LABELS.filter_map do |status, label|
      "<li><b>#{counts[status]}</b> #{h(label.downcase)}</li>" if counts[status]
    end
    errors = @data['new_errors'].size
    items << "<li><b>#{errors}</b> new browser #{errors == 1 ? 'error' : 'errors'}</li>"
    "<ul class=\"tally\">#{items.join}</ul>"
  end

  def findings_section
    not_covered = Array(@verdict['not_covered']).map { |item| "<li>#{h(item)}</li>" }.join
    return '' if findings.empty? && not_covered.empty?

    <<~HTML
      <section class="findings">
        <h2>Findings</h2>
        <ol class="finding-list">#{findings.map { |finding| finding_row(finding) }.join}</ol>
        #{"<div class=\"not-covered\"><h3>Not covered</h3><ul>#{not_covered}</ul></div>" unless not_covered.empty?}
      </section>
    HTML
  end

  def finding_row(finding)
    capture = finding['capture']
    link = capture ? "<a class=\"cap-link\" href=\"##{anchor(capture)}\">#{h(capture)}</a>" : ''
    detail = finding['detail'] ? "<p class=\"finding-detail\">#{h(finding['detail'])}</p>" : ''
    <<~HTML
      <li class="finding finding--#{h(finding['kind'])}">
        <span class="kind">#{h(finding['kind'])}</span>
        <div class="finding-body"><p class="finding-title">#{h(finding['title'])}</p>#{detail}#{link}</div>
      </li>
    HTML
  end

  def captures_section
    flagged, unchanged = captures.partition { |capture| capture['status'] != 'unchanged' }
    <<~HTML
      <section class="captures">
        <h2>Screens</h2>
        #{flagged.map { |capture| capture_card(capture) }.join}
        #{unchanged_block(unchanged)}
      </section>
      #{probes_section}
    HTML
  end

  def probes_section
    return '' unless @probes

    cards = @probes.map do |capture|
      key = "probes/#{capture['key']}"
      head = webp(File.join(@probes_dir, 'head', "#{capture['key']}.png"), "#{anchor(key)}-head")
      <<~HTML
        <article class="card card--probe" id="#{anchor(key)}">
          <div class="card-head"><h3><code>#{h(key)}</code></h3><span class="status">Probe, this branch only</span></div>
          #{solo(nil, head)}
        </article>
      HTML
    end
    "<section class=\"captures\"><h2>Probes</h2>#{cards.join}</section>"
  end

  def capture_card(capture)
    key = capture['key']
    base, head = %w[base head].map { |side| webp(File.join(@run, side, "#{key}.png"), "#{anchor(key)}-#{side}") }
    <<~HTML
      <article class="card card--#{h(capture['status'])}" id="#{anchor(key)}">
        #{card_body(capture, base, head)}
        #{aria_block(capture)}
      </article>
    HTML
  end

  def card_body(capture, base, head)
    changes = highlight(capture['key']) if capture['region']
    <<~HTML
      <div class="card-head">
        <h3><code>#{h(capture['key'])}</code></h3>
        <span class="status">#{h(STATUS_LABELS[capture['status']])}#{change_size(capture)}</span>
        #{view_tabs(changes) if base && head}
      </div>
      #{base && head ? comparison(base, head, changes) : solo(base, head)}
    HTML
  end

  def change_size(capture)
    return '' unless capture['changed_ratio']

    " · #{(capture['changed_ratio'] * 100).round(1)}% of pixels"
  end

  def view_tabs(changes)
    tabs = [%w[side Side\ by\ side], %w[slider Slider]]
    tabs << %w[changes Changes] if changes
    buttons = tabs.map.with_index do |(view, label), index|
      "<button type=\"button\" data-view=\"#{view}\" aria-pressed=\"#{index.zero?}\">#{label}</button>"
    end
    "<div class=\"tabs\" role=\"group\" aria-label=\"View\">#{buttons.join}</div>"
  end

  def solo(base, head)
    "<figure class=\"solo\">#{img(head || base, head ? 'This branch' : 'Base')}</figure>"
  end

  def comparison(base, head, changes)
    <<~HTML
      <div class="view view--side">
        <figure>#{img(base, 'Base')}</figure>
        <figure>#{img(head, 'This branch')}</figure>
      </div>
      <div class="view view--slider" hidden>
        <div class="slider" style="--split: 50%">
          <img src="#{base}" alt="Base">
          <img class="slider-head" src="#{head}" alt="This branch">
          <input type="range" min="0" max="100" value="50" aria-label="Move the line between base and this branch">
        </div>
        <p class="hint">Base is left of the line, this branch is right of it.</p>
      </div>
      #{"<div class=\"view view--changes\" hidden><figure>#{img(changes, 'Changed pixels in red')}</figure></div>" if changes}
    HTML
  end

  def img(src, caption)
    "<figcaption>#{h(caption)}</figcaption><a href=\"#{src}\" target=\"_blank\">" \
      "<img src=\"#{src}\" alt=\"#{h(caption)}\" loading=\"lazy\"></a>"
  end

  def aria_block(capture)
    return '' if capture['aria_diff'].to_s.strip.empty?

    lines = capture['aria_diff'].lines.map do |line|
      css = { '+' => 'add', '-' => 'del', '@' => 'hunk' }[line[0]]
      "<span#{" class=\"#{css}\"" if css}>#{h(line.chomp)}</span>"
    end
    "<details class=\"aria\"><summary>Accessibility tree changes</summary><pre>#{lines.join("\n")}</pre></details>"
  end

  def unchanged_block(unchanged)
    return '' if unchanged.empty?

    items = unchanged.map do |capture|
      src = webp(File.join(@run, 'head', "#{capture['key']}.png"), "#{anchor(capture['key'])}-head")
      "<figure>#{img(src, capture['key'])}</figure>"
    end
    <<~HTML
      <details class="unchanged"><summary>#{unchanged.size} unchanged #{unchanged.size == 1 ? 'screen' : 'screens'}</summary>
      <div class="thumbs">#{items.join}</div></details>
    HTML
  end

  def footer
    errors = @data['new_errors'].map { |text| "<li><code>#{h(text)}</code></li>" }.join
    runs = [['This branch', @data['head']], ['Base', @data['base']]].filter_map do |label, result|
      if result && result['status'] != 'passed'
        "<li><b>#{label}</b> stopped early: <code>#{h(result['error'])}</code></li>"
      end
    end
    return '' if errors.empty? && runs.empty?

    <<~HTML
      <section class="notes">
        #{"<h2>New browser errors</h2><ul>#{errors}</ul>" unless errors.empty?}
        #{"<h2>Scenario runs</h2><ul>#{runs.join}</ul>" unless runs.empty?}
      </section>
    HTML
  end
end

UiQaReport.new(ARGV.fetch(0), ARGV.fetch(1), ARGV[2]).call
