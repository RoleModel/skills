# Severity Classification Model

Classify every audit finding into one of four severity levels. Each finding gets a unique ID within its level.

## Levels

### Critical (C)

**Definition**: WCAG Level A/AA violations, functional bugs that prevent task completion, or data loss risks.

**Impact**: Blocks production launch or creates legal liability. Must fix before shipping.

**Examples**:
- Missing `alt` text on informational images (WCAG 1.1.1)
- No keyboard focus indicator anywhere (WCAG 2.4.7)
- Form submissions that lose user data without warning
- `user-scalable=no` preventing zoom on mobile (WCAG 1.4.4)
- Color contrast ratio below 3:1 on interactive elements (WCAG 1.4.11)

**ID format**: C1, C2, C3...

### High (H)

**Definition**: UX quality issues that degrade the experience significantly — broken visual hierarchy, missing confirmation dialogs on destructive actions, no empty states, inconsistent navigation.

**Impact**: Users can complete tasks but with confusion, frustration, or risk of accidental data loss. Fix within the current sprint/release.

**Examples**:
- Delete buttons with no confirmation dialog
- Missing empty states (blank screens when no data)
- Inconsistent heading hierarchy (h1 → h4, skipping h2/h3)
- Modal dialogs without focus trap (keyboard users can tab behind)
- Icon-only buttons with no accessible label

**ID format**: H1, H2, H3...

### Medium (M)

**Definition**: Maintainability and consistency issues — hardcoded values that should use tokens, missing type scale discipline, magic numbers, inconsistent spacing.

**Impact**: Slows down future development, creates visual inconsistency, makes theming/rebranding harder. Fix during dedicated cleanup or migration work.

**Examples**:
- 47 unique hex colors when the design system has 19 scale steps
- `padding: 13px` (not on any spacing scale)
- Mixed `rem` and `px` units for font sizes
- `left: 300px` magic positioning numbers
- 6 different `box-shadow` definitions with no naming convention

**ID format**: M1, M2, M3...

### Pattern (P)

**Definition**: Cross-cutting issues that appear in 3+ places. A pattern finding groups related individual findings into a systemic observation.

**Impact**: Indicates a structural or convention problem, not a one-off mistake. Addressing the pattern fixes many individual issues at once.

**Examples**:
- "All 12 form inputs use hardcoded `#ccc` border instead of a token"
- "Every modal implements its own backdrop — no shared modal component"
- "Confirmation dialogs use native `confirm()` in 8 places"
- "Spacing values cluster around 8px multiples but with ±1-2px drift in 15 files"

**ID format**: P1, P2, P3...

## Finding Format

Every finding must include:

```
ID: [C1|H3|M5|P2]
Title: [Short descriptive title]
Detail: [2-3 sentences explaining the issue and its impact]
Location: [file_path:line_number] or [N files, list top 3]
WCAG: [criterion number and name, if applicable]
Token: [target design system token, if applicable]
```

### Example Findings

```
ID: C1
Title: Focus outlines removed globally with no replacement
Detail: `outline: none` is applied to all focusable elements via a global
  reset, but no `:focus-visible` styles exist anywhere in the codebase.
  Keyboard users cannot see which element is focused.
Location: app/javascript/stylesheets/base/_reset.scss:14
WCAG: 2.4.7 Focus Visible (Level AA)
Token: --op-color-primary-base (suggested focus ring color)
```

```
ID: H2
Title: Delete project has no confirmation dialog
Detail: Clicking "Delete" on the project settings page immediately sends a
  DELETE request with no confirmation. Users who accidentally click lose
  their entire project with no undo.
Location: app/javascript/components/ProjectSettings.jsx:89
WCAG: N/A
Token: N/A
```

```
ID: M7
Title: 23 unique hex colors outside the design system palette
Detail: The codebase uses 23 distinct hex color values that don't map to any
  token in the target design system. Many are near-duplicates (e.g., #333,
  #2C2C2C, #3A3A3A are all dark grays).
Location: 14 files (top: variables.scss:5, header.scss:12, sidebar.scss:8)
WCAG: N/A
Token: --op-color-neutral-minus-six (closest match for dark grays)
```

