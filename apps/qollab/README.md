# Qollab

eqosys's multiplayer layer as a Worker of its own (#3816): a hub per player (friends, presence, notes), a party per room code,
a space per group, cloud saves and Qlave's voice roster. The code lives in [`apps/eqosys/src/qollab/`](../eqosys/src/qollab/),
and the design and its decisions are in [QOLLAB.md](../eqosys/QOLLAB.md). This app is the Worker that serves it.

- **Same paths.** eqosys answers on eqosys.qntbr.com and hands `/hub`, `/api/hub`, `/q/party*`, `/q/space*`, `/q/save/*` and
  `/q/qlave/roster` here over a service binding. A game changes nothing. `/q/achieve` stays with eqosys.
- **Its own objects.** `Hub`, `Party` and `Space` live here. eqosys's pages, account delete and privacy export still call them,
  through cross-script bindings.
- **eqosys's data, read in place.** The D1 is a reference into eqosys's stack, so the user id is still the only key and nothing
  is copied. The `Vault` (the key saves are sealed with) stays in eqosys.
- **No signing key needed to check tokens.** A token is checked against eqosys's public keys, read over a binding back
  (`EQOSYS`) and cached a few minutes. The signing key is here only to sign Qlave tickets; leave it unset and voice is off.
- **No URL of its own.** No domain and no workers.dev address: the only way in is through eqosys.

## Run it

```sh
cd apps/eqosys
bun run dev        # http://localhost:5173: eqosys and Qollab, two Workers, as on Cloudflare
cd ../qollab
bun test test      # a game's token through eqosys into Qollab; a bad or deleted one refused
```

## Deploy

Qollab first, then eqosys. Qollab's first deploy moves the three classes, with their data, out of eqosys's Worker
(Cloudflare's `transferred_classes`); eqosys's deploy then binds them here. Try it on a preview stage before production:

```sh
cd apps/qollab && bun run deploy --stage preview
cd ../eqosys && bun run deploy --stage preview
```
