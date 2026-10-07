# Review preferences

<!--
Read by the code-review-dev skill before it writes a reading guide. Plain prose
is fine; the skill reads this as guidance, not config. Edit it any time.
Lives at ~/.claude/code-review-dev/preferences.md. A repo can add its own
.claude/code-review-dev.md, which is read after this file and wins on conflicts.
-->

## Overview (step 1)

- Diagrams: {{"only for complex flows" | "whenever more than ~3 objects interact" | "none"}}
- Feature checks: {{e.g. "edge cases and undo/redo only", "include permission checks", "3-5 max"}}
- Shape: {{e.g. "call out any file that grows past 300 lines", "flag logic in views"}}

## How I like files grouped

- Order: {{e.g. "start with the domain model change, then its callers, then UI, then tests"}}
- Tests: {{"next to the code they cover" | "in their own group after the code" | "first, as the spec"}}
- Group size: {{e.g. "no more than ~6 files per group; split by feature, not by layer"}}
- Put last: {{e.g. "generated files, renames, lint fallout"}}

## Auto-review

- Appetite: {{"off" | "conservative" | "aggressive"}}
- Small means at most {{15}} changed lines in the file.
- Never auto-review, beyond the skill's defaults: {{e.g. "anything under app/policies", "SQL"}}
- Always fine to auto-review: {{e.g. "import reorders", "copy changes in locale files"}}

## Suggested comments

- {{"Only point out bugs and risky changes" | "also style and naming" | "none, I'll write my own"}}
- Tone: {{e.g. "questions rather than instructions", "terse"}}

## Submitting

- Default verdict: {{"Comment" | "Approve" | "Request changes"}}
- {{anything else, e.g. "always include a one-line summary"}}
