#!/bin/sh
# Usage: capped-log.sh LOGFILE COMMAND [ARGS...]
#
# launchd opens StandardOutPath and StandardErrorPath before the program runs,
# so a program cannot rotate them; only what runs first can. This keeps the
# file under 256 KB by cutting it to its last 64 KB in place (same file, so
# launchd's open descriptor stays valid), then becomes COMMAND. It runs on
# every launch, including every launch of a crash loop, which is the one case
# where that file grows.
log="$1"; shift
if [ -f "$log" ] && [ "$(wc -c < "$log")" -gt 262144 ]; then
  tail -c 65536 "$log" > "$log.tmp" && cat "$log.tmp" > "$log" && rm -f "$log.tmp"
fi
exec "$@"
