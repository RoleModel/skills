# Writing the Recommendations view (step 2's default)

The code step has two modes, switched in the header or with `r`:
**Recommendations** (the default) and **Code** (the diff). Recommendations is
the change at the height of the reading guide. A reviewer should be able to
follow a large change from here, decide what to say about it, and drop into the
diff only where they want proof. It must feel light even when the code is not:
a few words per group, a picture where one helps, and yes/no decisions instead
of long prose.

Everything here goes in the same `tmp/review/<slug>.groups.json`. The view
reads three things you write, plus the files and counts the page already has.

```json
{
  "groups": [
    { "title": "Who can see order tracking", "why": "Start here: the permission rule changed.",
      "summary": "Distributor admins of a parent org now **bypass the feature flag**, like super admins.",
      "points": ["`view_order?` is gone; `show?` covers list and detail",
                 "The controller finds the order before it authorizes"],
      "files": ["app/policies/order_tracking_policy.rb", "..."] }
  ],
  "recommendations": [
    { "id": "auth", "group": "Who can see order tracking", "kind": "risk",
      "title": "Keep the same-organization check on the order page",
      "context": "The order page used to check that the order belongs to the user's organization.",
      "problem": "Now only the lookup keeps other organizations out, so a change to it would expose orders.",
      "proposal": "Keep an explicit permission check on the order page.",
      "tradeoffs": "One more check per page, against a quiet data leak later.",
      "checks": ["other-org"],
      "visuals": [{ "kind": "compare", "title": "Who guards the order page",
        "before": { "kind": "structure", "nodes": [...], "edges": [...] },
        "after": { "kind": "structure", "nodes": [...], "edges": [...] } }],
      "comments": [
        { "path": "app/controllers/organizations/order_tracking_controller.rb", "line": 18, "body": "..." },
        { "path": "app/policies/order_tracking_policy.rb", "line": 5, "body": "..." }
      ] },
    { "title": "Mention the label change in the release notes", "kind": "question",
      "context": "Customers will see new words on the tracker.",
      "problem": "Should the release notes call it out, or is it too small?" }
  ],
  "overview": { "diagrams": [
    { "kind": "image", "src": "tmp/review/KATT-1/tracker.png", "title": "Tracker after", "group": "Tracker labels" },
    { "kind": "video", "src": "tmp/review/KATT-1/open-order.webm", "title": "Opening an order", "section": "recs" }
  ] }
}
```

## Group gists

Each group card shows its title, `why`, its files as chips (with `+/-` and
viewed state, folded under "N files" since they are not the point of this
view), a link to its code, and what you add:

- **`summary`**: what the group changes, in one or two sentences of Markdown,
  in product or domain words. Not a list of files or methods.
- **`points`**: up to four short bullets, one line each, for the facts a
  reviewer needs to trust the group: what moved, what was removed, which rule
  changed. Inline code with backticks is fine. Skip points that only restate
  the summary.

Keep the whole card readable in about ten seconds. If a group needs more than
that, it needs a diagram, not more words. A small mechanical group can have
neither: its why line and file chips are enough.

## Visuals

Diagrams pinned to a group (`"group": "<title>"`) show on its card, side by
side when there are several. `"section": "recs"` puts a visual at the top of
the view, for the one picture of the whole change. See
`references/overview.md` for the diagram kinds. Two more kinds carry media:

- **`image`**: a screenshot or GIF (`png`, `jpg`, `gif`, `webp`, `svg`). Click
  to enlarge.
- **`video`**: a screen recording (`webm`, `mp4`, `mov`), muted, looping, with
  controls.

`src` is a path relative to the current directory or to the groups file. The
build inlines it as a data URL, so the page stays one offline file; it warns
over 8 MB a file and fails over 60 MB in total. Keep clips short (5 to 20
seconds) and crop screenshots to the part that changed.

Reach for a visual when it saves reading: a UI change (before and after
screenshots in a `compare`, or a short recording of the flow), a flow through
several objects (`sequence`), responsibility moving (`structure` with new and
removed nodes), geometry (`svg`). One or two good visuals per complex group;
none for a simple one.

### Capturing screenshots and recordings

Only capture when the change has something to see, and the app can run. Save
captures under `tmp/review/<slug>/`.

- **Playwright** (preferred when the project has it, or `npx playwright`):
  `page.screenshot({ path, clip })` for a still, and
  `browser.newContext({ recordVideo: { dir, size } })` for a recording; the
  video is saved as `.webm` when the context closes. Drive the flow the change
  touches, at the head commit, and at the base too when a before/after helps.
- **Claude in Chrome** (when the extension is connected and the user is
  logged in to the app): take screenshots of the flow, or record it with
  `gif_creator` as a GIF, then pass the saved file as an `image`.
- If the app can't run (no seed data, secrets, a service down), say so in your
  report and use diagrams instead. Never block the review on a capture.

## Recommendations

A recommendation is one decision you want the reviewer to make, phrased as an
action: "Keep the same-organization check", "Extract the label map", "Add a
spec for a user from another org". The reviewer answers **Yes** or **No**.

- **From comments to recommendations.** Write the comments you would leave,
  then group them by the call they ask for. Three comments that all say the
  permission check got weaker are one recommendation with three `comments`.
  A comment that stands alone is a recommendation with one comment. It is not
  one to one, and usually several comments fold into one.