```
ID: P1
Title: Hardcoded spacing values cluster around 8px grid but with drift
Detail: 89% of spacing values are within 2px of an 8px multiple, but 15
  files use off-grid values like 13px, 18px, 22px. This suggests the team
  intends an 8px grid but lacks enforcement.
Location: 15 files (top: layout.scss:23, cards.scss:45, forms.scss:12)
WCAG: N/A
Token: --op-space-sm (8px), --op-space-md (16px), --op-space-lg (24px)
```

---

## Client Mode: Alternate Labels & Finding Format

When `audience` is `"client"`, use softer labels and restructured findings.

### Label Mapping

| Internal | Client | CSS class |
|----------|--------|-----------|
| Critical (C) | Required (R) | `.required` |
| High (H) | Recommended (RC) | `.recommended` |
| Medium (M) | Enhancement (E) | `.enhancement` |
| Pattern (P) | Observation (O) | `.observation` |

### Client Finding Format

```
ID: [R1|RC3|E5|O2]
Title: [Opportunity-focused title — what can be improved, not what's wrong]
Detail: [2-3 sentences framing the improvement and its user/business benefit]
Benefit: [1 sentence: what the user or business gains]
UX Law: [Relevant Law of UX from lawsofux.com, if applicable]
WCAG: [criterion, only for Required items]
Design System: [how the target system provides the solution]
```

**Never include**: file paths, line numbers, code snippets, or technical implementation details in client findings. The client report focuses on what and why, not where and how.

### Client Finding Examples

```
ID: R1
Title: Enhance keyboard navigation experience
Detail: Adding custom focus indicators would ensure all users can navigate the
  application effectively, regardless of input method. Modern CSS provides
  elegant solutions that show focus rings only during keyboard use, maintaining
  the clean visual design during mouse interaction.
Benefit: Improves accessibility compliance and usability for all navigation styles
UX Law: Postel's Law — support multiple input modes
WCAG: 2.4.7 Focus Visible (Level AA)
Design System: Includes accessible focus styles out of the box
```

```
ID: RC2
Title: Add confirmation for high-impact actions
Detail: Actions that significantly change project state can be enhanced with
  in-app confirmation dialogs that match the application's visual design. This
  provides users with a safety net while maintaining workflow continuity.
Benefit: Reduces risk of accidental data changes and increases user confidence
UX Law: Goal-Gradient Effect — users accelerate near completion and may click too fast
WCAG: N/A
Design System: ConfirmDialog component with accessible keyboard support
```

```
ID: E5
Title: Consolidate color values into a unified system
Detail: The application's styling can be streamlined by consolidating color
  definitions into a centralized token system. This would enable features
  like dark mode support and make future brand updates a single-line change.
Benefit: Simplifies maintenance and enables theming capabilities
UX Law: Aesthetic-Usability Effect — visual cohesion increases perceived quality
WCAG: N/A
Design System: Provides a complete color scale with automatic dark mode
```

```
ID: O1
Title: Opportunity to standardize spacing rhythm
Detail: The application's layout already follows an approximate 8px grid in most
  areas. Formalizing this into a spacing token system would bring perfect visual
  rhythm and make layout decisions faster for the development team.
Benefit: Creates consistent visual rhythm and accelerates future development
UX Law: Law of Prägnanz — consistent spacing creates visual order
WCAG: N/A
Design System: 11-step spacing scale from 2px to 80px
```

---

## Severity Scoring

When computing migration effort, weight findings:

| Level | Weight | Typical fix time per instance |
|-------|--------|-------------------------------|
| Critical | 4 | 30-60 min (requires testing) |
| High | 3 | 15-30 min |
| Medium | 1 | 5-10 min (often bulk find/replace) |
| Pattern | 2 | 1-2 hours (systemic fix) |

**Effort formula**: `Σ(finding_count × weight × fix_time_minutes) / 60 = estimated_hours`

This is a rough guide — actual effort depends on codebase familiarity, test coverage, and whether the fix is a simple token swap or a structural refactor.
