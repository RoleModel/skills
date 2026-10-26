# RSpec Conventions

## let vs let! (Lazy vs Eager Evaluation)

**Use `let` (lazy)** when the variable is explicitly referenced in the test and you want to control when it's created:

```ruby
let(:job) { create(:job, name: 'Test Job', location:) }

it 'can delete a job' do
  visit job_path(job) # job created here when first referenced
  click_button 'Delete'
end
```

**Use `let!` (eager)** when the record must exist in the database before the test runs, even if the variable is never referenced directly:

```ruby
let!(:location) { create(:location, name: 'Main Office') }
let!(:manager) { create(:user, :manager) }

it 'shows location in dropdown' do
  visit new_job_path
  # location must exist in DB for dropdown to display it
  expect(page).to have_select('Location', with_options: [location.name])
end
```

**Common pitfall:** using `let` when the record must exist for the test to pass but is never referenced by name.

```ruby
# Wrong: job2 is never referenced, so it's never created
let(:job1) { create(:job, name: 'Job 1') }
let(:job2) { create(:job, name: 'Job 2') }

it 'lists all jobs' do
  visit jobs_path
  expect(page).to have_content('Job 1')
  expect(page).to have_content('Job 2') # FAILS - job2 not in DB
end

# Right: let! ensures both exist before the test runs
let!(:job1) { create(:job, name: 'Job 1') }
let!(:job2) { create(:job, name: 'Job 2') }
```

**Rule of thumb:** if you expect to see data without explicitly referencing the variable (viewing a list, selecting from a dropdown), use `let!`.

## Validation Testing

Test validations using `build` (no database writes), then verify the model is invalid and check error messages:

```ruby
describe 'validations' do
  it 'requires a start date' do
    membership = build(:membership, start_date: nil)

    expect(membership).not_to be_valid
    expect(membership.errors[:start_date]).to include("can't be blank")
  end

  it 'enforces end date must follow start date' do
    membership = build(:membership, start_date: 1.year.ago, end_date: 2.years.ago)

    expect(membership).not_to be_valid
    expect(membership.errors[:end_date]).to include('must follow start date')
  end

  it 'permits empty end date' do
    membership = build(:membership, start_date: 1.year.ago, end_date: nil)

    expect(membership).to be_valid
  end
end
```

Key points:
- Use `build` instead of `create` to avoid database writes
- Test both invalid and valid scenarios
- Verify error messages on the specific attribute with `errors[:attribute]`
- Use descriptive test names that explain the business rule
- Don't test associations or enums

## Element Selection with data-testid

Use `data-testid` attributes with `dom_id` for stable element selection that survives UI changes:

**View:**
```slim
tbody
  - @entries.each do |entry|
    tr data-testid=dom_id(entry)
      td= entry.name
```

**Spec:**
```ruby
within(data_test(entry1)) do
  click_button 'Submit'
end
```

Avoid text-based lookups (`within('tr', text: 'Entry 1')`) and CSS class selectors that may change during styling.

## Scoping with within Blocks

Use `within` blocks when:
- Multiple elements share the same text or label
- Interacting with modals, panels, or overlays
- Working with repeating elements (table rows, cards)
- Tests fail with "Ambiguous match" errors

## Turbo Confirm Dialogs

When testing actions that trigger Turbo confirm dialogs, use a helper that clicks the confirm button by text. This avoids brittle CSS selectors and works with both Rack and JS drivers:

**Setup:**
```ruby
# spec/support/helpers/turbo_confirm_helper.rb
module TurboConfirmHelper
  def accept_turbo_confirm(button_text = "Yes, I'm Sure")
    yield if block_given?
    return unless supports_javascript?

    expect(page).to have_button(button_text)
    click_on button_text
  end
end
```

Include in RSpec configuration:
```ruby
# spec/support/helpers.rb
RSpec.configure do |c|
  c.include TurboConfirmHelper, type: :system
end
```

**Usage:**
```ruby
accept_turbo_confirm do
  click_button 'Delete'
end
```

Use `:js` tag for tests involving Turbo confirm dialogs.

## FactoryBot

- Define factories for all models
- Use traits for variations (e.g., `create(:member, :archived)`)
- Keep factories minimal with only required attributes
- Override attributes in tests as needed
- Use `build` for validation tests, `create` when you need persisted records

## System Test Tips

- Use `:js` tag for specs that run JavaScript (Stimulus controllers, Turbo)
- Avoid `sleep` statements; use Capybara's built-in waiting (expectations wait automatically)
- Use `have_content`, `have_current_path`, and `have_css` for assertions
- After any action (`visit`, `click_on`), assert on visible content to confirm the page loaded
