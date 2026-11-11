# Figma Canvas API Workflow

How to build UX audit reports directly on the Figma canvas using `use_figma` and the Figma Plugin API.

## Overview

- Figma is a first-class output target alongside HTML reveal.js
- The `use_figma` MCP tool executes JavaScript against the Figma Plugin API
- A Figma template file provides the visual structure — the agent populates it with audit content
- The `figma-use` skill **MUST** be loaded before every `use_figma` call
- The `figma-generate-design` skill handles section-by-section assembly

## Figma Template

- **Template file key**: `iyfRvWyTHSbNYtpBcjuvGg`
- **Page name**: "Figma Template & Example Audit"
- Contains three layouts:
  1. **Client scrollable document** — 1921px wide, node `1:1109`
  2. **Client slide deck** — 10 individual 1390px slide frames, node `1:1506`
  3. **Internal technical audit** — 1428px wide, node `8:2474`
- The agent duplicates the template file for each new audit, then replaces placeholder content with real findings

## Workflow Steps

### Step 1: Duplicate Template

Use `create_new_file` or duplicate the template to create a project-specific file. This gives the audit its own Figma file while preserving the original template for reuse.

### Step 2: Discover Design System

Use `search_design_system` to find available components, variables, and styles in the template. This reveals the building blocks (color tokens, text styles, reusable components) that the template provides.

### Step 3: Populate Content Section by Section

Use `use_figma` to manipulate the canvas directly:

- Update text nodes with audit findings
- Set color swatches to the project's actual palette
- Insert screenshots (from `get_screenshot` or web scraping)
- Update stat numbers and labels

> Remember: load the `figma-use` skill before each `use_figma` call.

### Step 4: Screenshot Sourcing

- **Cover image + client logo**: Web scrape from the client's portfolio page (look for `data-framer-background-image-wrapper` elements)
- **Section mockups**: Use `get_screenshot(nodeId, fileKey)` to capture redesign frames from the project's Figma file
- **Current state screenshots**: Capture from `appUrl` using browser automation

### Step 5: Export

- Use `get_screenshot` to export individual slides as PNGs
- Use `export-design` for PDF export
- Link directly to the Figma file for interactive viewing

## HTML Reveal.js (Web Deploy Path)

The HTML reveal.js template remains the primary web-deployable format:

- Images sourced from Figma via `get_screenshot` are embedded as base64 data URIs or external URLs
- Deploy via `publish-report.sh` to Vercel/Netlify/Surge
- PDF export via `?print-pdf` query parameter

## Token JSON Import

DTCG token JSON files (`light.tokens.json`, `dark.tokens.json`) are optional. Generate them only when the user needs importable Figma Variables, the target Figma file does not already contain the needed variables, or the audit deliverable includes a formal token migration artifact. For normal reports, token mapping tables are enough and token JSON should be skipped.

When generated, DTCG token JSON files can be imported into Figma:

1. Open the target Figma file
2. Go to **Local Variables** panel
3. Click the **Import** button
4. Select the token JSON files
5. Choose "Create new collection" or merge into existing

See [dtcg-format.md](dtcg-format.md) for the token file format.

## MCP Tools Reference

| Tool | Purpose |
|---|---|
| `use_figma` | Execute Plugin API JavaScript (MUST load `figma-use` skill first) |
| `get_design_context` | Read node properties and design context |
| `get_metadata` | Get node structure overview |
| `get_screenshot` | Export node as image |
| `search_design_system` | Find components, variables, styles |
| `get_variable_defs` | Read variable definitions |
| `create_new_file` | Create a new Figma file |
