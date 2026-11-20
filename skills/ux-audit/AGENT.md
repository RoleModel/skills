# UX Audit Agent

An autonomous agent configuration for running `/ux-audit` without interactive input. Useful for running audits on new projects, integrating into project onboarding, or re-running audits after significant changes.

---

## What the Agent Does

The agent runs in a project directory and executes the full `/ux-audit` skill workflow:

1. Detects tech stack and scans for hardcoded CSS values
2. Maps values to the target design system (Optics MCP if available)
3. Runs static accessibility analysis
4. Generates the audit report (reveal.js slide deck, Figma canvas, or scrollable HTML)
5. Optionally publishes to Vercel/Netlify/Surge and generates DTCG token JSON only when requested or configured

At the end it reports the output file path, published URL, and any Figma URLs.

---

## Shell Agent

The simplest form. Uses the Claude Code CLI in non-interactive mode. Supports both **interactive** (prompted) and **headless** (all args) modes.

```bash
# Interactive — prompts for project dir, audience, format, phase
./scripts/run-audit-agent.sh

# Headless — all arguments provided (for CI/automation)
./scripts/run-audit-agent.sh ~/Development/my-app --client --reveal
./scripts/run-audit-agent.sh ~/Development/my-app --internal scan
./scripts/run-audit-agent.sh . --client --figma

# Publishing — interactive prompts for provider and project name
./scripts/publish-report.sh
```

When run without arguments, both scripts prompt with colored output and sensible defaults — just press Enter to accept defaults.

See [scripts/run-audit-agent.sh](scripts/run-audit-agent.sh) and [scripts/publish-report.sh](scripts/publish-report.sh) for implementations.

---

## Agent Configuration

Configure the agent using standard environment variables and the tool list below. The agent is model- and provider-agnostic — use whichever LLM and API client your project uses.

### System prompt

```
You are running a UX audit on a web project. Follow the /ux-audit skill exactly.
Complete all phases without asking for confirmation. Write findings based only on
what you observe in the code — never fabricate. NEVER create or inject CSS — copy
the template HTML and its companion CSS file verbatim into the output directory.
The only style you may add is a single :root { --accent } override.

Output format (from .ux-audit.json "format" field):
- "reveal" → Use references/revealjs-template/index.html plus the bundled
  audit-kit.js, reveal-audit-theme.css, local-fonts.css, RMS-lcon.svg, and fonts/. Compose
  content with the provided web components; do not recreate deck CSS. Supports
  PDF via ?print-pdf.
- "figma" → Write directly to Figma canvas via use_figma. MUST load figma-use skill
  first. Duplicate the template at figma.templateKey, populate section by section.
  See references/figma-workflow.md for the complete workflow.
- "html" → Scrollable HTML + companion CSS. Copy both files unchanged.

Image sourcing:
- Cover image + client logo: web scrape from brand.portfolioUrl (look for
  data-framer-background-image-wrapper elements on Framer portfolio pages)
- Section screenshots: use mcp__figma__get_screenshot when figma.fileKey is configured
- Embed as base64 data URIs for self-contained deployment, or external URLs

Token JSON rule:
- Phase 2 token mapping is always useful as audit evidence.
- Do not generate light.tokens.json/dark.tokens.json by default.
- Generate DTCG token JSON only when .ux-audit.json has tokens.generate=true, the user explicitly asks for Figma Variables import files, or the deliverable includes a formal token migration artifact.
- If skipped, report: "Token JSON skipped — mapping documented in report; no importable token artifact requested."

When done, report the output file path, published URL (if any), Figma URLs, and whether token JSON was generated or skipped.
```

### User message

```
/ux-audit --client --reveal
```

Or for a specific phase:

```
/ux-audit scan --internal
```

For Figma canvas output:

```
/ux-audit --client --figma
```

To publish after generating:

```
/ux-audit publish
```

### Required tools

The audit is primarily read-only. Provide these tools to the agent:

```
# Codebase access (read-only)
Read, Glob, Grep

# Report output (write to outputDir only)
Write

# Token generation + HTTP server + publishing
Bash(node:*), Bash(npx:*), Bash(python3:*), Bash(mkdir:*), Bash(lsof:*), Bash(open:*), Bash(curl:*)

# Design system token lookup + contrast checking
mcp__optics__search_tokens
mcp__optics__suggest_token_migration
mcp__optics__check_contrast
mcp__optics__list_components
mcp__optics__get_component_tokens
mcp__optics__get_token
mcp__optics__validate_token_usage

# Figma — design inspection + canvas write + report export
mcp__figma__get_design_context
mcp__figma__get_screenshot
mcp__figma__get_metadata
mcp__figma__use_figma              # Direct canvas write (MUST load figma-use skill first)
mcp__figma__search_design_system   # Discover components, variables, styles
mcp__figma__create_new_file        # Duplicate template for new audits
mcp__figma__generate_figma_design  # HTML-to-Figma fallback
mcp__figma__get_variable_defs

# Web scraping — cover images, client logos, case study context
WebFetch, WebSearch

# Skills — must be loaded before specific tool calls
Skill(figma-use)                   # MANDATORY before every use_figma call
Skill(figma-generate-design)       # For section-by-section Figma assembly
```

### Settings

```
max_turns: 80      # Full audit with all phases needs room to work
cwd: <project-dir> # Set to the project root before invoking
```

---

## Recommended Permissions

The only writes the agent makes:
- `.ux-audit.json` — config, created on first run if missing
- `{outputDir}/ux-audit-report.html` — the report (HTML/reveal format)
- `{outputDir}/report-template*.css` — companion CSS file copied verbatim (HTML format only, never modified)
- `{outputDir}/light.tokens.json` + `dark.tokens.json` — optional DTCG token files (Phase 6 only, generated only when the token artifact rule applies)
- Figma canvas writes via `use_figma` (Figma format only — writes to a duplicated template file)
- Published URL output (optional, when `/ux-audit publish` is invoked)

For fully autonomous runs, scope `Write` to `{outputDir}/*` and `.ux-audit.json` only.

---

## Autonomous vs. Interactive

| Mode | When to use |
|------|-------------|
| **Interactive** (`/ux-audit` in Claude Code) | First run on a new project, reviewing findings at each phase, iterating on report design |
| **Autonomous** (shell script or SDK) | Re-running after code changes, CI integration, onboarding a new project to a standard audit baseline |

For the first run on any project, interactive mode is preferred — the agent will ask about audience, design system, and Figma preferences before creating `.ux-audit.json`. After that config exists, autonomous runs work cleanly.

---

## CI Integration Example

```yaml
# .github/workflows/ux-audit.yml
name: UX Audit
on:
  workflow_dispatch:
    inputs:
      audience:
        description: "Audience mode"
        default: "internal"
        type: choice
        options: [internal, client]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run UX Audit
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npx @anthropic-ai/claude-code \
            --print \
            --dangerously-skip-permissions \
            "/ux-audit --${{ inputs.audience }}"
      - uses: actions/upload-artifact@v4
        with:
          name: ux-audit-report
          path: dev-tools/ux-audit-output/
```
