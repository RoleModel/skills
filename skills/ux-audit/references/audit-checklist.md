# UX/UI Audit Checklist

9 audit categories with grep patterns and heuristics for static code analysis.

## 1. Design Token Consistency

**What to find**: Hardcoded values that should use design tokens.

### Grep Patterns (run on `.scss`, `.css`, `.less`, `.jsx`, `.tsx`, `.vue`, `.svelte`)

| Pattern | What it finds |
|---------|--------------|
| `#[0-9a-fA-F]{3,8}\b` | Hex colors |
| `rgba?\(` | RGB/RGBA color functions |
| `hsla?\(` (not inside `var()`) | HSL/HSLA literals |
| `(padding\|margin\|gap).*\d+px` | Hardcoded spacing |
| `font-size:\s*\d` | Hardcoded font sizes |
| `box-shadow:` (not followed by `var(`) | Literal shadows |
| `border-radius:` (not followed by `var(`) | Literal radii |
| `(width\|height\|top\|left\|right\|bottom):\s*\d+px` | Hardcoded dimensions |

### Exclusions
- Lines starting with `//` or inside `/* */` blocks
- Values inside variable declarations (defining tokens is fine)
- `1px` borders (intentional thin lines)
- Values inside `node_modules/`, `vendor/`, `.git/`
- `0px` (zero is universal)

### Detection: Mixed Token Systems
- Count CSS custom properties: `--[a-z][\w-]*:` in `:root` or `html`
- Count SCSS variables: `\$[a-z][\w-]*:` declarations
- Flag if BOTH systems exist (parallel token problem)
- Check if tokens are actually USED: search for `var(--` and `\$[a-z]` references

## 2. Accessibility

### Focus Management
| Pattern | Issue | WCAG |
|---------|-------|------|
| `outline:\s*(none\|0)` without `:focus-visible` nearby | Keyboard focus removed | 2.4.7 Focus Visible |
| No `<a[^>]*skip` in layout templates | Missing skip-nav link | 2.4.1 Bypass Blocks |
| No `<main` element in layout | Missing main landmark | 1.3.1 Info and Relationships |

### ARIA
| Pattern | Issue | WCAG |
|---------|-------|------|
| `role="menu"` on `<nav` or nav element | Incorrect role (should be navigation) | 4.1.2 Name, Role, Value |
| Button/toggle without `aria-expanded` | Missing state announcement | 4.1.2 |
| `<button` or `role="button"` without text content and no `aria-label` | Unlabeled button | 4.1.2 |
| `<img` without `alt` | Missing alt text | 1.1.1 Non-text Content |
| `<iframe` without `title` | Missing iframe title | 4.1.2 |
| Modal/dialog without `role="dialog"` | Unlabeled dialog | 4.1.2 |
| Modal without `aria-modal="true"` | Screen reader can escape modal | 4.1.2 |

### Semantic HTML
| Pattern | Issue | WCAG |
|---------|-------|------|
| `<a[^>]*><button` or `<button[^>]*><a` | Nested interactive elements | 4.1.1 Parsing |
| `<div[^>]*onClick` without `role` and `tabindex` | Non-semantic interactive | 4.1.2 |
| `user-scalable=no` or `maximum-scale=1` in `<meta name="viewport"` | Zoom disabled | 1.4.4 Resize Text |

### Forms
| Pattern | Issue | WCAG |
|---------|-------|------|
| `<input` without `<label` association or `aria-label` | Unlabeled input | 1.3.1, 4.1.2 |
| `<select` with `<option` placeholder not `disabled` | Selectable placeholder | Best practice |
| No `aria-required` or `required` on required fields | Missing required indicator | 3.3.2 Labels or Instructions |

## 3. Typography

### What to Check
- Collect all unique `font-size` values across the codebase
- Check if a type scale exists (consistent multiplier between sizes)
- Verify heading hierarchy: are h1, h2, h3, h4, h5, h6 all styled?
- Check `line-height` consistency (are values from a scale or arbitrary?)
- Check `font-weight` usage (are they using named weights or arbitrary numbers?)
- Check `font-family` declarations (how many different fonts?)

### Red Flags
- More than 8 unique font-size values (no scale discipline)
- Only h2 styled (other headings unstyled/missing)
- Mixed units: some `rem`, some `px`, some `em` for font-size
- `html { font-size: 62.5% }` trick with mixed px/rem elsewhere

## 4. Color System

### What to Check
- Extract all unique colors (hex, rgb, hsl) from stylesheets
- Group colors by hue to identify redundant near-duplicates
- Check for semantic naming (is `#c62828` called `$error` or just used inline?)
- Check if dark mode is supported (any `prefers-color-scheme` media queries?)

### Foreground / Background Pairing (on / on-alt tokens)

**Every hardcoded color has a semantic role that maps to a token variant:**

