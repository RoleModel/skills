# Paged-Document Handoff

A UX audit becomes more useful when the findings can leave the working session as a durable artifact. The `/ux-audit` flow owns discovery, evidence, and synthesis. `paged-document` owns the polished document: structure, branded components, voice review, layout QA, and PDF export.

This handoff happens **after findings have been reviewed and prioritized**, and **before** the team treats the output as finished collateral.

```text
/ux-audit scan + heuristics
        ↓
reviewed findings + recommendation
        ↓
paged-document handoff
        ↓
outline → HTML → QA → PDF
```

## When to Hand Off

Use the handoff when the audit has enough substance to become a document someone may read later without the auditor in the room.

Hand off to `paged-document` when:

- the audit has confirmed findings, not only raw observations;
- the audience is known;
- the next move is clear enough to explain;
- the work needs a durable branded artifact, not only a slide deck or ticket comment.

Do **not** hand off yet when the audit is still exploratory, findings have not been reviewed, or the designer is still deciding whether the opportunity is worth pursuing.

## Source Material to Gather First

Before opening the paged-document workflow, gather one compact source packet:

1. **Audience and document purpose**
   - internal team, partner-facing, or reference/playbook;
   - why this document exists and what decision it should support.

2. **Audit context**
   - product or workflow audited;
   - audit date;
   - relevant product links, screenshots, or recordings;
   - source repo or artifact locations.

3. **Reviewed findings**
   - confirmed findings only;
   - grouped themes or lenses;
   - priority order;
   - what should stay internal if the final document is partner-facing.

4. **Evidence**
   - screenshots;
   - metrics or counts from the code scan;
   - concrete examples;
   - links to any Figma concepts, demos, or deployed artifacts.

5. **Recommendation**
   - the next move: park, pursue, or graduate;
   - why that next move matters;
   - any sequencing, such as first sprint / later work.

6. **Artifact inventory**
   - raw audit output;
   - finished report or deck;
   - Figma file;
   - demo repo;
   - published URL;
   - anything missing that future readers should know about.

## Handoff Prompt

Use this prompt when the source packet is ready:

```text
Use the paged-document workflow to turn this UX audit source packet into a branded RoleModel document.

Document type: [report / guide / reference]
Audience: [internal team / partner / future designers]
Prepared for: [name]
Purpose: [what this document should help the reader understand or decide]

Source material:
- Audit context: [brief summary]
- Reviewed findings: [themes, priorities, supporting evidence]
- Recommendation: [park / pursue / graduate, with reasoning]
- Supporting artifacts: [screenshots, Figma, demo, published links]

Requirements:
- Start by producing a document outline for approval.
- Use only confirmed findings.
- Follow the RoleModel paged-document workflow: planning, approved components, voice review, layout QA, and PDF export.
- Keep internal-only material out of partner-facing versions.
- Preserve links or references back to the source artifacts so the reasoning stays inspectable.
```

## Expected Outputs

A complete handoff produces:

```text
<document-name>-outline.md   # approved structure before HTML generation
<document-name>.html         # paged-document artifact
<document-name>.pdf          # exported final copy
```

For audit projects kept in `rolemodel-ux-audit-projects`, use clear names such as:

```text
AUDIT-OUTLINE.md
AUDIT.html
AUDIT.pdf
```

If the audit run becomes a reusable example for future designers, create a separate playbook set instead of overloading the audit document:

```text
PLAYBOOK.md
PLAYBOOK-OUTLINE.md
PLAYBOOK.html
PLAYBOOK.pdf
```

## What Good Looks Like

A good handoff preserves the full line of reasoning:

- the audit explains what was observed;
- the document explains what matters and why;
- the recommendation tells the reader what to do next;
- the linked artifacts let a future designer inspect the evidence rather than trust a summary on faith.

Past audits in `rolemodel-ux-audit-projects/project-audits/` demonstrate the full chain:

- `INITIAL-AUDIT.html`
- `AUDIT-REPORT.html`
- `AUDIT-OUTLINE.md`
- `AUDIT.html`
- `AUDIT.pdf`
- `PLAYBOOK.md`
- `PLAYBOOK-OUTLINE.md`
- `PLAYBOOK.html`
- `PLAYBOOK.pdf`

That run confirms the handoff can produce a branded paged-document artifact from a farming task while keeping the raw audit trail available for later review.
