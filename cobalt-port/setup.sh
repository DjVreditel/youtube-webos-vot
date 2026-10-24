#!/usr/bin/env bash
set -euo pipefail

work="${COBALT_PORT_WORK:-$HOME/cobalt-port-work}"
rf_repo="https://github.com/RF1705/youtube-webos-cobalt-adfree.git"
rf_ref="99caa9314fca028acc09e93d1c49f91797386e43"
cobalt_ref="23.lts.6"
sdk_tag="webos-a38c582"
sdk_asset="arm-webos-linux-gnueabi_sdk-buildroot-x86_64.tar.gz"
sdk_volume="ytaf-webos-linux-sdk"

mkdir -p "$work"
cd "$work"

if [[ ! -d rf/.git ]]; then
  git init -q rf
  git -C rf remote add origin "$rf_repo"
fi
git -C rf fetch -q --depth 1 origin "$rf_ref"
git -C rf checkout -q --force --detach FETCH_HEAD

cobalt_dir="$work/rf/workdir/cobalt-source"
if [[ ! -f "$cobalt_dir/docker-compose.yml" ]]; then
  rm -rf "$cobalt_dir"
  mkdir -p "$cobalt_dir"
  git -C "$cobalt_dir" init -q
  git -C "$cobalt_dir" remote add origin https://github.com/youtube/cobalt.git
  git -C "$cobalt_dir" fetch -q --depth 1 origin "refs/tags/$cobalt_ref:refs/tags/$cobalt_ref"
  git -C "$cobalt_dir" checkout -q --detach "$cobalt_ref"
fi

if ! docker volume inspect "$sdk_volume" >/dev/null 2>&1; then
  mkdir -p "$work/sdk-download"
  [[ -s "$work/sdk-download/$sdk_asset" ]] || curl -fL -o "$work/sdk-download/$sdk_asset" \
    "https://github.com/openlgtv/buildroot-nc4/releases/download/$sdk_tag/$sdk_asset"
  docker volume create "$sdk_volume" >/dev/null
  docker run --rm -v "$sdk_volume:/sdk" -v "$work/sdk-download:/input:ro" ubuntu:24.04 bash -c '
    set -euo pipefail
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends file >/dev/null
    tar -xzf /input/'"$sdk_asset"' -C /sdk
    /sdk/arm-webos-linux-gnueabi_sdk-buildroot/relocate-sdk.sh
    rm -f /sdk/arm-webos-linux-gnueabi_sdk-buildroot/bin/wayland-scanner
    test -f /sdk/arm-webos-linux-gnueabi_sdk-buildroot/share/buildroot/toolchainfile.cmake
  ' || { docker volume rm -f "$sdk_volume"; exit 1; }
fi

if ! docker image inspect cobalt-build-evergreen:latest >/dev/null 2>&1; then
  cd "$cobalt_dir"
  perl -0pi -e 's/^(\s*)<<: \*common-definitions\n\1<<: \*build-volumes/$1<<: [*common-definitions, *build-volumes]/mg' docker-compose.yml
  sed -i 's#FROM ${BASE_OS:-gcr.io/cloud-marketplace-containers/google/debian10}:${BASE_OS_TAG:-latest}#FROM ${BASE_OS:-debian}:${BASE_OS_TAG:-10-slim}#' docker/linux/base/Dockerfile
  grep -q 'archive.debian.org/debian-security' docker/linux/base/Dockerfile || perl -0pi -e 's{ENV PYTHONUNBUFFERED 1\n}{ENV PYTHONUNBUFFERED 1\n\nRUN sed -i -e "s|http://security.debian.org/debian-security|http://archive.debian.org/debian-security|" -e "s|http://deb.debian.org/debian|http://archive.debian.org/debian|" -e "s|http://httpredir.debian.org/debian|http://archive.debian.org/debian|" -e "s|deb http://archive.debian.org/debian buster-updates|# deb http://archive.debian.org/debian buster-updates|" /etc/apt/sources.list && printf "%s\\\\n" "Acquire::Check-Valid-Until false;" > /etc/apt/apt.conf.d/99archive\n}' docker/linux/base/Dockerfile
  perl -0pi -e 's/&& \. \/tmp\/install\.sh/&& bash \/tmp\/install.sh/g; s/nvm install --lts \$\{LTS_VERSION\}/nvm install 16/g; s/nvm alias default \$\{LTS_VERSION\}\/\*/nvm alias default 16\/*/g' docker/linux/base/build/Dockerfile
  export DOCKER_DEFAULT_PLATFORM=linux/amd64
  docker compose build base
  docker compose build build-base
  docker compose build build-evergreen
  docker build -t cobalt-build-evergreen:latest - <<'EOF'
FROM cobalt-build-evergreen:latest
RUN apt update -qqy && apt install -qqy --no-install-recommends cmake gawk libwayland-bin && /opt/clean-after-apt.sh
EOF
  git restore --source=HEAD --worktree -- docker-compose.yml docker/linux/base/Dockerfile docker/linux/base/build/Dockerfile
fi

cd "$work/rf"
SDL2_BUNDLE_DIR="$work/rf/workdir/deps/SDL2-2.30.12-webos-abi" WEBOS_LINUX_SDK_VOLUME="$sdk_volume" \
  bash scripts/build-sdl-webos-docker.sh
echo "setup done: $work"