| CSS Property Context | Token Role | Design System Variant |
|---------------------|------------|----------------------|
| `background-color`, `background`, `fill` | Background | **Base** scale (`primary-base`, `plus-one`, etc.) |
| `color` on elements with colored background | Foreground text | **On** tokens (`primary-on-base`, `on-plus-one`) |
| `color` for captions, placeholders, muted text | Secondary foreground | **On Alt** tokens (`primary-on-base-alt`, `on-plus-one-alt`) |
| `border-color`, `outline-color` | Border/accent | **Base** scale or semantic `border` token |
| `fill`, `stroke` on SVG icons | Icon color | **On** tokens (same as text) |

**Pairing rule**: If a `background-color` uses a base token, the `color` on that element (or its children) MUST use the corresponding `on` token — not a hardcoded value. This guarantees WCAG-compliant contrast in both light and dark modes.

### What to Flag
- `background: #HEX` paired with `color: #HEX` on same/child element — both should be tokens
- `color:` with `rgba(0,0,0,0.6)` or similar opacity — should be an `on-alt` token
- `::placeholder` color — should be an `on-alt` token
- Any `color:` that's a near-duplicate of a `background-color:` (low contrast risk)

### WCAG Contrast (reference)
- Normal text (< 18px or < 14px bold): 4.5:1 minimum
- Large text (>= 18px or >= 14px bold): 3:1 minimum
- UI components and graphical objects: 3:1 minimum

## 5. Spacing & Layout

### What to Check
- Collect all unique padding, margin, gap values
- Check if they follow a scale (multiples of 4px or 8px)
- Look for magic numbers (one-off pixel values like `left: 300px`)
- Check grid system usage (CSS Grid, Flexbox patterns)
- Look for absolute positioning that should be relative/flex

### Red Flags
- More than 15 unique spacing values (no scale)
- `left: 300px` or similar magic position numbers
- Mixing `margin` and `padding` inconsistently on similar components

## 6. Shadows & Borders

### What to Check
- Collect all `box-shadow` definitions
- Check if they're from a scale or unique per component
- Collect all `border-radius` values
- Check for consistency across similar components (cards, modals, dropdowns)

### Red Flags
- More than 4 unique shadow definitions without a named scale
- Border-radius values like `3px`, `4px`, `5px`, `6px` (no discipline)
- `border: 1px solid [hardcoded-color]` everywhere

## 7. Component Patterns

### Modals
- Has focus trap? (search for `focusTrap`, `inert`, tab key handling)
- Escape-to-close? (search for `Escape` or `keyCode === 27`)
- Returns focus to trigger on close?
- Has `role="dialog"` and `aria-modal`?
- Multiple modal systems coexisting? (Rails global vs React portals)

### Buttons
- How many visual variants? (primary, secondary, ghost, destructive, link)
- Are sizes consistent? (sm, md, lg from a scale?)
- Icon-only buttons have labels?
- Loading/disabled states exist?

### Forms
- Inline validation or submit-only?
- Error messages associated with fields? (`aria-describedby`)
- Consistent error styling?
- Focus management on error (does focus move to first error?)

### Confirmation Dialogs
- Native `confirm()` vs custom modal?
- Destructive actions guarded by confirmation?
- Clear primary/secondary button distinction?

## 8. Responsive / Mobile

### What to Check
- Inventory all `@media` breakpoints
- Search for `display: none` in media queries (hiding vs adapting)
- Check viewport meta tag for mobile support
- Look for horizontal scrolling issues (fixed widths on mobile)
- Touch target sizes (buttons/links >= 44px on mobile?)

### Red Flags
- Only 1 breakpoint (no tablet range)
- Dozens of features hidden via `display: none` on mobile
- No mobile-specific adaptations (just hiding things)
- `width: 100vw` causing horizontal scroll

## 9. Migration Effort Estimation

Compute from findings:

### Minimal Theme Swap (2-3 days)
- Install target design system package
- Set brand color variables (3-5 overrides)
- Override font-family
- Map existing CSS vars to target equivalents
- Leave component SCSS untouched

### Progressive Replacement (2-3 weeks)
- Week 1: Theme swap + Buttons + Forms + Modals
- Week 2: Navbar + Sidebar + Cards + Tables
- Week 3: Alerts, Tooltips, Spinner, remaining
- Delete old SCSS as each component migrates
- Test per-phase, merge per-phase

### Full Replacement (4-6 weeks)
- Delete all custom SCSS except domain-specific (e.g., canvas)
- Replace all hardcoded values
- Refactor components to target design system markup
- Address all audit findings
- Rework integration-specific styling

### Effort Signals
- **Files to touch**: count of files with hardcoded values
- **Token coverage**: % of current values that map to target system
- **Component overlap**: how many custom components have target equivalents
- **Accessibility debt**: count of WCAG violations to fix
