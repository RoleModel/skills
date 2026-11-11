#!/usr/bin/env bash
#
# publish-report.sh
#
# Deploys a UX audit report to a public URL as a static site.
#
# Usage:
#   ./publish-report.sh                                          # Interactive mode
#   ./publish-report.sh [output-dir] [--provider vercel|netlify|surge|github-pages] [--name project-name] [--title catalog-title] [--summary catalog-summary] [--scope vercel-team]
#
# Examples:
#   ./publish-report.sh
#   ./publish-report.sh dev-tools/ux-audit-output
#   ./publish-report.sh dev-tools/ux-audit-output --provider netlify
#   ./publish-report.sh dev-tools/ux-audit-output --provider vercel --name my-app-ux-audit
#   ./publish-report.sh /path/to/report --provider github-pages --name widgetco --title "Widget Co Opportunity Assessment" --projects-repo ~/Development/ux-audits/rolemodel-ux-audit-projects --commit --push
#
# Prerequisites:
#   - Node.js installed (for npx)
#   - For Vercel: authenticated via `npx vercel login` or VERCEL_TOKEN env var
#   - For Netlify: authenticated via `npx netlify-cli login` or NETLIFY_AUTH_TOKEN env var
#   - For Surge: authenticated via `npx surge login`
#   - For GitHub Pages: rolemodel-ux-audit-projects checkout with push access
#

set -euo pipefail

# --- Colors ---
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

prompt() {
  local message="$1"
  local default="$2"
  local varname="$3"
  printf "${BLUE}${BOLD}  %s${RESET} ${GREEN}[%s]${RESET}${BLUE}: ${RESET}" "$message" "$default"
  read -r input
  eval "$varname=\"${input:-$default}\""
}

prompt_choice() {
  local message="$1"
  local options="$2"
  local default="$3"
  local varname="$4"
  printf "${BLUE}${BOLD}  %s${RESET} ${DIM}(%s)${RESET} ${GREEN}[%s]${RESET}${BLUE}: ${RESET}" "$message" "$options" "$default"
  read -r input
  eval "$varname=\"${input:-$default}\""
}

# --- Header ---
echo ""
printf "${CYAN}${BOLD}  ╔══════════════════════════════════════════╗${RESET}\n"
printf "${CYAN}${BOLD}  ║       UX Audit Report Publisher          ║${RESET}\n"
printf "${CYAN}${BOLD}  ║   Deploy your report to a public URL     ║${RESET}\n"
printf "${CYAN}${BOLD}  ╚══════════════════════════════════════════╝${RESET}\n"
echo ""

# --- Auto-detect defaults from .ux-audit.json ---
AUTO_OUTPUT_DIR="dev-tools/ux-audit-output"
AUTO_PROJECT_NAME="assessment"
AUTO_CATALOG_TITLE=""
AUTO_CATALOG_SUMMARY="Published UX audit artifacts."
AUTO_PROJECTS_REPO="$HOME/Development/ux-audits/rolemodel-ux-audit-projects"

# Keep the publisher current when it is used against the external projects repo.
# The projects repo is intentionally separate so project artifacts do not bloat the
# lightweight skill checkout, but publishing should still run from the latest skill
# implementation when possible.
PROJECTS_REPO_NAME="rolemodel-ux-audit-projects"
SKILL_REPO_NAME="skills"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

