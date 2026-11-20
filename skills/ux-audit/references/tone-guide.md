# Tone Guide: Internal vs Client Audience

Every finding, summary, and recommendation must be written in the tone appropriate to the audience. The same technical issue is described completely differently depending on who reads the report.

## Audience Modes

### Internal Mode (`"audience": "internal"`)

**Who reads it**: The development team, tech lead, or internal stakeholders who built or maintain the project.

**Tone**: Direct, specific, actionable. Name exact files, line numbers, and code patterns. Use severity labels that communicate urgency. Be honest about what's broken — the team needs to know.

**Severity labels**: Critical, High, Medium, Pattern

**Structure**: Severity-based grouping with implementation details.

### Client Mode (`"audience": "client"`)

**Who reads it**: External clients, product owners, or non-technical stakeholders who commissioned the project or are evaluating its quality.

**Tone**: Constructive, respectful, opportunity-focused. Frame everything as "here's how we can make this even better." Never imply the project was built poorly — instead, focus on evolution, modernization, and what's possible now. Acknowledge the solid foundation that exists. The partners are emotionally invested in the work — respect that.

**Structure**: **Then / Now / Next** narrative arc with findings organized by **4 thematic lenses**, NOT severity. See [team-guide.md](team-guide.md) for the complete philosophy.

**Key principle**: "Not a bug report. A magazine."

---

## The "Then / Now / Next" Frame (Client Mode)

### Then — Honor the Original Work

Genuinely acknowledge what the product accomplished and the constraints it was built under. This is not faint praise — it's real recognition.

- What were the constraints at the time? Budget, timeline, tech landscape?
- What did it accomplish? What works well?
- Say this genuinely. Partners can tell when praise is formulaic.

### Now — Name What's Changed

User expectations, technology, and the competitive landscape have evolved. This isn't criticism — it's context. Findings are organized by 4 thematic lenses:

1. **Experience Gaps** — Where users have to work harder than they should. Ask: "Where does this product fight the user?"
2. **Visual & Brand Coherence** — Design inconsistencies that accumulate over time. Frame as: "there's an opportunity to make this feel like one cohesive, modern product again."
3. **Modernization Moments** — Table-stakes improvements that have emerged since the original design (WCAG, mobile, component systems). Partners respond well because these are concrete and familiar.
4. **Strategic Opportunities** — Where the product is constrained by old design decisions that are actually solvable now. This section should feel generative — a glimpse of v-next, not a punch list.

### Next — The Opportunity

This is where the energy goes. Show a direction and make people lean forward.

- Explicit invitation to explore together
- Starting a conversation, not closing a sale
- What could phase one look like? What questions would we want to explore?

---

## Finding Format (Client Mode)

Every finding pairs two things:

1. **"What we observed"** — Factual, specific, grounded in behavior
2. **"What this means for users"** — The human impact

```html
<div class="finding">
  <div class="finding-observed">The "Start Over" button uses the browser's native
    confirmation dialog, which is easy to dismiss without reading.</div>
  <div class="finding-means">Users working quickly in the editor could accidentally
    reset their entire drawing with a single misclick.</div>
  <div class="finding-tag ux">Interaction Quality</div>
</div>
```

**Never say** "this looks outdated." **Say** "there's an opportunity to make this feel like one cohesive product again."

---

## Language Transformation Rules

### Executive Summary

| Internal | Client |
|----------|--------|
| "Two parallel token systems, neither complete" | "The codebase has a strong foundation of design variables that can be unified into a single, more maintainable system" |
| "135+ hardcoded values scattered across 20+ files" | "There's an opportunity to consolidate styling values into a centralized design token system, improving consistency and enabling future theming" |
| "7 critical accessibility violations" | "We've identified 7 accessibility improvements that would bring the application into full WCAG AA compliance" |
| "No single source of truth exists" | "Centralizing the existing style definitions into one system would simplify maintenance and enable features like dark mode" |
| "Font sizes are inconsistent" | "Adopting a type scale would bring visual rhythm and hierarchy to the typography across the application" |

### Finding Titles (Observed / Means)

| Internal Finding | Client "Observed" | Client "Means" |
|----------|--------|--------|
| "outline:none kills keyboard focus" | "The application removes the browser's default focus indicator" | "Keyboard users cannot see which element is currently focused" |
| "nav role='menu' is incorrect ARIA" | "Navigation elements use a generic role attribute" | "Screen reader users may not hear the correct landmark announcement" |
| "No canvas empty state for new projects" | "New projects open to a blank workspace with no guidance" | "First-time users must discover the workflow on their own" |
| "'Start Over' uses native window.confirm()" | "The 'Start Over' button uses the browser's default confirmation dialog" | "Users may accidentally reset work, and the dialog feels disconnected from the app" |
| "Two parallel token systems" | "The codebase uses two different variable systems side by side" | "Visual inconsistencies can drift in as each system evolves independently" |

---

## UX Principles Language (Client Mode)

**NEVER use academic law names** in client reports. Clients won't recognize them.

| Academic Name | Plain-Language Equivalent |
|---------------|--------------------------|
| Jakob's Law | Familiar patterns reduce learning time |
| Postel's Law | Support multiple input methods |
| Peak-End Rule | First impressions shape perception |
| Hick's Law | Fewer choices, faster decisions |
| Fitts's Law | Important actions need prominent placement |
| Aesthetic-Usability Effect | Polish builds trust |
| Doherty Threshold | Fast feedback keeps users engaged |
| Zeigarnik Effect | Progress indicators motivate completion |
| Miller's Law | Group related items to reduce cognitive load |
| Law of Proximity | Related controls should be visually grouped |
| Tesler's Law | Absorb complexity so users don't have to |
| Goal-Gradient Effect | Users accelerate near the finish line |

---

## Words to Avoid (Client Mode)

Never use these words in client-facing reports:

| Avoid | Use Instead |
|-------|-------------|
| broken | can be improved |
| bug | area for improvement |
| wrong | could be updated |
| bad | opportunity to enhance |
| poor | can be strengthened |
| ugly | can be refined |
| missing (judgmental) | adding X would... |
| fail / failure | does not yet meet / opportunity to achieve |
| problem / issue | area for improvement / observation |
| unfortunately | currently |
| should have / should be | we recommend / consider |
| needs to be fixed | can be addressed |
| technical debt | modernization opportunity |
| inconsistent | can be unified |
| scattered | can be consolidated |
| hack / workaround | interim solution |
| outdated | opportunity to modernize |

---

## Client Report Structure

| Section | Purpose |
|---------|---------|
| **Executive Summary** | One page, shareable upward. 3 stats + narrative paragraph + callout |
| **Then** | Honor original work. 4-6 genuine strengths. Green section. |
| **Now** | Findings by 4 thematic lenses, each with "observed" + "means" cards |
| — Experience Gaps | Where users work harder than they should |
| — Visual & Brand Coherence | Type scale, color palette, design consistency |
| — Modernization Moments | WCAG, mobile, component system, keyboard nav |
| — Strategic Opportunities | What it could do that it doesn't today |
| UX Principles Assessment | 8-12 plain-language principles, pass/opportunity/attention |
| **Next** | Roadmap cards, component opportunities, "What's Next" invitation |
