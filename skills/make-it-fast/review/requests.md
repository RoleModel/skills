# Requests

Find where a request or job the change touches spends time it doesn't need
to. Hit each changed endpoint locally and read its log line: total time, and
the split between views and the database. Profile the slow ones with the
project's profiler if it has one (`rack-mini-profiler`, `stackprof`).

## Look for

- **Work a user waits on that they don't need**: email, PDFs, exports,
  webhooks, or third-party calls done in the request. Move them to a job and
  tell the user it's on its way.
- **External calls**: a call with no timeout, a call inside a transaction
  (holding locks while waiting on the network), or a call in a loop.
- **Bulk writes**: `create` or `update` in a loop where `insert_all` /
  `upsert_all` / `update_all` would do one query. Note that those skip
  validations and callbacks, and say whether that matters here.
- **Repeated work**: the same lookup or calculation done more than once per
  request. Memoize it in the object for the request's life.
- **Turbo streams**: a stream that re-renders a whole list when one item
  changed.
- **Large exports**: a CSV or report built in memory in the request. Stream it
  or build it in a job.
- **Caching**: only where the same expensive work repeats across requests and
  the work can't be made cheaper. Name what expires the cache.

## Not this principle

Query count and shape go to queries. What the browser does after the response
goes to page responsiveness.
