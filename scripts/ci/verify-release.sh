#!/usr/bin/env bash
# Verifies the activated release over HTTPS: /api/health must report the
# database as ok and /api/version must report exactly the deployed SHA.
# Retries a bounded number of times while the restarted server comes up.
#
# Usage: verify-release.sh <https app url> <sha> <attempts> <seconds between attempts>
# Worst case: attempts x (2 x 10 s request limit + interval).

set -euo pipefail

readonly MAX_TIME_SECONDS=10
readonly SHA_PATTERN='^[0-9a-f]{40}$'

usage() {
  printf 'usage: verify-release.sh <https app url> <sha> <attempts> <seconds between attempts>\n' >&2
  exit 2
}

[[ $# -eq 4 ]] || usage
readonly BASE_URL=${1%/} SHA=$2 ATTEMPTS=$3 INTERVAL=$4
[[ $BASE_URL =~ ^https:// && $SHA =~ $SHA_PATTERN && $ATTEMPTS =~ ^[1-9][0-9]*$ && $INTERVAL =~ ^[0-9]+$ ]] || usage

# --proto =https refuses any other scheme; redirects are not followed, so a
# 3xx answer carries no JSON and fails the checks below.
fetch() {
  curl --silent --show-error --fail --proto '=https' --max-time "$MAX_TIME_SECONDS" \
    --header 'Cache-Control: no-cache' "$BASE_URL$1"
}

# jq's own exit status is not used: jq 1.6 exits 0 on an empty body, so
# each check compares jq's printed result instead.
json_field() {
  jq -r "$1" <<<"$2" 2>/dev/null || true
}

for ((attempt = 1; attempt <= ATTEMPTS; attempt++)); do
  if ! health=$(fetch /api/health) ||
    [[ $(json_field '.status == "ok" and .database == "ok"' "$health") != true ]]; then
    result="/api/health is not ok"
  elif ! version=$(fetch /api/version); then
    result="/api/version did not return a sha"
  elif reported=$(json_field '.sha | strings' "$version"); [[ -z $reported ]]; then
    result="/api/version did not return a sha"
  elif [[ $reported != "$SHA" ]]; then
    result="/api/version reports $reported"
  else
    printf 'Release %s is healthy and serving at %s.\n' "$SHA" "$BASE_URL"
    exit 0
  fi
  printf 'Attempt %d/%d: %s\n' "$attempt" "$ATTEMPTS" "$result"
  if ((attempt < ATTEMPTS)); then
    sleep "$INTERVAL"
  fi
done

printf '::error title=Demo verification failed::%s did not serve a healthy %s after %d attempts: %s\n' \
  "$BASE_URL" "$SHA" "$ATTEMPTS" "$result"
exit 1