- **`comments`** have the same shape as `suggestions` (`path`, `line`,
  `start_line`, `side`, `body`) and are checked against the diff the same way.
  A yes puts them all in the review as line comments, and they also show
  inline in the Code mode as suggested comments. A no leaves them out.
- **No comments**: a general point (release notes, a follow-up ticket, a
  question about scope). A yes adds `body`, or else `title: why`, to the review
  summary under **Recommendations**.
- **`group`**: the group title it belongs to, so it shows on that card. Leave
  it out for points that span the change; they show first, under "Across the
  change".
- **`kind`**: `bug`, `risk`, `design`, `tests`, `style` or `question`. It is
  shown as a tag, so pick the honest one.
- **`title`** is the action in under about ten words. The comments carry the
  detail.
- **Sections**: **one sentence each, two at most**, so the reviewer can
  decide at a glance without opening the comments. Write them for someone who
  knows the product but hasn't read the code: say what the user or the data
  goes through, not which method calls which. Leave class and method names,
  line numbers and code to the `comments`, where the code is shown next to
  them; a single name in backticks is fine when it is the subject. The build
  warns about a section over two sentences. They show as a small grid under
  the title:
  - **`context`**: what is there now, or what the code is for;
  - **`problem`**: what is wrong or missing;
  - **`proposal`**: what to do about it;
  - **`tradeoffs`**: the cost of doing it, or the pros and cons of the options.

  The `kind` decides which sections show, and renames some:

  | kind | sections |
  | --- | --- |
  | `bug` | context, problem, proposal (shown as **Fix**) |
  | `risk` | context, problem (shown as **Risk**), proposal, tradeoffs |
  | `design` | context, problem, proposal, tradeoffs |
  | `tests` | context, problem (shown as **Gap**), proposal |
  | `style` | context, proposal, tradeoffs |
  | `question` | context, problem (shown as **Question**), tradeoffs |

  Write only the ones the kind shows; the build warns about the rest and the
  page hides them. Skip a section rather than pad it. A recommendation with no
  sections falls back to **`why`**, one line on what makes it worth doing.
- **`visuals`**: diagrams or media for this recommendation, in the same format
  as anywhere else (`references/overview.md`). Use one when the point is a
  shape or a flow: a `compare` of the structure before and after the change
  you are proposing, a `sequence` showing where a check goes missing, a
  screenshot of the state the bug produces. A picture there often lets the
  sections stay one sentence.
- **`checks`**: ids of feature checks (`overview.feature.checks`, each with an
  `id`) that this recommendation bears on, such as a check that a user from
  another organization gets a 404 next to the recommendation to keep the
  organization check. They show on the recommendation, with their Looks right
  / Concern buttons; they still show in the overview too, and both share one
  answer. Link only where the check would confirm or settle the
  recommendation. Marking a linked check **Concern** says yes to the
  recommendation if it is still open (it says so on the card); taking the
  concern back undoes that yes, unless the reviewer has decided it themselves
  since. A recommendation already decided is never changed by a check.
- **`principle`**: the section of a shared guide this recommendation rests
  on: `{ "guide": "code-review-principles.md", "section": "Keep changes
  focused" }`, or the short form `"code-review-principles.md#Keep changes
  focused"`. `guide` is a file name from the guides `REVIEW.md` lists (or a
  full `owner/repo: path`); `section` matches a heading, ignoring case and
  numbering. The build copies that section into the page, folded under the
  recommendation, so the reviewer can read the standard itself; it comes from
  the cache `review-guides.cjs` filled, so run that first. Name a principle
  only when the recommendation really follows from it; a recommendation that
  stands on judgement alone is fine without one. A yes on a general
  recommendation adds the principle's name to the summary line, and the
  decisions log records it, so `decision-patterns.cjs` can tell which
  principles a reviewer keeps declining.

Follow the user's suggested-comments preference here too: the same bar
decides what becomes a recommendation. No recommendations is a fine answer for
a clean change. Bare `suggestions` still work, and each shows as its own
recommendation, titled from its first line; put them in `recommendations`
instead whenever two or more ask for the same thing.

## What the reviewer sees

- In this mode, progress is decisions, not lines: the sidebar's percentage,
  bar and remaining count, the group counts in the file list, and each card's
  "decided" count all track recommendations. A group is done once every
  recommendation on it is decided. The Code mode keeps its line-based progress,
  and the sidebar links across to it ("Code read").
- Pressing the lit button again takes a decision back. Taking back a yes keeps
  any comment the reviewer edited since.
- Each comment under **The comments** has its own buttons: **Accept**,
  **Edit** (an editor opens in place; saving puts it in the review) and
  **Dismiss**, then **Edit** / **Remove** once in the review, or **Restore**
  once dismissed. Its file path (and the `file:line` chips above it) open the
  diff at that line.
- Deciding comments one by one, or a yes and a later edit or dismiss in the
  Code mode, shows the recommendation as partly accepted ("2 of 3 comments in
  your review").
- The submit page lists every recommendation with its decision, and the open
  ones link back here. The review JSON and Markdown carry the decisions, so an
  agent reading a saved review knows what was accepted.
