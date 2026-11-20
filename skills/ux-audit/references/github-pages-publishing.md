# GitHub Pages Publishing

GitHub Pages is the default publishing target for static UX audit reports.

This is publishing behavior, not a Google Docs template. The reusable logic belongs in this `/ux-audit` skill repo. The generated output belongs in the sibling `rolemodel-ux-audit-projects` catalog repo.

## Repo responsibilities

### `RoleModel/skills`

Owns reusable workflow code:

- `/ux-audit` skill instructions
- report templates
- publish scripts
- provider-specific publishing behavior

### `rolemodel-ux-audit-projects`

Owns generated artifacts:

- `<project-slug>/audit/`
- static report bundles
- playbooks and supporting artifacts
- `<project-slug>/<demo-slug>/` submodules for interactive prototypes
- `<project-slug>/audit/catalog.json`, the project metadata used to generate the public catalog
- generated root `index.html`, the public catalog at https://rolemodel.github.io/rolemodel-ux-audit-projects/

## URL pattern

```txt
https://rolemodel.github.io/rolemodel-ux-audit-projects/<project-slug>
```

## Intended publish flow

1. Generate the static audit report bundle.
2. Run the publish script with `github-pages` as the provider.
3. Resolve the projects repo path.
4. Copy the report bundle into `<project-slug>/audit/`.
5. Ensure `.nojekyll` exists at the projects repo root.
6. Create or update `<project-slug>/audit/catalog.json`.
7. Rebuild the generated root `index.html` through the projects repo pre-commit hook or `node scripts/build-index.mjs`.
8. Print the final GitHub Pages URL.
9. Commit and push when `--commit --push` are passed.

## Catalog index requirement

The deployed report URL is not enough. Every audit artifact should also be discoverable from the public catalog:

```txt
https://rolemodel.github.io/rolemodel-ux-audit-projects/
```

When adding any artifact to `rolemodel-ux-audit-projects`, put it under `<project-slug>/audit/`. The projects repo pre-commit hook, publish script, and Pages workflow rebuild the root index automatically. The catalog card discovers top-level `.html`, `.pdf`, `.md`, `.mp4`, `.webm`, and `.mov` files and lists them under the same project entry:

- audit report: `/<project-slug>/`
- paged document or PDF: `/<project-slug>/<file-name>.pdf`
- Reveal deck: `/<project-slug>/`
- interactive demo: external Vercel URL or `/<project-slug>/<demo-slug>/`
- playbook or supporting file: the file path under the project folder

Use `<project-slug>/audit/catalog.json` for the project title, summary, status, and links that cannot be discovered from files, such as an external Vercel demo. For follow-up artifacts added later, commit the artifact and regenerated root `index.html` normally. If the local hook is not enabled, run `node scripts/build-index.mjs` before committing.

## Intended command

```sh
./publish-report.sh <output-dir> \
  --provider github-pages \
  --name <project-slug> \
  --title "<Project Name> Opportunity Assessment" \
  --projects-repo ~/rolemodel-ux-audit-projects \
  --commit \
  --push
```

## Vercel boundary

Use GitHub Pages for static audit reports.

Use Vercel for interactive demos, private previews, or prototypes with their own runtime.
