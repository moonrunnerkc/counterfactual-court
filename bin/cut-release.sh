#!/usr/bin/env bash
# Cut the v0.1.0 GitHub release. Verifies preconditions, creates the
# tag if missing, pushes it, and creates the release with the showcase
# bundle and runtime.lock.json attached.
#
# Idempotent: re-running with the tag and release already present is
# safe; gh release create exits non-zero if the release exists, so this
# script checks first and skips creation in that case.
#
# Hard preconditions (script fails loudly if any is missing):
#   - exactly one .verdict file under bundles/showcase/
#   - runtime.lock.json present
#   - docs/release-notes-v0.1.0.md present
#   - clean git working tree (no unstaged or staged changes)
#   - origin remote configured
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="v0.1.0"
NOTES_FILE="${REPO_ROOT}/docs/release-notes-v0.1.0.md"
SHOWCASE_DIR="${REPO_ROOT}/bundles/showcase"
LOCK_FILE="${REPO_ROOT}/runtime.lock.json"

step() {
  printf '\n[cut-release] %s\n' "$1"
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'cut-release: required tool "%s" not found on PATH\n' "$1" >&2
    exit 2
  fi
}

step "1/7 verify prerequisite tools"
require_tool git
require_tool gh

step "2/7 verify release-notes file exists"
if [ ! -f "${NOTES_FILE}" ]; then
  printf 'cut-release: release notes not found at %s\n' "${NOTES_FILE}" >&2
  exit 3
fi

step "3/7 verify runtime.lock.json exists"
if [ ! -f "${LOCK_FILE}" ]; then
  printf 'cut-release: runtime.lock.json not found at %s; run pnpm lock-runtime first\n' "${LOCK_FILE}" >&2
  exit 4
fi

step "4/7 verify exactly one showcase bundle is present"
if [ ! -d "${SHOWCASE_DIR}" ]; then
  printf 'cut-release: %s does not exist; run bin/run-showcase.sh first\n' "${SHOWCASE_DIR}" >&2
  exit 5
fi
# Bundle filenames are sha256 hex strings; ls is safe here.
# shellcheck disable=SC2012
BUNDLE_COUNT="$(ls -1 "${SHOWCASE_DIR}"/*.verdict 2>/dev/null | wc -l | tr -d ' ')"
if [ "${BUNDLE_COUNT}" != "1" ]; then
  printf 'cut-release: expected exactly 1 bundle in %s, found %s\n' "${SHOWCASE_DIR}" "${BUNDLE_COUNT}" >&2
  printf 'cut-release: re-run bin/run-showcase.sh and prune older bundles before re-running this script\n' >&2
  exit 6
fi
# shellcheck disable=SC2012
SHOWCASE_BUNDLE="$(ls -1 "${SHOWCASE_DIR}"/*.verdict)"
printf '[cut-release] showcase bundle: %s\n' "${SHOWCASE_BUNDLE}"

step "5/7 verify clean working tree"
if [ -n "$(git -C "${REPO_ROOT}" status --porcelain)" ]; then
  printf 'cut-release: working tree is dirty; commit or stash before cutting a release\n' >&2
  git -C "${REPO_ROOT}" status --short >&2
  exit 7
fi

step "6/7 ensure tag ${TAG} exists locally and on origin"
if git -C "${REPO_ROOT}" rev-parse --verify --quiet "refs/tags/${TAG}" >/dev/null; then
  printf '[cut-release] tag %s already present locally\n' "${TAG}"
else
  git -C "${REPO_ROOT}" tag -a "${TAG}" -m "Counterfactual Court ${TAG}"
  printf '[cut-release] created tag %s\n' "${TAG}"
fi
if git -C "${REPO_ROOT}" ls-remote --tags origin "${TAG}" | grep -q "${TAG}"; then
  printf '[cut-release] tag %s already on origin\n' "${TAG}"
else
  git -C "${REPO_ROOT}" push origin "${TAG}"
  printf '[cut-release] pushed tag %s to origin\n' "${TAG}"
fi

step "7/7 create gh release (skips if it already exists)"
if gh release view "${TAG}" >/dev/null 2>&1; then
  printf '[cut-release] gh release %s already exists; not recreating.\n' "${TAG}"
  printf '[cut-release] to update assets, run: gh release upload %s "%s" "%s" --clobber\n' \
    "${TAG}" "${SHOWCASE_BUNDLE}" "${LOCK_FILE}"
  exit 0
fi

gh release create "${TAG}" \
  --title "Counterfactual Court ${TAG}" \
  --notes-file "${NOTES_FILE}" \
  "${SHOWCASE_BUNDLE}" \
  "${LOCK_FILE}"

printf '[cut-release] release %s created with bundle and lock file attached\n' "${TAG}"
