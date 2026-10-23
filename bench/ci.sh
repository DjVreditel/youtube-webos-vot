#!/usr/bin/env bash
# The CI test run: builds the packages and runs every bench test that checks
# behaviour. Each test exits non-zero on a failure, which stops the run.
#
#   npm test            release builds (minified)
#   npm run coverage    the same under c8, with unminified, source-mapped builds
#
# Left out: the timing benches (hook-bench, panel-bench, module-hotpath-bench,
# emoji-amplify-test), which measure rather than pass or fail.
set -euo pipefail
cd "$(dirname "$0")/.."

B=dist/webOSUserScripts/userScript.js
env=()
if [ "${1:-}" = --coverage ]; then
  env=(--env coverage)
  # Names the bundle the tests eval, so c8 can map it back to src/.
  export NODE_OPTIONS="${NODE_OPTIONS:-} --require ./bench/coverage-preload.cjs"
fi

build() { echo "=== build $*"; npx webpack --mode=production --stats errors-warnings "${env[@]}" "$@"; }
run() { echo "--- $1"; node "bench/$1.cjs" "${@:2}" | grep -v '^[[:space:]]*$' | tail -n 1; }

build
run polyfill-conformance
run launch-test
run smoke "$B" legacy
run adblock-test "$B" legacy
run new-features-test "$B"
run dependency-test "$B"
run dislike-timing-test "$B" legacy
run module-behaviour-test "$B"
run panel-test "$B"
run per-account-test "$B"
run feed-features-test "$B"
run emoji-loop-test "$B" 40
run force-codec-test "$B"
run sponsorblock-labels-test "$B"

# Coverage stops here: c8 reads the bundle on disk when it reports, so that
# must still be the build the tests ran (the modern build reuses the path).
if [ ${#env[@]} -eq 0 ]; then
  build --env modern
  run modern-smoke "$B"

  # perf_mon is a dev tool, not part of the app.
  build --env perf
  run perfmon-test "$B" legacy
fi

echo "=== all tests passed"
