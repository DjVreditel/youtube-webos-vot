#!/usr/bin/env bash
set -euo pipefail

port_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${COBALT_PORT_WORK:-$HOME/cobalt-port-work}"
rf="$work/rf"
runtime="$work/runtime-libs"
build_dir="$rf/workdir/cobalt-source/out/webos-arm-sbversion-13_${COBALT_BUILD_TYPE:-devel}"

mkdir -p "$runtime"
docker run --rm -v ytaf-webos-linux-sdk:/sdk:ro -v "$runtime:/out" ubuntu:24.04 bash -c '
  set -euo pipefail
  sysroot=/sdk/arm-webos-linux-gnueabi_sdk-buildroot/arm-webos-linux-gnueabi/sysroot
  for lib in libstdc++.so.6 libgcc_s.so.1 libatomic.so.1; do
    cp -L "$(find "$sysroot" -name "$lib" -print -quit)" "/out/$lib"
  done
'

cd "$rf"
cp "$port_dir/../assets/icon.png" assets/icon.png
cp "$port_dir/../assets/largeIcon.png" assets/largeIcon.png
jq '.title = "YouTube" | .iconColor = "#FFFFFF"' starterless-cobalt/appinfo.json > starterless-cobalt/appinfo.json.tmp
mv starterless-cobalt/appinfo.json.tmp starterless-cobalt/appinfo.json
[[ -x node_modules/.bin/ares-package ]] || npm install --no-audit --no-fund
rm -f output/*.ipk
COBALT_BUILD_DIR="$build_dir" COBALT_RUNTIME_DIR="$runtime" COBALT_PACKAGE_OUTPUT_DIR="$rf/output" \
  bash scripts/package-starterless-cobalt.sh
mkdir -p "$work/dist"
cp output/*.ipk "$work/dist/"
ls -l "$work/dist"