if [ -f .ux-audit.json ]; then
  DETECTED_DIR=$(python3 -c "import json; print(json.load(open('.ux-audit.json')).get('outputDir', ''))" 2>/dev/null || echo "")
  if [ -n "$DETECTED_DIR" ]; then
    AUTO_OUTPUT_DIR="$DETECTED_DIR"
  fi

  DETECTED_BRAND=$(python3 -c "import json; print(json.load(open('.ux-audit.json')).get('brand', {}).get('name', ''))" 2>/dev/null || echo "")
  DETECTED_PUBLISH_NAME=$(python3 -c "import json; print(json.load(open('.ux-audit.json')).get('publish', {}).get('projectName', ''))" 2>/dev/null || echo "")
  DETECTED_CATALOG_TITLE=$(python3 -c "import json; print(json.load(open('.ux-audit.json')).get('publish', {}).get('catalogTitle', ''))" 2>/dev/null || echo "")
  DETECTED_CATALOG_SUMMARY=$(python3 -c "import json; print(json.load(open('.ux-audit.json')).get('publish', {}).get('catalogSummary', ''))" 2>/dev/null || echo "")
  if [ -n "$DETECTED_PUBLISH_NAME" ]; then
    AUTO_PROJECT_NAME=$(echo "$DETECTED_PUBLISH_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g')
  elif [ -n "$DETECTED_BRAND" ]; then
    # Default: "{brand}-assessment" — clean, client-facing URL
    AUTO_PROJECT_NAME=$(echo "$DETECTED_BRAND-assessment" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g')
  fi
  if [ -n "$DETECTED_CATALOG_TITLE" ]; then
    AUTO_CATALOG_TITLE="$DETECTED_CATALOG_TITLE"
  elif [ -n "$DETECTED_BRAND" ]; then
    AUTO_CATALOG_TITLE="$DETECTED_BRAND Assessment"
  fi
  if [ -n "$DETECTED_CATALOG_SUMMARY" ]; then
    AUTO_CATALOG_SUMMARY="$DETECTED_CATALOG_SUMMARY"
  fi
fi

if [ -z "$AUTO_CATALOG_TITLE" ]; then
  AUTO_CATALOG_TITLE="$AUTO_PROJECT_NAME Audit"
fi

# --- Publish context sync ---
if [[ "$PWD" == *"/$PROJECTS_REPO_NAME"* ]] || [[ "${1:-}" == *"/$PROJECTS_REPO_NAME/"* ]]; then
  if git -C "$SKILL_REPO_ROOT" diff --quiet && git -C "$SKILL_REPO_ROOT" diff --cached --quiet; then
    printf "${DIM}  Publishing from the projects catalog. Syncing the skill repo first...${RESET}\n"
    git -C "$SKILL_REPO_ROOT" pull --ff-only
    echo ""
  else
    printf "${YELLOW}  ⚠  Skill repo has local changes; skipping automatic git pull before publish.${RESET}\n"
    printf "${DIM}     Finish or stash local work in the skill repo if you need the latest publisher.${RESET}\n"
    echo ""
  fi
fi

# --- Interactive or headless ---
if [ $# -eq 0 ]; then
  # Interactive mode
  printf "${DIM}  Answer the prompts below. Press Enter to accept defaults.${RESET}\n"

  if [ -f .ux-audit.json ]; then
    printf "${DIM}  (Detected .ux-audit.json - using auto-detected values)${RESET}\n"
  fi
  echo ""

  prompt "Output directory" "$AUTO_OUTPUT_DIR" OUTPUT_DIR
  prompt_choice "Deploy provider" "vercel, netlify, surge, github-pages" "github-pages" PROVIDER
  prompt "URL slug" "$AUTO_PROJECT_NAME" PROJECT_NAME
  if [ "$PROVIDER" = "github-pages" ]; then
    prompt "Catalog title" "$AUTO_CATALOG_TITLE" CATALOG_TITLE
    prompt "Catalog summary" "$AUTO_CATALOG_SUMMARY" CATALOG_SUMMARY
    prompt "Projects repo" "$AUTO_PROJECTS_REPO" PROJECTS_REPO
    PUBLISH_COMMIT="false"
    PUBLISH_PUSH="false"
  fi
else
  # Headless mode - parse arguments
  OUTPUT_DIR=""
  PROVIDER="vercel"
  PROJECT_NAME=""
  CATALOG_TITLE=""
  CATALOG_SUMMARY=""
  CATALOG_TITLE_SET="false"
  VERCEL_SCOPE=""
  PROJECTS_REPO=""
  PUBLISH_COMMIT="false"
  PUBLISH_PUSH="false"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --provider)
        PROVIDER="$2"
        shift 2
        ;;
      --provider=*)
        PROVIDER="${1#*=}"
        shift
        ;;
      --name)
        PROJECT_NAME="$2"
        shift 2
        ;;
      --name=*)
        PROJECT_NAME="${1#*=}"
        shift
        ;;
      --scope)
        VERCEL_SCOPE="$2"
        shift 2
        ;;
      --scope=*)
        VERCEL_SCOPE="${1#*=}"
        shift
        ;;
      --title)
        CATALOG_TITLE="$2"
        CATALOG_TITLE_SET="true"
        shift 2
        ;;
      --title=*)
        CATALOG_TITLE="${1#*=}"
        CATALOG_TITLE_SET="true"
        shift
        ;;
      --summary)
        CATALOG_SUMMARY="$2"
        shift 2
        ;;
      --summary=*)
        CATALOG_SUMMARY="${1#*=}"
        shift
        ;;
      --projects-repo)
        PROJECTS_REPO="$2"
        shift 2
        ;;
      --projects-repo=*)
        PROJECTS_REPO="${1#*=}"
        shift
        ;;
      --commit)
        PUBLISH_COMMIT="true"
        shift
        ;;
      --push)
        PUBLISH_PUSH="true"
        shift
        ;;
      -*)
        printf "${YELLOW}  Unknown option: %s${RESET}\n" "$1" >&2
        exit 1
        ;;
      *)
        OUTPUT_DIR="$1"
        shift
        ;;
    esac
  done

  # Apply auto-detected defaults for unset values
  if [ -z "$OUTPUT_DIR" ]; then
    OUTPUT_DIR="$AUTO_OUTPUT_DIR"
  fi
  if [ -z "$PROJECT_NAME" ]; then
    PROJECT_NAME="$AUTO_PROJECT_NAME"
  fi
  if [ -z "$CATALOG_TITLE" ]; then
    CATALOG_TITLE="$AUTO_CATALOG_TITLE"
  fi
  if [ "$CATALOG_TITLE_SET" = "false" ] && [ "$AUTO_CATALOG_TITLE" = "assessment Audit" ]; then
    CATALOG_TITLE=$(PROJECT_NAME="$PROJECT_NAME" python3 - <<'PY'
import os
name = os.environ["PROJECT_NAME"].replace("-", " ").replace("_", " ")
print(" ".join(part[:1].upper() + part[1:] for part in name.split()) + " Audit")
PY
)
  fi
  if [ -z "$CATALOG_SUMMARY" ]; then
    CATALOG_SUMMARY="$AUTO_CATALOG_SUMMARY"
  fi
