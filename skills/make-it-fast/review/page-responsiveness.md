# Page responsiveness

Find where a page the change touches is slow to show, slow to respond, or
gives no sign it heard the user. Load each changed page in a browser, picked the way
`make-it-right`'s `test/ui-ux.md` says, and use the network panel or
`performance` API for numbers.

## Look for

- **No feedback**: a click or submit that shows nothing for more than about
  100ms. Disable the button while the request runs and show a loading state.
  Optimistic UI for actions that almost always succeed.
- **Repeat requests**: search, filter, or autosave inputs that send a request
  per keystroke. Debounce them.
- **Below the fold**: frames and images loaded up front that the user has to
  scroll to see. Use `loading: :lazy` on Turbo frames and images.
- **Layout shift**: images and embeds with no width and height, so the page
  jumps as they load.
- **Expensive partials**: a partial rendered many times that does real work
  each time. Fragment-cache it, keyed on what changes it.
- **Bundle size**: a new JavaScript dependency, or an import that pulls in a
  whole library for one function. Report the size it adds.
- **Navigation**: links the user will very likely click next, where Turbo
  prefetch would help, and pages that opt out of Turbo with no reason.

## Not this principle

Server time before the first byte goes to requests and queries.
