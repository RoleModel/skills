# UI/UX

Walk every state the change can put a screen in, in a real browser, at phone
and desktop widths. Report what is broken, then what is hard to use.

## Pick a browser

Use the best browser this host gives you, in this order:

1. The host's built-in browser. In the Claude desktop app, that is its
   built-in browser and preview.
2. A browser tool already connected, such as Claude in Chrome, Playwright MCP,
   or Chrome DevTools MCP.
3. Playwright driven from a script, using a Chromium that is already
   installed.

Don't install a browser if one is already available. Only ever point it at
`localhost` or a URL the user gave you, never staging or production.

## Boot and sign in

Boot and seed with the Commands file you were given. Create the data each
state needs with the project's seeds, its test data builders, or the UI
itself.
Sign in as each role the change affects. Look for dev credentials in seeds and
docs.

If you can't boot the app or sign in after a few honest attempts, stop and
return `ui-ux: blocked`, saying exactly what is missing (a command,
credentials, a service). Don't guess around it.

## Build the state matrix before opening the browser

From the diff, list every route and screen it touches, then every state each
one can be in. Read the template conditionals, controller branches,
client-side controller state, and partial-page responses to find them:

- No records, one record, many records (pagination, long lists).
- Validation errors (each field the change validates) and server errors.
- Each role or permission the change checks, including the one that is denied.
- Long and awkward content: long names, missing optional fields, and unbroken
  strings.
- Every partial-page update and every client-side interaction, before and
  after.
- Loading, disabled, and already-submitted states for forms and buttons.

Walk only what the change can affect. Return the matrix with your findings so
the orchestrator can re-walk single rows after fixes.

## Walk it

For each state, at **390×844** and **1440×900**:

- **It works**: the action completes, the right thing renders, and nothing
  appears in the browser console or the server log. Partial-page updates
  target elements that are rendered, client-side controllers release what
  they attach, and a form keeps what the user typed after a validation
  failure.
- **It fits**: no unintended sideways scroll, nothing overflowing or clipped,
  and touch targets usable at the phone width. A wide table meant to scroll
  inside its container is fine.
- **It's reachable**: you can finish the flow with the keyboard alone, focus
  is visible, and labels and errors are announced. Run axe-core if you can
  inject it.
- **It reads right**: once it works, judge it against the UX review skill in
  `Also read`, if you were given one. Read only the heuristics and laws that
  match what you saw.

Confirm each finding the way a user meets it: click, type, and submit, then
look at what renders. A DOM property or a passing spec doesn't settle it either
way. An input can report itself invalid on a form that submits fine, and a spec
can pass while the error never reaches the screen.

When behavior depends on something the test setup fakes, such as a job
backend's concurrency or retries, mail delivery, or a cache store, trigger it
in the running app and read its log.

Take a screenshot as evidence for every finding.

## Severity

A state that doesn't work, a crash, a dead end, or a flow keyboard users can't
finish is `high`; `critical` only when it loses data. A layout break at one
width is `high`. Usability findings from the UX review skill map Critical →
`high`, Major → `medium`, Minor and Advisory → `low`. Taste with no rule
behind it isn't a finding.

## Not this principle

Spacing, color, and component choices follow the project's design system.
That is the conventions principle's call.
