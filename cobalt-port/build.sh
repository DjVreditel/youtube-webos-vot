#!/usr/bin/env bash
set -euo pipefail

port_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${COBALT_PORT_WORK:-$HOME/cobalt-port-work}"
rf="$work/rf"

git -C "$rf" checkout -q --force HEAD
git -C "$rf" clean -qfd -e workdir -e output -e webapp/node_modules
for p in "$port_dir"/patches/*.patch; do
  [[ -e "$p" ]] || continue
  git -C "$rf" apply --whitespace=nowarn "$p"
  echo "applied $(basename "$p")"
done

cd "$rf"
SDL2_BUNDLE_DIR="$rf/workdir/deps/SDL2-2.30.12-webos-abi" WEBOS_LINUX_SDK_VOLUME=ytaf-webos-linux-sdk \
  bash scripts/build-sdl-webos-docker.sh
COBALT_SOURCE_DIR="$rf/workdir/cobalt-source" \
SDL2_BUNDLE_DIR="$rf/workdir/deps/SDL2-2.30.12-webos-abi" \
WEBOS_LINUX_SDK_VOLUME=ytaf-webos-linux-sdk \
COBALT_BUILD_TYPE="${COBALT_BUILD_TYPE:-devel}" \
NINJA_PARALLEL="${NINJA_PARALLEL:-5}" \
COBALT_BUILD_LOG="$work/cobalt-build.log" \
  bash scripts/build-starterless-cobalt-docker.sh
