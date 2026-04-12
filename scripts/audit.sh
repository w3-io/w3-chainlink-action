#!/bin/bash
# audit.sh — w3 partner action consistency audit
#
# Checks every w3-*-action repo in the parent workspace against the 21-item
# standards checklist in ../AGENTS.md. Reads from origin/<default-branch>
# rather than local working trees so the audit reflects what's actually
# shipped, not what's in someone's uncommitted changes.
#
# Usage:
#   ./scripts/audit.sh                  # audit all w3-*-action repos in workspace
#   ./scripts/audit.sh w3-bitgo-action  # audit a single repo by name
#   ./scripts/audit.sh --no-fetch       # skip the git fetch (faster, may be stale)
#
# Output: a markdown table with one row per repo and one column per check.
# Exits 0 if all checks pass, 1 if any check fails on any non-archived repo.

set -o errexit
set -o nounset
set -o pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

WORKSPACE="$(cd "$(dirname "$0")/../.." && pwd)"
SINGLE_REPO=""
DO_FETCH=1

while [ $# -gt 0 ]; do
  case "$1" in
    --no-fetch) DO_FETCH=0; shift ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) SINGLE_REPO="$1"; shift ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Show a file from origin/<default-branch> for a repo. Empty on failure.
show_origin() {
  local dir="$1" path="$2"
  local default
  default=$(git -C "$dir" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
    | sed 's@^refs/remotes/origin/@@')
  [ -n "$default" ] || return 0
  git -C "$dir" show "origin/$default:$path" 2>/dev/null || true
}

# Check if a path is tracked in origin/<default-branch>.
in_tree() {
  local dir="$1" path="$2"
  local default
  default=$(git -C "$dir" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
    | sed 's@^refs/remotes/origin/@@')
  [ -n "$default" ] || return 1
  git -C "$dir" ls-tree "origin/$default" -- "$path" 2>/dev/null | grep -q .
}

