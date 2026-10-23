#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
C="$DIR/cdp.cjs"
T="$DIR/tv.cjs"
APP=youtube.leanback.v4
P=RRRRRRRRRRRRDDDRRRRRRRRRRRRUUU
for run in 1 2; do
  node "$T" exec "luna-send -n 1 luna://com.webos.applicationManager/closeByAppId '{\"id\":\"$APP\"}'" >/dev/null 2>&1
  sleep 4
  node "$T" exec "sync; echo 3 > /proc/sys/vm/drop_caches; luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"$APP\"}'" >/dev/null 2>&1
  sleep 25
  echo "url: $(node "$C" list | grep -o 'tv?[^#]*' | head -1)"
  echo "mem before: $(node "$T" exec "free -m | awk '/Mem:/{print \"used=\"\$3\" avail=\"\$7}'")"
  echo "cold: $(timeout 60 node "$C" bench $P 250)"
  echo "warm: $(timeout 60 node "$C" bench $P 250)"
  echo "mem after: $(node "$T" exec "free -m | awk '/Mem:/{print \"used=\"\$3\" avail=\"\$7}'")"
done
