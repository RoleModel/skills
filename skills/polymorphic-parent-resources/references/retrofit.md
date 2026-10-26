# Retrofitting an Existing App

How to find duplicated per-parent controllers in a project and consolidate them onto the polymorphic parent pattern. Read this when adopting the pattern in code that already exists, rather than building something new.

## Phase 1 — Audit

Run these from the app root. Each surfaces a different symptom of the same duplication.

**Controllers sharing a basename across namespaces** — the strongest signal:

```bash
find app/controllers -name '*_controller.rb' -exec basename {} \; | sort | uniq -d
```

Then locate each duplicate set:

```bash
find app/controllers -name 'comments_controller.rb'
```

**Hard-coded parent lookups** — candidates for `resource_for`:

```bash
grep -rn 'find(params\[:[a-z_]*_id\])' app/controllers
```

**Child models that are already polymorphic** — these can adopt the pattern with no data change:

```bash
grep -rn 'polymorphic: true' app/models
```

**Route concerns already passing a type** — partial adoption; the controller half may be missing:

```bash
grep -n '_type: parent_resource' config/routes.rb
```

**Repeated nested resource declarations** — the routing-side symptom:

```bash
grep -n 'resources :comments\|resources :generated_reports\|resources :duplications' config/routes.rb
```

## Phase 2 — Decide

Consolidate when:

- Two or more controllers differ **only** in which parent they load and which views they render
- The child model is already `polymorphic: true`, or has a single parent association that can become one
- The per-parent authorization rules are the same, or differ only via the policy

Leave alone when:

- The copies have genuinely diverged — different strong params, different authorization logic, different view structure. Consolidating these means smuggling conditionals into one controller, which is worse than the duplication. Consolidate the ones that match and leave the outlier.
- Only one parent exists and none is planned.

**Stop and reassess if the child has a separate foreign key column per parent** (`article_id`, `widget_id`, `account_id` all on `comments`). That is a data migration to a `commentable_type` / `commentable_id` pair, not a controller refactor. Scope and land the migration first; this pattern assumes a working polymorphic association.

## Phase 3 — Consolidate

Confirm `rolemodel_rails >= 2.4.0` first (see SKILL.md). Then migrate **one parent at a time** so the suite stays green between steps.

1. **Make the association polymorphic**, if it is not already:

   ```ruby
   class Comment < ApplicationRecord
     belongs_to :commentable, polymorphic: true
   end
   ```

   Add `has_many :comments, as: :commentable, dependent: :destroy` to each parent.

2. **Add the route concern** without applying it yet:

   ```ruby
   concern :commentable do
     resources :comments, commentable_type: parent_resource.name.classify
   end
   ```

3. **Create the single top-level controller** from the richest existing copy — the one with the most complete authorization and error handling. Replace its parent lookup with `resource_for`, and split the `before_action`s per SKILL.md. Leave the old namespaced controllers in place for now.

4. **Move the views** to the shared location (`app/views/comments/`) and make every path helper polymorphic: `[@commentable, @comment]`, `[@commentable, :comments]`.

5. **Cut over one parent**: apply `concerns: %i[commentable]` to that parent, remove its old nested `resources :comments` block, delete its namespaced controller and views, and run the suite. Fix fallout before moving on.

6. **Repeat step 5** for each remaining parent.

7. **Delete leftovers** and check for stale references:

   ```bash
   grep -rn 'Articles::CommentsController\|articles/comments' app spec config
   ```

## Phase 4 — Verify

**Diff the route table** — this is where consolidation breaks things quietly. Capture it before starting and compare after:

```bash
bin/rails routes | grep comment > /tmp/routes-before.txt
# ...after the change...
bin/rails routes | grep comment > /tmp/routes-after.txt
diff /tmp/routes-before.txt /tmp/routes-after.txt
```

Expect collection route names to change shape (`article_comments`, `widget_comments`) and member routes to collapse to a single named `comment`. Any helper that disappeared must be updated at its call sites.

**Check for dead path helpers** left in views and specs:

```bash
grep -rn '_comments_path\|_comment_path' app spec | grep -v 'polymorphic'
```

**Confirm the member-action trap is not present.** After consolidation the concern is applied to several parents, so `params[:commentable_type]` on `/comments/:id` is always the first-drawn parent. Verify no member action reads it:

```bash
grep -n 'commentable_type' app/controllers/comments_controller.rb
```

It should appear only inside the method called by the `%i[index new create]` before_action.

**Specs.** Per-parent request specs collapse into one shared spec that loops over parent types — a strong sign the consolidation is real:

```ruby
RSpec.describe 'Comments', type: :request do
  %i[article widget].each do |parent_type|
    context "on a #{parent_type}" do
      let(:parent) { create(parent_type) }

      it 'lists comments' do
        get polymorphic_path([parent, :comments])
        expect(response).to be_successful
      end
    end
  end
end
```

Delete the old per-parent controller specs once their coverage is represented here. See the `tdd` skill for request and system spec conventions.