# Output a check result. Sets PASS=0/1 globally and prints "✅" or "❌".
check() {
  local cond="$1"
  if [ "$cond" = "1" ]; then
    printf "✅"
    return 0
  else
    printf "❌"
    FAILED=1
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Audit a single repo
# ---------------------------------------------------------------------------

audit_repo() {
  local dir="$1"
  local repo
  repo=$(basename "$dir")

  # Skip if not a git repo
  if [ ! -d "$dir/.git" ]; then
    return 0
  fi

  # Fetch latest unless told not to
  if [ "$DO_FETCH" = "1" ]; then
    git -C "$dir" fetch origin --quiet 2>/dev/null || true
  fi

  # Skip archived repos — they're frozen and not subject to consistency.
  # `gh repo view --json archived` requires gh auth; fall back to checking
  # whether the remote refuses pushes via a marker file or a known list.
  # Hard-coded for now: cube3 is the only known archived w3 action.
  case "$repo" in
    w3-cube3-action)
      printf "| %-25s | (archived — skipped) |\n" "$repo"
      return 0
      ;;
  esac

  # Check default branch
  local default
  default=$(git -C "$dir" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
    | sed 's@^refs/remotes/origin/@@')
  if [ -z "$default" ]; then
    printf "| %-25s | (no remote HEAD) |\n" "$repo"
    return 0
  fi

  # Read files once
  local pkg ci action ignore eslint gitignore srcindex
  pkg=$(show_origin "$dir" "package.json")
  ci=$(show_origin "$dir" ".github/workflows/ci.yml")
  action=$(show_origin "$dir" "action.yml")
  ignore=$(show_origin "$dir" ".prettierignore")
  eslint=$(show_origin "$dir" "eslint.config.js")
  gitignore=$(show_origin "$dir" ".gitignore")
  srcindex=$(show_origin "$dir" "src/index.js")

  # Compute pass/fail for each check.
  # 1=pass, 0=fail
  local A1 A2 A3 A4 A5 A6 A7 B8 C9 C10 C11 D12 D13 E14 E15 F16 G17 H18 H19 I20 J21
  A1=0; [ -n "$ci" ] && A1=1
  A2=0; echo "$ci" | grep -q "node-version: 24" && A2=1
  A3=0; echo "$ci" | grep -q "packages: read" && A3=1
  # A4 accepts both single- and double-quoted scope values.
  A4=0; echo "$ci" | grep -q "registry-url:" && echo "$ci" | grep -qE "scope: ['\"]@w3-io['\"]" && A4=1
  A5=0; echo "$ci" | grep -q "NODE_AUTH_TOKEN" && A5=1
  A6=0; (echo "$ci" | grep -q "npm run build" && ! echo "$ci" | grep -q "npm run package") && A6=1
  # A7: pass if the trigger branches list contains the repo's default branch.
  # Accepts [main], [master], [main, master], or any list that includes default.
  A7=0; echo "$ci" | grep -E "branches:" | grep -q "$default" && A7=1
  B8=0; echo "$ignore" | grep -qE "^dist/" && B8=1
  C9=0; echo "$pkg" | grep -q '"@w3-io/action-core": "\^0\.4\.[1-9]' && C9=1
  C10=0; echo "$pkg" | grep -q '"type": "module"' && C10=1
  C11=0; ! echo "$srcindex" | grep -q "getBooleanInput" && C11=1
  D12=0; ! echo "$pkg" | grep -q '"jest"' && D12=1
  # D13: pass if there is no __tests__/ directory. test/ existence is OK
  # but not required (a repo with no tests passes vacuously).
  D13=0; ! in_tree "$dir" "__tests__" && D13=1
  E14=0; echo "$action" | grep -qE "using: ['\"]node24['\"]" && E14=1
  E15=0
  output_count=$(echo "$action" | awk '/^outputs:/{flag=1; next} /^[a-z]/{flag=0} flag' \
    | grep -cE "^  [a-z-]+:" || echo 0)
  [ "$output_count" = "1" ] && E15=1
  F16=0; in_tree "$dir" "dist/index.js" && F16=1
  G17=0; [ -n "$eslint" ] && G17=1
  H18=0; in_tree "$dir" "README.md" && \
    ! show_origin "$dir" "README.md" | head -5 | grep -q "TODO" && H18=1
  H19=0; in_tree "$dir" "docs/guide.md" && H19=1
  I20=0; (echo "$pkg" | grep -q '"format":' && \
          echo "$pkg" | grep -q '"format:check":' && \
          echo "$pkg" | grep -q '"lint":' && \
          echo "$pkg" | grep -q '"test":' && \
          echo "$pkg" | grep -q '"build":' && \
          echo "$pkg" | grep -q '"all":') && I20=1
  J21=0; in_tree "$dir" ".npmrc" && \
    show_origin "$dir" ".npmrc" | grep -q "npm.pkg.github.com" && J21=1

  # Format the row.
  printf "| %-25s |" "$repo"
  for v in A1 A2 A3 A4 A5 A6 A7 B8 C9 C10 C11 D12 D13 E14 E15 F16 G17 H18 H19 I20 J21; do
    eval "val=\$$v"
    if [ "$val" = "1" ]; then printf " ✅ |"; else printf " ❌ |"; FAILED=1; fi
  done
  printf "\n"
}

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

cat <<'EOF'
# W3 Action Consistency Audit

Standards checked: 21 (see AGENTS.md). Reading from `origin/<default-branch>`.

| Repo                      | A1 | A2 | A3 | A4 | A5 | A6 | A7 | B8 | C9 | C10 | C11 | D12 | D13 | E14 | E15 | F16 | G17 | H18 | H19 | I20 | J21 |
|---------------------------|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
EOF

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

FAILED=0

if [ -n "$SINGLE_REPO" ]; then
  audit_repo "$WORKSPACE/$SINGLE_REPO"
else
  for dir in "$WORKSPACE"/w3-*-action; do
    [ -d "$dir" ] && audit_repo "$dir"
  done
fi

cat <<EOF

## Legend

- A1-A7: CI workflow (exists, Node 24, permissions, registry-url+scope, NODE_AUTH_TOKEN, npm run build, main/master triggers)
- B8: .prettierignore excludes dist/
- C9-C11: package.json (@w3-io/action-core ^0.4.x, ESM, no getBooleanInput)
- D12-D13: tests use node:test in test/
- E14-E15: action.yml node24 + single result output
- F16: dist/index.js committed
- G17: eslint.config.js (flat v9)
- H18-H19: README + docs/guide.md
- I20: standard package.json scripts (format, format:check, lint, test, build, all)
- J21: .npmrc tracked with @w3-io scope mapping

See ../AGENTS.md for the full per-check explanations and fix recipes.
EOF

exit $FAILED
