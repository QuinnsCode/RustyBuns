# codeSplitter over ssh:// (spike)

`git push`, `git ls-remote` and `git clone` over `ssh://` go through a Worker's inbound TCP `connect()` handler, a Durable
Object and a container running `sshd`. It works locally under `wrangler dev`, from a cold container, in about 30 s
(#5500). Background: [notes/INBOUND_TCP_GRPC.md](../../../notes/INBOUND_TCP_GRPC.md).

```sh
cd apps/codesplitter
bun ssh/try.ts          # needs Docker; nothing touches Cloudflare
bun ssh/try.ts --keep   # leave it up and try git by hand
```

```
git -> tcp 127.0.0.1:8788 -> worker.ts connect() -> SshGate DO connect() -> container :2222 sshd -> git-serve.sh
```

| File | What it is |
|---|---|
| `worker.ts` | The Worker's `connect()` handler and the `SshGate` DO, which starts the container and joins the sockets |
| `Dockerfile`, `entry.sh` | Alpine with `openssh-server` and `git`. One `git` user, key login only, and every login is forced through `git-serve.sh` |
| `git-serve.sh` | Allows only `git-upload-pack` and `git-receive-pack` on `owner/repo`, which maps to `/srv/git/owner/repo.git`. A push makes a missing repo |
| `wrangler.jsonc` | The spike's own config, because codeSplitter's generated one can't carry `connect` yet |
| `try.ts` | The proof: push, ls-remote, clone, a stranger's key refused, a bad path refused |

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

- **Key auth:** match the client's key to a codeSplitter user. `sshd`'s `AuthorizedKeysCommand` asks codeSplitter
  over HTTP which user owns the offered key, so the container needs no key list baked in. The key store is still to be decided.
- **Pushes into Artifacts:** `git-serve.sh` stops serving `/srv/git` and bridges to the repo's Artifacts remote over
  smart HTTP with that user's token. Pushes then take the HTTP push path (checks, agents, feed).
- **rustybuns:** carry a `connect` export and the `connect` port through `rustybuns dev` and deploy. Alchemy has no
  Spectrum resource, so the app is a `cf spectrum apps create` step or a small resource of our own.
- **Live (owner):** a Pro zone, the Spectrum app on one port (22 is the nice one), and a priced run.
