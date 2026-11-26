#!/bin/sh
# Scratch repro for #6241 (not committed): the first start sits silent, as a cold CI runner's Chrome does; the next one starts.
mark="${TMPDIR:-/tmp}/stall-chrome-$PPID"
if [ ! -e "$mark" ]; then touch "$mark"; sleep 40; exit 0; fi
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$@"
