# UX Audit Skill — Development Retrospective

This skill was built from a client engagement. Everything here was earned in practice.

---

## Origin

The project involved a full manual UX audit: scanning the Rails + React codebase for hardcoded values, mapping tokens to @rolemodel/optics, generating Figma design concepts, and writing a client-facing HTML report. The skill packages that workflow so it doesn't have to be rebuilt from scratch each time.

The central insight: **"a magazine, not a bug report."** The client report uses a Then / Now / Next narrative arc, acknowledges what was built well before identifying gaps, and organizes findings by thematic lens rather than by severity. This framing shift changed how the deliverable landed.

---

## What Was Built

### Two audience modes
- **Internal (`--internal`)**: Developer-focused, severity-labeled, file paths and line numbers included
- **Client (`--client`)**: Narrative arc, thematic lenses, no code references, diplomatic tone

Audience mode drives template selection, report structure, finding language, and executive summary framing. It's the most critical config choice.

### Five workflow phases
1. **Scan** — tech stack detection + grep for hardcoded values
2. **Tokens** — map values to target design system (Optics MCP or grep-based)
3. **Accessibility** — static code analysis for WCAG/ARIA violations
4. **Report** — generate HTML report from template + findings
5. **Figma** — push concepts via Figma MCP, generate DTCG token JSON

Each phase is independently invocable (`/ux-audit scan`, `/ux-audit report`, etc.).

### Magazine HTML template
`references/html-template/report-template-magazine.html` is the client-facing deliverable format. It produces 8.5×11 aspect-ratio slides that can be copied directly into Figma. Sections: Cover → Executive Summary → Then → Now (intro + 4 improvement slides) → Color System → Close (recommendations).

### Figma workflow
Use `mcp__figma__generate_figma_design` and `mcp__figma__get_design_context` / `mcp__figma__get_screenshot` from the **Figma MCP** throughout. This is the primary tool for both generating designs and pushing the HTML report into Figma.

---

## What Had to Be Corrected

### 1. SKILL.md YAML frontmatter — `allowed-tools` format
**Problem**: Block sequence format for `allowed-tools` caused a "malformed YAML frontmatter" error.
```yaml
# ❌ doesn't work
allowed-tools:
  - Read
  - "Bash(node:*)"
```
**Fix**: Inline array format.
```yaml
# ✓ works
allowed-tools: [Read, Write, "Bash(node:*)", ...]
```
**Lesson**: Always use inline array for `allowed-tools`.

---

### 2. Content scope — 8 sections with no designs for half
**Problem**: Initial template had 8 principle sections but only 4 improvements had proposed Figma designs (toolbar, settings, wizard, mobile). The rest had no screens.

**Fix**: Removed sections without designs. Only show what you can show — a placeholder for a non-existent design weakens the whole deck.

**Lesson**: Confirm which findings have proposed designs before generating improvement sections.

---

### 3. Language — hedged instead of confident
**Problem**: Stat label read "Proposed screens and ready to review today." Client feedback: "terrible language."

**Fix**: "Areas of improvement shown in this deck, each with a proposed direction." Then later simplified to just "Improvements."

**Lesson**: Client stats should be declarative. Don't hedge with "proposed" or "ready to review" — state what's there.

---

### 4. Close section had questions instead of recommendations
**Problem**: Close section ended with open questions for the client. Wrong for a completed audit — asking questions after you've already done the work is backwards.

**Fix**: Numbered recommendations (01–04) with large orange display numbers. Each is a single confident sentence: action + brief rationale. No body copy.

**Lesson**: The close should make clear recommendations. If the audit is done, state what should happen next.

---

### 5. Text opacity too low throughout
**Problem**: Many text values used very low opacity — `rgba(255,255,255,0.28)`, `0.3`, `0.35`, `0.45)`. Too faint in the Figma output.

**Fix**: Global rule — nothing below 0.6 opacity for text/content elements. Hairline borders (0.08–0.12) are exempt — they're structural, not readable content.

**Lesson**: Set a 60% opacity floor for all text before any Figma export. Bake this into the template.

---

### 6. Report sections needed consistent vertical rhythm
**Problem**: First and last sections (cover, close) had inconsistent internal structure vs the middle sections. Cover used absolute-positioned children; close used flex centering — both caused layout issues when imported into Figma.

**Fix**:
- Cover: merged background image + gradient overlay into a single CSS `background` property (multiple layers). No absolute children.
- Close: `display: grid; align-content: center` for vertical centering.
- All sections: `aspect-ratio: 8.5 / 11; overflow: hidden` for consistent letter-page proportions.

**Lesson**: Consistent structure across all sections makes Figma import predictable. No absolute-positioned children in sections; merge overlays into CSS `background` shorthand.

---

### 7. HTTP server path confusion during Figma export
**Problem**: The capture URL was constructed with the wrong path — the server was rooted at `ux-audit-output/`, so the file was at `localhost:8080/ux-audit-magazine.html`, not `localhost:8080/ux-audit-output/...`. This returned 404.

**Fix**: Check server `cwd` before constructing the URL (`lsof -p PID | grep cwd`).

**Lesson**: Confirm the server's root directory before building the capture URL.

---

## Key Design Principles

### Then / Now / Next arc
The most effective part of the client report.
- **Then**: Genuine recognition — names specific engineering decisions that were good. Not faint praise.
- **Now**: Frames gaps as evolved expectations, not failures. "When this was built, X — today users expect Y."
- **Next**: Generative — a glimpse of what's possible, not a punch list.

### Close with confidence
The close section should drive toward a decision, not reopen the conversation. Use numbered recommendations with big display numbers. The number IS the visual — don't bury it with body copy.

### Optics + Figma MCP is the preferred workflow
Use the Figma MCP (`mcp__figma__*`) throughout: `get_design_context` and `get_screenshot` for inspecting existing designs, `generate_figma_design` for pushing the report. DTCG token JSON feeds Figma Variables for the color system section.

---

## File Map

```
SKILL.md                              # Main skill definition + 5-phase workflow
AGENT.md                              # Autonomous agent configuration
RETROSPECTIVE.md                      # This file
references/
  audit-checklist.md                  # 9 audit categories + grep patterns
  severity-model.md                   # Critical/High/Medium/Pattern classification
  tone-guide.md                       # Language rules for internal vs client mode
  team-guide.md                       # Client audit philosophy + Then/Now/Next arc
  html-template/
    report-template.html              # Internal report template
    report-template.css               # Internal report CSS
    report-template-client.html       # Client report template (Then/Now/Next)
    report-template-client.css        # Client report CSS
    report-template-magazine.html     # Magazine-style client report (current best)
    report-template-magazine.css      # Magazine report CSS
  revealjs-template/
    index.html                        # Reveal.js slide deck entry point
    audit-kit.js                      # Web components (cover, stat, finding, etc.)
    reveal-audit-theme.css            # Reveal.js theme + slide styles
    local-fonts.css                   # Local font face declarations
    RMS-lcon.svg                      # RoleModel icon asset
    fonts/                            # DM Sans + GeistMono font files
    README.md                         # Component documentation
  figma-workflow.md                   # Figma MCP workflow guide
  dtcg-format.md                      # DTCG token JSON spec
scripts/
  generate-figma-variables.mjs        # Optics → DTCG token JSON
  generate-all-tokens.mjs             # Full token generation pipeline
  scan-hardcoded-values.sh            # Grep wrapper for Phase 1 scan
  run-audit-agent.sh                  # Interactive/headless audit runner
  publish-report.sh                   # Vercel/Netlify/Surge publisher
```
