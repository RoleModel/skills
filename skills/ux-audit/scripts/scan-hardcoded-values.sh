#!/usr/bin/env bash
#
# scan-hardcoded-values.sh — Find hardcoded CSS values in a web project.
# Outputs a JSON summary suitable for the UX audit report.
#
# Usage:
#   ./scan-hardcoded-values.sh [--path <dir>] [--extensions "scss,css,jsx,tsx"] [--json]
#
# Options:
#   --path        Directory to scan (default: current directory)
#   --extensions  Comma-separated file extensions (default: scss,css,jsx,tsx,slim,erb,html)
#   --json        Output as JSON instead of human-readable text
#   --exclude     Comma-separated directories to exclude (default: node_modules,vendor,dist,tmp)

set -euo pipefail

# Defaults
SCAN_PATH="."
EXTENSIONS="scss,css,jsx,tsx,slim,erb,html"
EXCLUDES="node_modules,vendor,dist,tmp,.git,coverage,public/assets,public/packs"
JSON_OUTPUT=false

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --path)       SCAN_PATH="$2"; shift 2 ;;
    --extensions) EXTENSIONS="$2"; shift 2 ;;
    --exclude)    EXCLUDES="$2"; shift 2 ;;
    --json)       JSON_OUTPUT=true; shift ;;
    -h|--help)
      echo "Usage: scan-hardcoded-values.sh [--path <dir>] [--extensions <exts>] [--exclude <dirs>] [--json]"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Build ripgrep include/exclude flags
RG_INCLUDES=""
IFS=',' read -ra EXT_ARR <<< "$EXTENSIONS"
for ext in "${EXT_ARR[@]}"; do
  RG_INCLUDES="$RG_INCLUDES --glob '*.${ext}'"
done

RG_EXCLUDES=""
IFS=',' read -ra EXCL_ARR <<< "$EXCLUDES"
for dir in "${EXCL_ARR[@]}"; do
  RG_EXCLUDES="$RG_EXCLUDES --glob '!${dir}/**'"
done

# Temporary file for collecting results
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# ── Scan functions ───────────────────────────────────────────────────

scan_category() {
  local label="$1"
  local pattern="$2"
  local extra_flags="${3:-}"

  local count
  count=$(eval "rg --no-heading --count-matches $extra_flags '$pattern' $RG_INCLUDES $RG_EXCLUDES '$SCAN_PATH' 2>/dev/null" | awk -F: '{s+=$NF} END {print s+0}')

  local files
  files=$(eval "rg --no-heading --count-matches $extra_flags '$pattern' $RG_INCLUDES $RG_EXCLUDES '$SCAN_PATH' 2>/dev/null" | wc -l | tr -d ' ')

  echo "$label|$count|$files" >> "$TMPFILE"
}

echo "Scanning $SCAN_PATH for hardcoded CSS values..."
echo ""

# ── Color tokens (base / on / on-alt semantic roles) ─────────────────

# Background colors → maps to BASE scale tokens
scan_category "BG hex colors" 'background(-color)?:\s*#[0-9a-fA-F]{3,8}'
scan_category "BG rgb/hsl" 'background(-color)?:\s*(rgb|rgba|hsl|hsla)\(' '-i'
scan_category "BG named colors" 'background(-color)?:\s*(white|black|red|blue|green|gray|grey|orange|yellow|purple)\b' '-i'

# Foreground/text colors → maps to ON tokens
scan_category "FG hex colors" '[^-]color:\s*#[0-9a-fA-F]{3,8}'
scan_category "FG rgb/hsl" '[^-]color:\s*(rgb|rgba|hsl|hsla)\(' '-i'
scan_category "FG named colors" '[^-]color:\s*(white|black|red|blue|green|gray|grey|orange|yellow|purple)\b' '-i'

# Fill/stroke (SVG) → maps to ON or BASE tokens
scan_category "SVG fill/stroke" '(fill|stroke):\s*#[0-9a-fA-F]{3,8}'

# Border colors → maps to BASE or semantic border token
scan_category "Border colors" 'border[^:]*:\s*[0-9]+px\s+\w+\s+#'
scan_category "Border-color" 'border-color:\s*#[0-9a-fA-F]{3,8}'

# Placeholder/muted text → maps to ON-ALT tokens
scan_category "Placeholder colors" '(::placeholder|::-webkit-input-placeholder).*color' '-i'
scan_category "Opacity text" 'color:.*rgba\([^)]*,\s*0\.[0-9]' '-i'

# ── All colors (unclassified) ───────────────────────────────────────

# Total hex colors (superset of above)
scan_category "All hex colors" '#[0-9a-fA-F]{3,8}\b'

# All rgb/rgba/hsl/hsla function calls
scan_category "All rgb/rgba/hsl/hsla" '(rgb|rgba|hsl|hsla)\s*\(' '-i'

# All named colors
scan_category "All named colors" '\b(white|black|red|blue|green|gray|grey|orange|yellow|purple|transparent)\b' '-i'

# ── Spacing & dimensions ────────────────────────────────────────────

# Pixel values (but not 0px or in var() definitions)
scan_category "Hardcoded px" '[1-9][0-9]*px'

# Em/rem values
scan_category "Hardcoded em/rem" '[0-9]+\.?[0-9]*(em|rem)\b'

# ── Other token categories ──────────────────────────────────────────

# z-index values
scan_category "z-index values" 'z-index:\s*[0-9]+'

# Box shadows (inline, not via variable)
scan_category "Inline box-shadow" 'box-shadow:\s*[^v;]'

# Font size literals
scan_category "Font size literals" 'font-size:\s*[0-9]'

# Font weight literals
scan_category "Font weight literals" 'font-weight:\s*[0-9]'

# Border radius literals
scan_category "Border radius" 'border-radius:\s*[0-9]'

# Hardcoded opacity
scan_category "Opacity values" 'opacity:\s*0?\.[0-9]'

# ── Output ───────────────────────────────────────────────────────────

if $JSON_OUTPUT; then
  echo "{"
  echo '  "scanPath": "'$SCAN_PATH'",'
  echo '  "categories": ['
  first=true
  while IFS='|' read -r label count files; do
    if $first; then first=false; else echo ","; fi
    printf '    {"category": "%s", "matches": %s, "files": %s}' "$label" "$count" "$files"
  done < "$TMPFILE"
  echo ""
  echo "  ],"

  # Total
  total=$(awk -F'|' '{s+=$2} END {print s+0}' "$TMPFILE")
  total_files=$(awk -F'|' '{s+=$3} END {print s+0}' "$TMPFILE")
  echo '  "totalMatches": '$total','
  echo '  "totalFiles": '$total_files
  echo "}"
else
  printf "%-25s %8s %8s\n" "Category" "Matches" "Files"
  printf "%-25s %8s %8s\n" "─────────────────────────" "────────" "────────"
  while IFS='|' read -r label count files; do
    printf "%-25s %8s %8s\n" "$label" "$count" "$files"
  done < "$TMPFILE"

  echo ""
  total=$(awk -F'|' '{s+=$2} END {print s+0}' "$TMPFILE")
  total_files=$(awk -F'|' '{s+=$3} END {print s+0}' "$TMPFILE")
  echo "Total: $total matches across $total_files file-category pairs"
  echo ""
  echo "Note: Some matches may overlap (e.g., a hex color inside an rgba() call)."
  echo "Use --json for machine-readable output."
fi
