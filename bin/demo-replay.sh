#!/usr/bin/env bash
# Run the offline replay beat of the demo. Confirms the host has no
# network reachability before invoking gemmacourt replay, so a passing
# replay run cannot be confused with "we just made another LLM call".
#
# Usage: bin/demo-replay.sh <bundle-path>
#
# Idempotent: every run does the same network probe and the same replay.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$#" -ne 1 ]; then
  printf 'usage: bin/demo-replay.sh <path/to/bundle.verdict>\n' >&2
  exit 2
fi

BUNDLE_PATH="$1"
if [ ! -f "${BUNDLE_PATH}" ]; then
  printf 'demo-replay: bundle not found at %s\n' "${BUNDLE_PATH}" >&2
  exit 3
fi

step() {
  printf '\n[demo-replay] %s\n' "$1"
}

step "guard: confirming network is offline"
# Use a cheap, well-known host. If DNS resolves and TCP connects in 2s,
# the demo guarantee is broken; bail loudly so the recording is honest.
if curl --silent --max-time 2 --output /dev/null https://example.com; then
  printf '[demo-replay] WIFI STILL ON, ABORT: example.com responded inside 2s\n' >&2
  printf '[demo-replay] disable Wi-Fi (and any wired link) before re-running\n' >&2
  exit 4
fi
step "guard: curl --max-time 2 https://example.com failed as required"

step "checking dist/ is built (needed because the replay loads compiled code)"
if [ ! -f "${REPO_ROOT}/dist/cli/gemmacourt.js" ]; then
  printf '[demo-replay] dist/cli/gemmacourt.js missing; run pnpm build before going offline\n' >&2
  exit 5
fi

step "running gemmacourt replay against ${BUNDLE_PATH}"
node "${REPO_ROOT}/dist/cli/gemmacourt.js" replay "${BUNDLE_PATH}"
