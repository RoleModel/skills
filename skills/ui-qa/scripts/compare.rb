# frozen_string_literal: true

# Compares a run's head captures with its base captures and prints a compact summary for the agent.
# Pixels decide what changed; only changed captures get crops, so the agent looks at images only where it must.

require 'json'
require 'active_support/core_ext/enumerable'
require 'fileutils'
require 'open3'
require 'vips'

class UiQaCompare
  PIXEL_THRESHOLD = 24
  CROP_PADDING = 40
  MAX_CROP_HEIGHT = 1100
  MAX_PREVIEW_WIDTH = 1400
  UUID = /\h{8}-\h{4}-\h{4}-\h{4}-\h{12}/
  ICON_GLYPH = /[\u3400-\u9fff\ue000-\uf8ff]\s+(?=[a-z0-9]+(?:-[a-z0-9]+)+)/
  NUMERIC_PATH_SEGMENT = %r{/\d+(?=[/?#\s]|\z)}

  Capture = Struct.new(:key, :status, :changed_ratio, :region, :aria_diff, :image, :context, :overflow, :issues,
    keyword_init: true)
  SHEET_COLUMNS = 3
  SHEET_ROWS = 2
  TILE_WIDTH = 460
  TILE_HEIGHT = 620

  def initialize(run_dir)
    @run = run_dir
    @head = File.join(run_dir, 'head')
    @base = File.join(run_dir, 'base')
    @crops = File.join(run_dir, 'crops')
    FileUtils.rm_rf(@crops)
    FileUtils.mkdir_p(@crops)
  end

  def call
    captures = keys.map { |key| compare(key) }
    @sheets = contact_sheets(captures)
    data = {
      'head' => result(@head),
      'base' => base? ? result(@base) : nil,
      'captures' => captures.map { |capture| capture.to_h.transform_keys(&:to_s) },
      'new_errors' => new_errors
    }
    File.write(File.join(@run, 'data.json'), JSON.pretty_generate(data))
    summary = render_summary(data, captures)
    File.write(File.join(@run, 'summary.md'), summary)
    puts summary
  end

  private

  def base?
    File.exist?(File.join(@base, 'result.json'))
  end

  def result(dir)
    JSON.parse(File.read(File.join(dir, 'result.json')))
  end

  def keys
    names = [@head, @base].flat_map { |dir| Dir[File.join(dir, '*.png')] }.map { |path| File.basename(path, '.png') }
    order = result(@head)['events'].select { |event| event['type'] == 'capture' }.pluck('name')
    names.uniq.sort_by { |key| [order.index(key.split('@').first) || order.size, key] }
  end

  def compare(key)
    capture = classify(key)
    capture.context = page_context(key)
    capture.overflow = overflow(key)
    capture.issues = new_issues(key)
    capture
  end

  def new_issues(key)
    head = facts(@head, key).fetch('issues', [])
    base_targets = facts(@base, key).fetch('issues', []).to_set { |issue| [issue['kind'], issue['target']] }
    head.reject do |issue|
      base_targets.include?([issue['kind'], issue['target']])
    end.first(6).each_with_index.map do |issue, index|
      issue.merge('image' => (issue_crop(key, issue, index) if index < 3))
    end
  end

  def issue_crop(key, issue, index)
    image = flatten(Vips::Image.new_from_file(File.join(@head, "#{key}.png"))).cast(:uchar)
    height = [500, image.height].min
    top = (issue['y'].to_i - 150).clamp(0, image.height - height)
    write_scaled(image.crop(0, top, image.width, height), File.join(@crops, "#{key}.issue-#{index + 1}.png"))
  end

  def contact_sheets(captures)
    tiles = captures.select { |capture| %w[new head_only].include?(capture.status) && capture.image }
    tiles.each_slice(SHEET_COLUMNS * SHEET_ROWS).with_index(1).map do |group, number|
      path = File.join(@crops, "contact-#{number}.png")
      sheet_image(group).write_to_file(path)
      [path, group.map(&:key)]
    end
  end

  def sheet_image(group)
    images = group.map { |capture| tile(Vips::Image.new_from_file(capture.image)) }
    Vips::Image.arrayjoin(images, across: [SHEET_COLUMNS, images.size].min)
  end

  def tile(image)
    image = image.resize(TILE_WIDTH.to_f / image.width) if image.width > TILE_WIDTH
    image = image.crop(0, 0, image.width, [image.height, TILE_HEIGHT].min)
    flatten(image).cast(:uchar).gravity('north-west', TILE_WIDTH + 8, TILE_HEIGHT + 8, extend: :background,
      background: [255, 0, 255])
  end

  def classify(key)
    head_png = File.join(@head, "#{key}.png")
    base_png = File.join(@base, "#{key}.png")
    return Capture.new(key:, status: 'missing_on_head') unless File.exist?(head_png)
    unless File.exist?(base_png)
      return Capture.new(key:, status: base? ? 'new' : 'head_only',
        image: preview(head_png, key))
    end

    aria_diff = aria_diff(key)
    ratio, region, focus = pixel_diff(base_png, head_png)
    return Capture.new(key:, status: 'unchanged') if ratio.zero? && aria_diff.empty?

    Capture.new(key:, status: 'changed', changed_ratio: ratio.round(4), region:, aria_diff:,
      image: focus ? side_by_side(base_png, head_png, focus, key) : nil)
  end

  def pixel_diff(base_png, head_png)
    base, head = padded_pair(Vips::Image.new_from_file(base_png), Vips::Image.new_from_file(head_png))
    mask = ((base - head).abs > PIXEL_THRESHOLD).bandbool(:or)
    ratio = mask.avg / 255.0
    return [0, nil, nil] if ratio.zero?

    left, top, width, height = mask.find_trim(background: [0], threshold: 0)
    [ratio, { 'x' => left, 'y' => top, 'width' => width, 'height' => height }, densest_band(mask, top, height)]
  end

  def densest_band(mask, top, height)
    window = MAX_CROP_HEIGHT - (2 * CROP_PADDING)
    return [top, height] if height <= window

    rows = mask.project[1].to_a.flatten.map { |sum| sum / 255 }
    sums = rows.each_cons(window).map(&:sum)
    [sums.each_with_index.max[1], window]
  end

  def padded_pair(base, head)
    width = [base.width, head.width].max
    height = [base.height, head.height].max
    [base, head].map { |image| flatten(image).gravity('north-west', width, height, extend: :white) }
  end

  def flatten(image)
    image = image.flatten(background: 255) if image.has_alpha?
    image.colourspace(:srgb).cast(:short)
  end

  def side_by_side(base_png, head_png, focus, key)
    base, head = padded_pair(Vips::Image.new_from_file(base_png), Vips::Image.new_from_file(head_png))
    top, height = crop_band(focus, base.height)
    base_crop, head_crop = [base, head].map { |image| image.crop(0, top, image.width, height).cast(:uchar) }
    write_scaled(base_crop.join(gutter(height), :horizontal).join(head_crop, :horizontal),
      File.join(@crops, "#{key}.png"))
  end

  def crop_band((band_top, band_height), image_height)
    top = [band_top - CROP_PADDING, 0].max
    [top, [band_height + (2 * CROP_PADDING), MAX_CROP_HEIGHT, image_height - top].min]
  end

  def gutter(height)
    (Vips::Image.black(12, height, bands: 3) + [255, 0, 255]).cast(:uchar)
  end

  def preview(png, key)
    image = Vips::Image.new_from_file(png)
    height = [image.height, MAX_CROP_HEIGHT].min
    top = (facts(@head, key)['focus_y'].to_i - (height / 3)).clamp(0, image.height - height)
    write_scaled(image.crop(0, top, image.width, height), File.join(@crops, "#{key}.png"))
  end

  def facts(dir, key)
    path = File.join(dir, "#{key}.json")
    File.exist?(path) ? JSON.parse(File.read(path)) : {}
  end

  def page_context(key)
    path = [@head, @base].map { |dir| File.join(dir, "#{key}.aria.yml") }.find { |file| File.exist?(file) }
    return '' unless path

    aria = File.read(path).gsub(ICON_GLYPH, 'icon:')
    heading = (aria[/^\s*- main\b.*/m] || aria)[/- heading "([^"]+)"/, 1]
    [heading && "\"#{heading}\"", *alerts(aria)].compact.join(' · ')
  end

  def alerts(aria)
    aria.scan(/- alert: (.+)/).flatten.map { |text| "alert: #{text.strip.delete('"')[0, 80]}" }
  end

  def overflow(key)
    head = facts(@head, key)
    return nil unless head['scroll_width'].to_i > head['viewport_width'].to_i + 1

    base = facts(@base, key)
    pre_existing = base['scroll_width'].to_i > base['viewport_width'].to_i + 1
    "#{head['scroll_width']}px wide at #{head['viewport_width']}px#{' (also on base)' if pre_existing}"
  end

  def write_scaled(image, path)
    image = image.resize(MAX_PREVIEW_WIDTH.to_f / image.width) if image.width > MAX_PREVIEW_WIDTH
    image.write_to_file(path)
    path
  end

  def aria_diff(key)
    base_aria = File.join(@base, "#{key}.aria.yml")
    head_aria = File.join(@head, "#{key}.aria.yml")
    return '' unless File.exist?(base_aria) && File.exist?(head_aria)

    output, = Open3.capture2('diff', '-U1', '--label', 'base', '--label', 'head',
      normalized(base_aria, 'base'), normalized(head_aria, 'head'))
    output.lines.drop(2).join.strip
  end

  def normalized(aria_path, side)
    path = File.join(@crops, "#{File.basename(aria_path, '.aria.yml')}.#{side}.aria.yml")
    File.write(path, "#{File.read(aria_path).gsub(UUID, '<uuid>').gsub(ICON_GLYPH, 'icon:')}\n")
    path
  end

  def new_errors
    head_errors = error_texts(result(@head))
    return head_errors unless base?

    base_errors = error_texts(result(@base))
    head_errors.reject { |text| base_errors.include?(text) }
  end

  def error_texts(result)
    result['events'].reject { |event| event['type'] == 'capture' }
      .map { |event| "#{event['type']}: #{event['text'].gsub(UUID, '<uuid>').gsub(NUMERIC_PATH_SEGMENT, '/N')}" }.uniq
  end

  def render_summary(data, captures)
    grouped = captures.group_by(&:status)
    lines = header_lines(data)
    %w[changed new head_only missing_on_head].each { |status| lines.concat(group_lines(status, grouped[status])) }
    lines.concat(unchanged_lines(grouped.fetch('unchanged', [])))
    lines.concat(overflow_lines(captures))
    lines.concat(issue_lines(captures))
    lines.concat(sheet_lines)
    lines.concat(error_lines(data['new_errors'])).join("\n")
  end

  def header_lines(data)
    ["# ui-qa #{File.basename(@run)}", '', "head: #{status_line(data['head'])}",
     "base: #{data['base'] ? status_line(data['base']) : 'not run'}", '']
  end

  def group_lines(status, captures)
    return [] unless captures

    ["## #{status.tr('_', ' ')} (#{captures.size})", *captures.flat_map { |capture| capture_lines(capture) }, '']
  end

  def unchanged_lines(captures)
    ["## unchanged (#{captures.size})", *captures.map { |capture| "- #{capture.key}#{context_note(capture)}" }]
  end

  def overflow_lines(captures)
    overflowing = captures.select(&:overflow)
    return [] if overflowing.empty?

    ['', "## horizontal overflow (#{overflowing.size})", *overflowing.map do |capture|
      "- #{capture.key}: #{capture.overflow}"
    end]
  end

  def issue_lines(captures)
    flagged = captures.select { |capture| capture.issues&.any? }
    return [] if flagged.empty?

    lines = ['', '## layout issues new on head (measured in the page; base has none of these)']
    flagged.each do |capture|
      lines << "- #{capture.key}#{' (no base to compare)' unless %w[changed unchanged].include?(capture.status)}"
      lines.concat(capture.issues.map { |issue| issue_line(issue) })
    end
    lines
  end

  def issue_line(issue)
    times = issue['count'].to_i > 1 ? " (#{issue['count']} places)" : ''
    image = issue['image'] ? " → #{issue['image']}" : ''
    "  - #{issue['kind']}: #{issue['target']}, #{issue['detail']}#{times}#{image}"
  end

  def sheet_lines
    return [] if @sheets.empty?

    ['', '## contact sheets of new screens (read these instead of each crop)',
     *@sheets.map { |path, keys| "- #{path}: #{keys.join(', ')}" }]
  end

  def context_note(capture)
    capture.context.to_s.empty? ? '' : " — #{capture.context}"
  end

  def error_lines(errors)
    return [] if errors.empty?

    ['', "## new browser errors on head (#{errors.size})", *errors.first(15).map { |text| "- #{text}" }]
  end

  def status_line(result)
    return result['status'] if result['status'] == 'passed'

    location = result['line'] ? " at #{result['line'].split('/').last}" : ''
    "#{result['status']}#{location}: #{result['error']}"
  end

  def capture_lines(capture)
    image = capture.image ? " → #{relative(capture.image)}" : ''
    lines = ["- #{capture.key}#{change_detail(capture)}#{context_note(capture)}#{image}"]
    return lines if capture.aria_diff.to_s.strip.empty?

    lines << "  ```diff\n#{capture.aria_diff.lines.first(40).join.gsub(/^/, '  ')}\n  ```"
  end

  def change_detail(capture)
    return '' unless capture.status == 'changed'
    return ' text only, pixels identical: the screenshot may predate the page update' unless capture.region

    band = "y=#{capture.region['y']}..#{capture.region['y'] + capture.region['height']}"
    layout = capture.aria_diff.to_s.strip.empty? ? ', layout only (text identical)' : ''
    " #{(capture.changed_ratio * 100).round(2)}% px, #{band}#{layout}"
  end

  def relative(path)
    path
  end
end

UiQaCompare.new(ARGV.fetch(0)).call
