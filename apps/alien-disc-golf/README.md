# Alien Disc Golf: Planet Earth

> **What it proves:** a game on real, live science data, with the silly part stapled on top: the course is the planet, and the wind is NOAA's forecast for right now. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

Nine holes of disc golf for an alien with a very big arm. Each tee is a random spot in one country and each basket is in another, a continent or an ocean away. The disc hovers for a few seconds and the real wind carries it the whole flight: a low throw rides the surface wind, a lofted one rides the 250 mb jet stream, several times stronger and the gamble. Your scanner shows coastlines and wind, no names: say which country you're teeing off from and get a stroke back.

- **The wind is real.** The Worker fetches NOAA's latest GFS run from [NOMADS](https://nomads.ncep.noaa.gov/) (1° global u and v at 10 m and 250 mb, about 200 KB of GRIB2) and keeps it for half an hour; the page decodes the GRIB itself ([`src/grib2.ts`](src/grib2.ts), complex packing with spatial differencing, no dependency) and reads the wind at the disc's own position every tenth of a second of flight. The streaks on the globe are that grid, advected. The credit line says which run and forecast hour you're playing in.
- **The sea is real too.** Land a throw in the water and the disc floats: for ten seconds the real ocean current carries it while you paddle against it. The open ocean barely moves it; the Gulf Stream, the Kuroshio or the Agulhas will take it hundreds of kilometres the wrong way, unless you ride it to a shore. The currents are NOAA CoastWatch's daily blended surface currents (geostrophic, from satellite altimetry): the Worker's `/api/currents` fetches the latest day from ERDDAP (one 1 MB request per six hours per isolate) and packs it to 130 KB at 1°, int8 in 2 cm/s steps. A copy ships with the page in [`src/currents.bin`](src/currents.bin) for when that fails, for the desktop build and for `?wind=synthetic`; `bun run currents` refreshes it. The credit line says which one you're playing on. The streaks switch to the currents while you swim, and the wave button (or `C`) shows them while you aim.
- **The planet is real.** Natural Earth's 1:110m countries (public domain, the `world-atlas` package) draw the coastlines, say which country the disc landed in, and give the tees and baskets. A course is a seed (`?seed=`), so a link is a challenge: same nine holes, and the same wind for the next hour or so.
- **The sim is honest, the scale is not.** Great circles on a sphere, bilinear sampling of the grid, a disc that doesn't slow down, a 150 km basket. `src/flight.ts` has the numbers.
- **No NOAA, no problem.** If NOMADS can't be reached (the desktop build has no network; `?wind=synthetic` to see it) the page plays on a synthetic field of trade winds, westerlies and a wavy jet, and says so in the credit line.

## Run it

```
bun install
cd apps/alien-disc-golf
bun run edge:dev      # builds the page, serves it with the wind relay at http://localhost:8787
```

`bun run dev` alone is Vite with the page's `/api` proxied to port 8787, so run `bunx wrangler dev` beside it while working on the page. `bun run deploy` ships it. `bun run desktop:build` makes the one-file desktop app, which plays on the synthetic wind.

## Playing

Click the planet to aim there in still air; the dashed line is that throw and the wind will bend it. `←` `→` aim, `↑` `↓` power (half-steps down to a 230 km putt), `L` low or high loft, `Space` throws. In the sea, hold `Space` or `↑` (or the paddle button) to paddle and `←` `→` (or tap the planet) to steer; the clock counts down the swim. Par is 3, 4 or 5 by distance; eight strokes and you pick up. For a hands-on check or an agent's browser: `?hole=5` jumps to a hole, `?swim=36.5,-72` drops straight into the sea there (the Gulf Stream), `?speed=4` runs flights and swims four times as fast, and `window.golf` has `state()`, `aim(heading, power, loft)`, `throw()`, `guess(name)`, `skipGuess()`, and for the swim `splash(lat, lon)` (drop the disc in the sea there), `paddle(on)`, `steer(heading)` and `seaView(on)`.

## Data and credit

- Wind: NOAA/NCEP Global Forecast System, via the NOMADS GRIB filter. US government work, public domain. NOMADS asks for no more than 120 requests a minute per address; the Worker makes at most one per half hour per isolate.
- Ocean currents: [NOAA CoastWatch](https://coastwatch.noaa.gov/) blended near-real-time surface currents (`noaacwBLENDEDNRTcurrentsDaily` on its ERDDAP; RADS altimetry, Copernicus Sentinel data, AVISO+ products), free to use and redistribute. Read by the Worker at most once per six hours per isolate, and by `bun run currents`. Geostrophic currents blow up at the equator and in narrow straits, so speeds are capped at 2 m/s.
- Coastlines: [Natural Earth](https://www.naturalearthdata.com/), public domain, as packaged by [world-atlas](https://github.com/topojson/world-atlas) (ISC).
- This started from the TerraViz demo ([apps/terraviz-demo](../terraviz-demo/README.md)) and the question of what NOAA data it could play with. TerraViz's catalog is 180 Science On a Sphere datasets, all imagery and video, so the wind here comes from the model output directly instead.
