set -e
bun ../../packages/cli/src/index.ts build desktop > /tmp/pr-build.log 2>&1 || { tail -30 /tmp/pr-build.log; exit 1; }
d=$(mktemp -d); python3 -m venv "$d/venv"; "$d/venv/bin/pip" -q install numpy 2>&1 | tail -2
mkdir "$d/app"
printf 'import numpy as np, platform\n__all__=["about","summarize"]\ndef about(): return {"version": platform.python_version()}\ndef summarize(n):\n    a=np.array(n); return {"count":len(n),"mean":float(a.mean()),"median":float(np.median(a)),"stdev":float(a.std())}\n' > "$d/app/api.py"
bin=$(ls -d "$PWD"/dist/python-react* "$PWD"/dist/*/python-react* 2>/dev/null | grep -v client | head -1); echo "bin: $bin"; ls -lh "$bin" | awk '{print $5}'
mkdir "$d/home"
(cd "$d" && HOME="$d/home" PYTHON="$d/venv/bin/python" PYTHON_APP="$d/app" RB_NO_BROWSER=1 RB_TOKEN=t "$bin" > "$d/log" 2>&1 &)
for i in $(seq 50); do url=$(grep -o 'serving http://[0-9.:]*' "$d/log" | awk '{print $2}'); [ -n "$url" ] && break; sleep 0.2; done
port=${url##*:}; tok=$(grep -o "token=[A-Za-z0-9_-]*" "$d/log" | head -1 | cut -d= -f2)
for fn in 'about","args":[]' 'summarize","args":[[1,2,3,10]]'; do curl -s -H "cookie: rb_token_$port=$tok" -H "origin: $url" -H 'content-type: application/json' -d "{\"module\":\"src/actions/python.ts\",\"fn\":\"$fn}" "$url/__rb/action"; echo; done
tail -3 "$d/log"; pkill -f "$bin" || true; rm -rf "$d"