fi

if [ "${PROVIDER:-}" = "github-pages" ] && [ -z "${PROJECTS_REPO:-}" ]; then
  PROJECTS_REPO="$AUTO_PROJECTS_REPO"
fi
if [ "${PROVIDER:-}" = "github-pages" ] && [ -z "${CATALOG_TITLE:-}" ]; then
  CATALOG_TITLE="$AUTO_CATALOG_TITLE"
fi
if [ "${PROVIDER:-}" = "github-pages" ] && [ -z "${CATALOG_SUMMARY:-}" ]; then
  CATALOG_SUMMARY="$AUTO_CATALOG_SUMMARY"
fi

if [ -z "${VERCEL_SCOPE:-}" ] && [ -f .ux-audit.json ]; then
  DETECTED_SCOPE=$(python3 -c "import json; print(json.load(open('.ux-audit.json')).get('publish', {}).get('scope', ''))" 2>/dev/null || echo "")
  if [ -n "$DETECTED_SCOPE" ]; then
    VERCEL_SCOPE="$DETECTED_SCOPE"
  fi
fi

# --- Validate report exists ---
REPORT_FILE="$OUTPUT_DIR/ux-audit-report.html"
# Also check for index.html (the audits repo convention)
if [ ! -f "$REPORT_FILE" ] && [ -f "$OUTPUT_DIR/index.html" ]; then
  REPORT_FILE="$OUTPUT_DIR/index.html"
fi
if [ ! -f "$REPORT_FILE" ]; then
  echo ""
  printf "${YELLOW}  ✗ Report not found at %s${RESET}\n" "$OUTPUT_DIR" >&2
  printf "${YELLOW}    Run /ux-audit report first to generate it.${RESET}\n" >&2
  exit 1
fi

# --- Check prerequisites ---
check_vercel_auth() {
  printf "${DIM}  Checking Vercel setup...${RESET}\n"

  # Check if Vercel CLI is available
  if ! command -v vercel &>/dev/null && ! npx -y vercel --version &>/dev/null 2>&1; then
    printf "${YELLOW}  ⚠  Vercel CLI not found. Installing...${RESET}\n"
    npm install -g vercel 2>/dev/null || npx -y vercel --version >/dev/null 2>&1
    printf "${GREEN}  ✓  Installed.${RESET}\n"
  fi

  # Check if authenticated
  if ! npx -y vercel whoami &>/dev/null 2>&1; then
    echo ""
    printf "${YELLOW}  ⚠  Not authenticated with Vercel.${RESET}\n"
    echo ""
    printf "${BOLD}  To log in, you'll need your Vercel credentials.${RESET}\n"
    printf "${DIM}  These are in 1Password — search for \"Vercel\".${RESET}\n"
    printf "${DIM}  (Or ask your team lead for access.)${RESET}\n"
    echo ""
    printf "${BOLD}  Run this command, then re-run the publish script:${RESET}\n"
    echo ""
    printf "${CYAN}    npx vercel login${RESET}\n"
    echo ""
    exit 1
  fi

  VERCEL_USER=$(npx -y vercel whoami 2>/dev/null)
  printf "${GREEN}  ✓  Authenticated as ${BOLD}%s${RESET}\n" "$VERCEL_USER"
}

