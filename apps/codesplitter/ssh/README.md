# codeSplitter over ssh:// (spike)

`git push`, `git ls-remote` and `git clone` over `ssh://` go through a Worker's inbound TCP `connect()` handler, a Durable
Object and a container running `sshd`. The container keeps no repos: each connection is bridged to the repo's
smart-HTTP remote (Artifacts) with the user's token, so a push over ssh lands where an HTTP push does (#5505). A key gets in as the codeSplitter user who
added it (#5504). It works
locally under `wrangler dev`, from a cold container, in about 30 s (#5500). It is codeSplitter's own Worker (#6195):
`connect()` on its default export (`worker.connect` in rustybuns.config.ts), and the `SshGate` container bound only with
`CODESPLITTER_SSH=1`, like the other containers. Background:
[notes/INBOUND_TCP_GRPC.md](../../../notes/INBOUND_TCP_GRPC.md).

```sh
cd apps/codesplitter
bun ssh/try.ts          # needs Docker; boots codeSplitter in-process, nothing touches Cloudflare
bun ssh/try.ts --keep   # leave it up and try git by hand
```

```
git -> tcp 127.0.0.1:8788 -> src/worker.ts connect() -> SshGate DO connect() -> container :2222 sshd -> git-serve.sh
    -> lookup (remote + token) -> scratch bare repo <-> the repo's smart-HTTP remote

sshd's AuthorizedKeysCommand: authorized-keys.sh %u %f -> http://192.0.2.1/key?fingerprint= -> (caught by the DO)
    -> src/ssh-gate.ts KeyLookup -> GET /api/ssh/key, in the same Worker -> {user, key} -> command="/git-serve.sh <user>" ...
```

| File | What it is |
|---|---|
| `../src/ssh-gate.ts` | codeSplitter's `connect()` handler (`sshConnect`), the `SshGate` DO, which starts the container and joins the sockets, and `KeyLookup`, which answers sshd's key lookups from the Worker's own `GET /api/ssh/key` (or `SSH_KEYS_URL`'s, as `try.ts` sets it) |
| `Dockerfile`, `entry.sh` | Alpine with `openssh-server`, `git` and `curl`. One `git` user, key login only, no authorized_keys file |
| `authorized-keys.sh` | sshd's `AuthorizedKeysCommand`: asks whose the offered key is (fingerprint in) and prints one line, forced through `git-serve.sh <user>` |
| `git-serve.sh` | Allows only `git-upload-pack` and `git-receive-pack` on `owner/repo`, and bridges it to the repo's HTTP remote (below) |
| `try.ts` | Runs codeSplitter's Worker under `wrangler dev` from the config rustybuns generates with `CODESPLITTER_SSH=1` alone (written beside wrangler.jsonc, deleted after), then the proof, against a stand-in codeSplitter on the Mac (the lookup, and `git http-backend` behind Bearer tokens): push, it landed in the HTTP remote, a second push, ls-remote, clone, the remote's refusal reaching the client, a repo the lookup refuses, a key nobody added, a bad path, and the key once it's removed. The key is added and removed through codeSplitter's real API (booted in-process), and the stand-in hands every path but its own to it |

## Keys (#5504)

The key store is codeSplitter's `ssh_keys` table (`src/ssh-keys.ts`): `GET`/`POST /api/me/ssh-keys` and
`DELETE /api/me/ssh-keys/:id`. Adding a key is cookie only (an API token gets a 403: a key outlives any token), and a
key is one person's. The lookup is `GET /api/ssh/key?fingerprint=`, open like a forge's public keys page, answering
`{user, key}` or 404. Its one guard, `SshKeyOwner` in `src/ssh-key.ts`, is what the server `satisfies` and what
`KeyLookup` reads with: it takes only a handle and `type base64`, so nothing from the store can break out of the
authorized_keys line or the forced command.

The container keeps no key list, and a removed key stops at the next login. sshd's lookups go to `192.0.2.1`, a
documentation address nothing routes to; the DO catches HTTP to it with `interceptOutboundHttp` before `start` and
hands it to `KeyLookup`. That works under `wrangler dev` with the internet on, and leaves the bridge's own HTTP alone.

## The bridge (#5505)

`git-serve.sh <user>` asks `LOOKUP_URL` (the site's own `/api/ssh/remote`, or the Worker's `SSH_LOOKUP_URL` when set), with `GATE_SECRET` (the Worker's `SSH_GATE_SECRET`) as a Bearer token, for `user`, `repo` and `mode` (`read` for a
fetch, `write` for a push). The reply is two lines, the repo's smart-HTTP remote and a token for that user; an error
status's body is the reason, which the client sees. Then it makes a scratch bare repo for this connection, fetches every
ref of the remote into it, and runs `git-upload-pack` or `git-receive-pack` on it. The scratch repo goes when git is done.

A push goes on to the HTTP remote from the scratch repo's `pre-receive` hook, while the client's objects are still in
quarantine, one `git push` with each ref leased on its old value. So the client hears "ok" only once the HTTP push
landed, and the HTTP side's refusals (a protected branch, a check) come back as `remote:` lines and fail the push.
The token goes in the scratch repo's config (`http.extraHeader`), not argv or the URL.

codeSplitter's Worker answers it at `GET /api/ssh/remote` (`src/ssh-remote.ts`), behind its `SSH_GATE_SECRET` (the
gate's `GATE_SECRET`, a varlock secret; the route is a 404 without it). Tokens last 10 minutes. `read` takes read access, as
the API does (a private repo you can't see is "not found"), and the crew get the crew remote once there is one. `write` is
what the app can land as it lands the desktop's Push back: the owner's, on the desktop's own git, with no private lines.
The push is heard there as it lands (`hearPushes` in `src/mirror.ts`) and comes into the open files as the owner's edits.
Cloudflare Artifacts doesn't tell the Worker of a push made outside it, so a cloud repo turns pushes away with the
reason until #5699 lands. `test/ssh-remote.test.ts` walks it without Docker.

The container needs the internet for this (`enableInternet: true`), to reach the lookup and Artifacts.

What it costs, from `try.ts` on an M-series Mac (local Docker, so the HTTP remote is next door):

| Step | Time |
|---|---|
| push, cold container | ~3.2-4 s |
| push, warm | ~1.0-1.5 s |
| ls-remote | ~0.6-0.8 s |
| clone over ssh | ~0.7 s |
| the same clone straight over HTTP | ~0.1 s |

Most of the ssh cost is the ssh handshake plus the mirror fetch. The fetch is the part that grows: every connection
fetches the whole repo first, so a big repo pays its full size on each push and fetch. A true stream proxy (relay git's
pkt-lines to the remote's `/git-upload-pack` and `/git-receive-pack`, as `git-remote-http`'s stateless RPC does) would
fetch nothing up front. That is the next thing to try if repos get big.

## What the spike found

- **The local tools already have it.** wrangler 4.156.0 (miniflare `5.20261023.3-beta`, workerd `1.20261023.1`, all in the
  lockfile) runs a `connect` handler from `"connect": [{ "protocol": "tcp", "port": 8788 }]`, and it runs Containers on Docker.
- **The Worker hands the socket to the DO by dialling it:** `env.GATE.getByName(name).connect("gate:2222", opts)`
  lands in the DO's own `connect(socket)` method. Passing the socket as an RPC argument (`stub.connect(socket)`) fails with
  "not an integer", because the stub's `connect` is the outbound-socket method. The DO can be a plain class, like `AgentSandbox`.
- **An open port isn't a live sshd.** A cold container's port accepts the connection before `sshd` listens, then drops it
  (`kex_exchange_identification: Connection closed`). sshd speaks first, so the DO waits for its `SSH-2.0-` banner, hands
  that on to the client, and only then splices the two sockets.
- **There is no DO per repo at the Worker.** The shape in #5500 can't work as written. SSH is encrypted end to end, so the
  Worker and DO see no repo path and no user. The path is known only after sshd decrypts, inside the container. This
  leaves two shapes:
  1. *One gate container (or a small pool) for all repos* (this spike). It stays plain `sshd` and the repo is
     chosen in `git-serve.sh`. The container is a thin bridge that hands each repo to codeSplitter, not where repos live.
  2. *A TS SSH server in the Worker or DO*, which decrypts there and then routes to a DO per repo. It needs no container
     but means writing SSH crypto (a host key, kex, channels). It would cost more to build and to keep safe.

  Go with (1). The container stays stateless, and Artifacts stays where the repos live (see the next steps).
- **`allowHalfOpen: true` on both sockets matters.** git closes its write side once it has sent its packs, then reads the reply.

## Next steps (each its own issue)

- **Key auth:** done (#5504, above). The site still needs a page to paste a key into: #5545.
- **Pushes into Artifacts:** done in the gate (#5505) and the Worker's lookup (#5541, above). A push over ssh to a
  cloud repo, which Artifacts doesn't tell the Worker of: #5699.
- **rustybuns:** carry a `connect` export and the `connect` port through `rustybuns dev` and deploy. Alchemy has no
  Spectrum resource, so the app is a `cf spectrum apps create` step or a small resource of our own.
- **Live (owner):** a Pro zone, the Spectrum app on one port (22 is the nice one), and a priced run.
