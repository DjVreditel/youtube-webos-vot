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
bash scripts/install-ytaf-cobalt-assets.sh "$rf/workdir/cobalt-source"
csp_hosts="sponsor.ajay.app sponsorblock.inf.re dearrow.ajay.app dearrow-thumb.ajay.app returnyoutubedislikeapi.com vot-worker.vtrans.eu.cc vot-new.toil-dump.workers.dev vot-auth-server.onrender.com *.yandex.net *.yandex.ru fonts.googleapis.com cdnjs.cloudflare.com"
sed -i "s|value.append(\" [^\"]*\");|value.append(\" $csp_hosts\");|" "$rf/workdir/cobalt-source/cobalt/csp/directive_list.cc"
grep -q "vot-worker.vtrans.eu.cc" "$rf/workdir/cobalt-source/cobalt/csp/directive_list.cc"
COBALT_SOURCE_DIR="$rf/workdir/cobalt-source" \
SDL2_BUNDLE_DIR="$rf/workdir/deps/SDL2-2.30.12-webos-abi" \
WEBOS_LINUX_SDK_VOLUME=ytaf-webos-linux-sdk \
COBALT_BUILD_TYPE="${COBALT_BUILD_TYPE:-devel}" \
NINJA_PARALLEL="${NINJA_PARALLEL:-5}" \
COBALT_BUILD_LOG="$work/cobalt-build.log" \
  bash scripts/build-starterless-cobalt-docker.sh