if [ "$PROVIDER" = "vercel" ]; then
  check_vercel_auth
fi
echo ""

# --- Summary ---
printf "${CYAN}${BOLD}  ── Deploy Configuration ───────────────────${RESET}\n"
printf "${BOLD}  Report:   ${RESET}%s\n" "$REPORT_FILE"
printf "${BOLD}  Provider: ${RESET}%s\n" "$PROVIDER"
if [ "$PROVIDER" = "github-pages" ]; then
  printf "${BOLD}  URL:      ${RESET}https://rolemodel.github.io/rolemodel-ux-audit-projects/%s\n" "$PROJECT_NAME"
  printf "${BOLD}  Repo:     ${RESET}%s\n" "$PROJECTS_REPO"
  printf "${BOLD}  Catalog: ${RESET}%s\n" "$CATALOG_TITLE"
else
  printf "${BOLD}  URL slug: ${RESET}%s.vercel.app\n" "$PROJECT_NAME"
fi
if [ -n "${VERCEL_SCOPE:-}" ]; then
  printf "${BOLD}  Scope:    ${RESET}%s\n" "$VERCEL_SCOPE"
fi
printf "${CYAN}  ─────────────────────────────────────────────${RESET}\n"
echo ""

# --- Create deploy directory ---
DEPLOY_DIR=$(mktemp -d)
trap 'rm -rf "$DEPLOY_DIR"' EXIT

# Copy report as index.html
cp "$REPORT_FILE" "$DEPLOY_DIR/index.html"

