// GET /install.sh  the CLI (cli.ts) in one line: `curl -fsSL https://<site>/install.sh | sh`.
// It fetches the bundled /cli.js from this same site, gives it a shebang for whichever of
// Bun or Node is there, puts it on your PATH as `codesplitter`, and saves this site's
// address, so `codesplitter login` only has to ask for your token.

export function installScript(origin: string): Response {
  const sh = `#!/bin/sh
# codeSplitter CLI: every MCP tool as a shell command.
# curl -fsSL ${origin}/install.sh | sh
set -e
site='${origin.replace(/'/g, "")}'
dir="\${CODESPLITTER_BIN:-\${CODESPLITTERS_BIN:-$HOME/.local/bin}}"
if command -v bun >/dev/null 2>&1; then rt=bun
elif command -v node >/dev/null 2>&1; then rt=node
else echo "codesplitter needs Bun (https://bun.sh) or Node 18+" >&2; exit 1; fi
mkdir -p "$dir"
tmp="$(mktemp)"
curl -fsSL "$site/cli.js" -o "$tmp"
{ echo "#!/usr/bin/env $rt"; cat "$tmp"; } > "$dir/codesplitter"
rm -f "$tmp"
chmod +x "$dir/codesplitter"
"$dir/codesplitter" login --url "$site" </dev/null >/dev/null
echo "Installed codesplitter in $dir (runs on $rt)."
case ":$PATH:" in *":$dir:"*) ;; *) echo "Add it to your PATH: export PATH=\\"$dir:\\$PATH\\"" ;; esac
echo "Next: codesplitter login    (paste a token from your profile page)"
echo "Then: codesplitter tools"
`;
  return new Response(sh, { headers: { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "public, max-age=300" } });
}
