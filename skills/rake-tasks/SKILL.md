---
name: rake-tasks
description: Write Rake tasks in apps that use the rolemodel_rails gem with its `Rolemodel::Utility::TaskTools` mixin, for migration-style console output, a progress spinner, a `DRY_RUN` preview mode, and optional positional arguments. Use when writing or changing a rake task, data backfill, one-off data fix, cleanup or purge job, or dev seed task, or when a task needs a dry run, a preview, progress output, or optional arguments.
metadata:
  triggers: "rake task, lib/tasks, .rake, backfill, data migration, data fix, one-off task, cleanup task, purge, seed task, dry run, DRY_RUN, preview mode, progress, TaskTools, say_with_time, indicate_progress, sanitize_arguments"
---

# Rake Tasks

Apps built with `rolemodel_rails` write rake tasks with `Rolemodel::Utility::TaskTools`, not hand-rolled `puts`, `ENV` flags, or progress printing. Check that `rolemodel-rails` is in the `Gemfile` outside the `development` group, since production tasks need it at runtime. If it's only in `development`, say so rather than moving it silently.

The gem's README is the API documentation: run `bundle info rolemodel-rails --path` and read the `Rolemodel::Utility::TaskTools` section of `README.md` there. This skill doesn't restate it.

## Shape

```ruby
require 'rolemodel/utility/task_tools'

namespace :articles do
  include Rolemodel::Utility::TaskTools

  desc 'Backfill missing slugs (DRY_RUN=true to preview)'
  task backfill_slugs: :environment do
    scope = Article.where(slug: nil)
    total = scope.count

    say_with_time "Backfilling slugs on #{total} Articles" do
      scope.find_each.with_index do |article, index|
        indicate_progress(index, total)
        article.update!(slug: article.title.parameterize) unless dry_run?
      end
    end
  end
end
```

## Rules

- **Preview with `DRY_RUN`, never a flag of your own.** Don't invent `COMMIT=1`, `EXECUTE`, or `--dry-run`. Guard every write to the database, file system, or external service with `unless dry_run?`. Keep the reads and the `say` output outside the guard so the preview reports what the real run would do.
- **Report with `say`, `say_with_time`, and `indicate_progress`.** Don't use `puts`, `print`, a logger, or a custom progress line. Wrap each unit of work in `say_with_time` and put details in `say '...', subitem: true`.
- **Take optional arguments with `sanitize_arguments`, not `args.with_defaults`.** Callers then skip a positional argument with `_` (`rake users:dev[_,jdoe@example.com]`). Document the call in the `desc`.
- **Keep the efficient query.** TaskTools changes only the output. Don't swap `in_batches`/`delete_all` or `update_all` for a `find_each` loop just to call `indicate_progress` per record.

## Gotchas

- **Any value of `DRY_RUN` turns it on**, including `DRY_RUN=false` and `DRY_RUN=0`. Tell people to unset it, not to set it to false.
- **`indicate_progress` counts calls, not rows.** It redraws when `index % report_interval` is zero (default 9). In a batched loop, pass the batch index and the batch count, with `report_interval: 1` when batches are slow:

  ```ruby
  batches = (scope.count / 1_000.0).ceil
  scope.in_batches(of: 1_000).each_with_index do |batch, index|
    indicate_progress(index, batches, report_interval: 1)
    batch.delete_all unless dry_run?
  end
  ```

- **`sanitize_arguments` in rolemodel-rails 2.6.1 and earlier drops any value that contains an underscore**, not just a bare `_`, so `jane_doe@example.com` silently becomes the default. On those versions, read arguments that can contain `_` straight from `args`.
- **A `def` in a `.rake` file is global, even inside a `namespace` block.** Two files that define `helper` share one method, and the file loaded last wins silently. Give helper methods task-specific names. (`include` there likewise lands on `Object`, which is harmless for TaskTools.)