# Copy all assets alongside the report (images, video, CSS, SVGs)
for ASSET in "$OUTPUT_DIR"/*.{png,jpg,jpeg,webp,mp4,webm,svg,css,js}; do
  [ -f "$ASSET" ] && cp "$ASSET" "$DEPLOY_DIR/"
done

# Copy nested asset directories used by the component-based reveal.js template.
for ASSET_DIR in "$OUTPUT_DIR"/fonts; do
  [ -d "$ASSET_DIR" ] && cp -R "$ASSET_DIR" "$DEPLOY_DIR/"
done

# --- Deploy ---
case "$PROVIDER" in
  vercel)
    printf "${BOLD}  Deploying to Vercel...${RESET}\n"
    # Link the temporary deploy directory to a stable project before deploying.
    # This keeps repeated publishes attached to the configured client-facing slug.
    VERCEL_SCOPE_ARGS=()
    if [ -n "${VERCEL_SCOPE:-}" ]; then
      VERCEL_SCOPE_ARGS=(--scope "$VERCEL_SCOPE")
    fi
    npx -y vercel link --cwd "$DEPLOY_DIR" --yes --project "$PROJECT_NAME" "${VERCEL_SCOPE_ARGS[@]}" >/dev/null
    VERCEL_OUTPUT=$(npx -y vercel deploy --cwd "$DEPLOY_DIR" --prod --yes "${VERCEL_SCOPE_ARGS[@]}" 2>&1)
    VERCEL_URL=$(echo "$VERCEL_OUTPUT" | grep -oE 'https://[^ ]+\.vercel\.app' | tail -1)
    if [ -n "$VERCEL_URL" ]; then
      echo ""
      printf "${GREEN}${BOLD}  ✓ Live at: ${RESET}${BOLD}${VERCEL_URL}${RESET}\n"
    else
      echo "$VERCEL_OUTPUT"
      printf "${YELLOW}  ⚠  Deploy may have failed. Check output above.${RESET}\n"
    fi
    ;;
  netlify)
    printf "${BOLD}  Deploying to Netlify...${RESET}\n"
    npx -y netlify-cli deploy --prod --dir "$DEPLOY_DIR" --site "$PROJECT_NAME"
    ;;
  surge)
    printf "${BOLD}  Deploying to Surge...${RESET}\n"
    npx -y surge "$DEPLOY_DIR" "${PROJECT_NAME}.surge.sh"
    ;;
  github-pages)
    printf "${BOLD}  Publishing to GitHub Pages catalog...${RESET}\n"

    if [ ! -d "$PROJECTS_REPO/.git" ]; then
      printf "${YELLOW}  ✗ Projects repo not found at %s${RESET}\n" "$PROJECTS_REPO" >&2
      printf "${YELLOW}    Clone RoleModel/rolemodel-ux-audit-projects there or pass --projects-repo.${RESET}\n" >&2
      exit 1
    fi

    if ! git -C "$PROJECTS_REPO" diff --ignore-submodules=all --quiet || ! git -C "$PROJECTS_REPO" diff --cached --ignore-submodules=all --quiet; then
      printf "${YELLOW}  ✗ Projects repo has uncommitted changes; refusing to publish over them.${RESET}\n" >&2
      printf "${DIM}     Repo: %s${RESET}\n" "$PROJECTS_REPO" >&2
      git -C "$PROJECTS_REPO" status --short --ignore-submodules=all >&2
      exit 1
    fi

    DEST_DIR="$PROJECTS_REPO/$PROJECT_NAME/audit"
    mkdir -p "$DEST_DIR"

    SOURCE_DIR="$(cd "$OUTPUT_DIR" && pwd -P)"
    TARGET_DIR="$(cd "$DEST_DIR" && pwd -P)"
    if [ "$SOURCE_DIR" != "$TARGET_DIR" ]; then
      rsync -a --delete \
        --exclude '.git/' \
        --exclude '.DS_Store' \
        --exclude '.env.local' \
        --exclude '.vercel/' \
        "$SOURCE_DIR"/ "$TARGET_DIR"/
    fi

    REPORT_PATH="$(cd "$(dirname "$REPORT_FILE")" && pwd -P)/$(basename "$REPORT_FILE")"
    INDEX_PATH="$TARGET_DIR/index.html"
    if [ "$REPORT_PATH" != "$INDEX_PATH" ]; then
      cp "$REPORT_FILE" "$DEST_DIR/index.html"
    fi
    touch "$PROJECTS_REPO/.nojekyll"

    CATALOG_PATH="$DEST_DIR/catalog.json"
    CATALOG_SLUG="$PROJECT_NAME" \
    CATALOG_TITLE="$CATALOG_TITLE" \
    CATALOG_SUMMARY="$CATALOG_SUMMARY" \
    CATALOG_PATH="$CATALOG_PATH" \
      python3 - <<'PY'
import json
import os
from pathlib import Path

path = Path(os.environ["CATALOG_PATH"])
slug = os.environ["CATALOG_SLUG"]
title = os.environ["CATALOG_TITLE"]
summary = os.environ["CATALOG_SUMMARY"]

if path.exists():
    data = json.loads(path.read_text())
else:
    data = {}

data["slug"] = data.get("slug") or slug
data["title"] = data.get("title") or title
data["summary"] = data.get("summary") or summary
data["status"] = data.get("status") or "Published"

links = data.get("links")
if not isinstance(links, list):
    links = []

audit_href = f"./{slug}/"
has_audit = any(link.get("href") == audit_href for link in links if isinstance(link, dict))
if not has_audit:
    links.insert(0, {"label": "Audit", "href": audit_href})

data["links"] = links
path.write_text(json.dumps(data, indent=2) + "\n")
PY

    if [ -f "$PROJECTS_REPO/scripts/build-index.mjs" ]; then
      (cd "$PROJECTS_REPO" && node scripts/build-index.mjs)
    else
      printf "${YELLOW}  ⚠  Catalog builder not found at %s/scripts/build-index.mjs; index.html was not regenerated.${RESET}\n" "$PROJECTS_REPO" >&2
    fi

    git -C "$PROJECTS_REPO" add .nojekyll index.html "$PROJECT_NAME/audit"

    if git -C "$PROJECTS_REPO" diff --cached --quiet; then
      printf "${DIM}  No catalog changes to commit.${RESET}\n"
    elif [ "$PUBLISH_COMMIT" = "true" ]; then
      git -C "$PROJECTS_REPO" commit -m "Publish ${PROJECT_NAME} audit"
    else
      printf "${YELLOW}  Staged catalog changes but did not commit. Pass --commit to commit automatically.${RESET}\n"
    fi

    if [ "$PUBLISH_PUSH" = "true" ]; then
      git -C "$PROJECTS_REPO" push origin main
    elif [ "$PUBLISH_COMMIT" = "true" ]; then
      printf "${YELLOW}  Committed catalog changes but did not push. Pass --push to push automatically.${RESET}\n"
    fi

    echo ""
    printf "${GREEN}${BOLD}  ✓ GitHub Pages URL: ${RESET}${BOLD}https://rolemodel.github.io/rolemodel-ux-audit-projects/%s${RESET}\n" "$PROJECT_NAME"
    printf "${GREEN}${BOLD}  ✓ Catalog updated: ${RESET}${BOLD}https://rolemodel.github.io/rolemodel-ux-audit-projects/${RESET}\n"
    ;;
  *)
    printf "${YELLOW}  ✗ Unknown provider '%s'. Use: vercel, netlify, surge, or github-pages${RESET}\n" "$PROVIDER" >&2
    exit 1
    ;;
esac

echo ""
printf "${GREEN}${BOLD}  Done.${RESET}\n"
echo ""
