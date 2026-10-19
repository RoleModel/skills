---
name: trace
description: Traces a piece of code to every place its flow starts and down to the data it touches, including calls made from inside installed packages. Use when the user says "trace X", "trace this", "what calls this", "where is this used", "how does this request flow", or "where does this data come from".
metadata:
  triggers: "trace, trace this, what calls this, where is this used, how does this flow, where does this data come from"
---

# Trace

`/trace X` is the whole request. Anything the user adds after the target (a flow, a concern, a layer to focus on) narrows or extends the trace. Otherwise, cover all three directions without being asked:

- **Up** to every real entry point: a user action, route, job, scheduled task, command-line task, or another app's API call. A base class, mixin, or intermediate renderer is a hop, not an entry point. Keep going until a person or a system starts the flow. Tests are not callers.
- **Down** to where it reads or writes data or leaves the process: database, cache, file, external API, rendered output.
- **Sideways** to what fires along the way: callbacks, authorization, events, async handoffs.

Search however you normally would. Before you start, read the project's `AGENTS.md` or `CLAUDE.md` and the docs it links. Project-specific boundaries live there: code stripped from one build, a sibling app that calls in over an API, a closed-source package. Watch for those along with the general gotchas below.

## Gotchas

- **Installed packages call your code.** A framework or library base class often calls a method by its conventional name: a framework invokes a hook or lifecycle method, or a method a base class or mixin expects you to fill in. Searching only the app's own directories misses these, and the trace confidently reports one path when there are several. When a method looks like an override or a hook, search the installed package source too, then search the app for the classes that use that package code.
- **Read the package, don't infer it.** If a hop goes through package code, open it before describing what it does. Even closed-source packages usually ship compiled code you can read. Only call a hop inferred if no source exists, and list it under Gaps.
- **"No other callers" is a claim.** Say where you looked (directories, packages) next to it, so the reader can tell how strong it is.
- **Polymorphism forks the path.** Name the dispatch point, follow the main implementation, and list the others.
- **Registration hides callers.** Code loaded by glob, filename, or a registry (migrations, initializers, handlers, plugins) has no caller by name. Trace from the loader instead.

## Report

In this order:

1. **Stack diagram**, entry at the top and data at the bottom, using real names. `↓` is a synchronous call, `↓ (async)` a job or deferred handoff, `→` a lateral trigger (callback, auth check, event). With several entry points, show one column or block per path.
2. **Files**: one `path:line` per hop.
3. **Walkthrough**: 3–5 sentences on the non-obvious hops, auth points, and side effects.
4. **Gaps**: what was inferred or unsearched, and where you looked for callers. Leave this out if there's nothing to report.
5. **Go deeper**: 2–3 follow-ups specific to this trace.

If the target serves several unrelated flows and the user didn't name one, list them in one line each and ask which to trace.
