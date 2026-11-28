# Overnight decisions, summed up (#6060)

[#6060](https://github.com/QuinnsCode/RustyBuns/issues/6060) logged the calls agents made in the owner's place from
2026-11-26 to 2026-11-28: 181 comments. This is the short version, checked on 2026-11-28.

**Yes, they are merged.** Every PR the log points to has merged. Three were closed because a combined PR carried them:
#6202 in #6306, and #6338 and #6342 in #6347. A few rounds were dropped on purpose and opened no PR
([below](#dropped-nothing-merged)).

Nearly every call is cheap to undo. Each number in brackets links to the comment with the other options and the undo cost.

## Look at these first

These change what people can do, or what can't be taken back.

| Call | PR | Why look |
| --- | --- | --- |
| A first company sign-in on a never-proved email removes its password, other sign-ins and sessions, unless that browser is already signed in to it [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7197199829) | #6242 | A removed password does not come back |
| Company sign-in does nothing until the studio proves its domain with a DNS record [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7197198994) | #6242 | Studios have a new setup step |
| A studio's game opens only that studio's space [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7206540160) | #6349 | The product call #6227 and #6234 left to you |
| A studio's game can't manage studios or friends, or download or delete the account [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7197200492) | #6242 | What outside games may do |
| "Add" is now "Invite": nobody joins a studio until they say yes [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7205306879) | #6311 | Changes an everyday flow |
| New limits: 10 `eq_execute` programs a minute, 30 visit beacons a minute, 50 new visitor rows per address a day [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7206129921) | #6341 | Real people could hit them |
| A deleted account's name leaves audit logs and other people's hubs; the audit lines stay [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7206140324) | #6345 | Privacy wording |
| Cron Swanson's owner must have a verified eqosys email [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7202715012) | #6255 | An unverified owner account is locked out |
| The merge train takes no fork PR; you merge those by hand [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7197365495) | #6245 | Your chore now |
| On a desktop, codeSplitter's consent page opens only in the browser holding the app's launch cookie [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7197365495) | #6245 | Changes how you approve there |
| Excalibrawl's hourly fight takes the most reacted prompt, else the newest post, even with no reactions [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7194197746) | #6198 | Strangers' text picks the fight |
| Fleet Commander's levels are plain data plus one optional `goal` on the sim [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7190478009) | #6103 | Medium to undo |
| Excalibrawl types its Worker bindings by hand, without `@cloudflare/workers-types` [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7194199801) | #6198 | Medium to undo |

## Still open

- `bun run steer`'s text model is in as an experiment and not used. It needs numbers from Bob, then keep or cut: #6250 [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7197832762).
- Fleet Commander: the destroyer and cruiser are built from our drawing sheets; the other hulls and craft are #6120 [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7190756348).
- Preview databases: saving shipped; the wire protocol (#6204) and the hyperdrive twin (#6205) are not done [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7194491300).
- #6002 and #6061 are still open as issues. #6002's work is on main already [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7192023245); #6061's rest is #6120.
- Load In's look climb ended at round 18 on your word; your score is still wanted in its manual run [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7207892233).

## Dropped, nothing merged

| Round | Why | Kept where |
| --- | --- | --- |
| Mythic Masters world, #6115 round 8 [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7204167884) | Blind judges saw no gain | Values in #6115's comments |
| F215 MkII finish, #6270 round 6 [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7207239970) | Two tries, no gain | Values in #6270's comments |
| Pine Barrens understory, #6377 [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7207309335) [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7207503512) | No gain; judging changed to one set per judge | #6391's body |
| Load In round 17, #6382 [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7207575537) | Tied main | Branch `office/cosmo-1f3e` |
| eqosys badge recolour in Alien Disc Golf [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7206886117) | No gain; the badge stays the same in every game | Not kept |

## The rest, by area

### eqosys, Qollab and Qlave

- Party voice (#6231): someone let in "hidden" gets "Voice is busy" [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7197122670); stricter chat settings end the voice room [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7197123270);
  a dropped player keeps their voice seat for 30 s, #6294 [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7204548621).
- Account safety: a studio game's erase hook can't block account deletion [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7197201007); names are cut at 100 characters and
  leaving a studio rotates its invite [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7197201546); our own apps' tokens can still delete an account, #6194 [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7193948151).
- Sockets close at once after company-only, a lapsed seat, a pulled game or leaving a studio, #6345 [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7206140324).
- A sign-in returning to a custom URL scheme always shows the Continue page, #6311 [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7205306879).

### Security and Rusty Buns core

- Round 18a: an Allow from inside the box is refused; the guard refuses more git commands, #6245 [[log]](https://github.com/QuinnsCode/RustyBuns/issues/6060#issuecomment-7197365495).
- The desktop's local PGlite gets a random password each launch, #6256.
- `rustybuns dev` bridges a Worker's `connect()` itself, and Spectrum is a documented step for the zone owner, #6213.
- Cloned apps build with pnpm's version switch off, #6155. Test Swarm and QView3D got the pinned deploy set, #6176.
- Releases: the `v` tag goes on the soaked stable commit, #6179.
- Preview databases: pages stored as 8 KB rows, #6206; memory floor patched to 64 MB, no source build, #6253.
- Frameworks: one `BUILT_WORKERS` table, #6093; Wasp stays out of scope, #6122; Rat Stack check is docs only, #6180.
- Shared code: one `supervise()`, #6186; `record` and `fill` helpers, #6221; `ordered` takes pairs, #6275;
  scripts get `effect` through a re-export, #6190; `QlaveCall.send` is generic, #6178.
- Typing cleanups: #6109, #6137, #6221, #6378, #6393, #6412.

### Agent Office, CI and codeSplitter's board

- Merging: the train reads required checks from main's ruleset, #6138; `after.ts` uses Mergiraf if installed, #6220;
  stalled PRs and Ester's verdicts show as icons on Mervin's board, #6149 and #6165; the merge pin is crew only, #6188.
- Builder and CI: a shut valve exits 125 at once, #6146; red CI costs a worker builder trust, #6193; the builder ends
  a slot's processes only after an unfinished run, #6217; codeSplitter's tour smoke runs in CI and always rebuilds,
  #6153 and #6207; package changes run playground's tests, #6147; app docs count as app changes only when code reads
  them, #6142; the phone smoke warns when slow, #6148; flaky deploy test fixed, #6191; `startVite` reruns boundary, #6136.
- Workers and disk: runaways are ended at 100 copies or 8 GB, #6224; stalled turns get Escape and a carry-on, #6189;
  prompts sent during install are queued, #6185; `office-workers show` reads the last prompt, #6187; untracked-only
  worktrees are rescued then removed, #6145; idle scratch folders go after a day, #6184; Bun cache prune, #6210;
  `.claude/worktrees` is freed only when named, #6214; sizes come from `du`, #6212; one `every.ts` loop helper, #6177.
- `bun run steer` shipped without a model, #6202 (in #6306); the model experiment, #6251.
- Combined PRs (#6295, #6297, #6298, #6299, #6303, #6306) left nothing out except #6248 from #6299, which merged
  on its own later. Small calls made while combining: the audio batch (#6303) moved the sidechain tests to their own file, and
  one migration was renamed in #6242.
- Lint findings for every app in one PR, #6219. A Qollab card in the playground uses a made-up player, #6169.

### Audio apps (FM DAW, Q gear, Sound Guy Sim, Load In)

- FM DAW: song mode, #6091; sidechain is two track params, #6159, also on clips and plugins, #6246; automation per pattern, #6167;
  room banks join the floor height, #6157.
- Q gear: Q Builder boards for all 11 pedals, #6170; shared amp heads, #6211; live scope on Q Amp, #6223.
- Lessons: PA for a field, #6175; mixing two decks, #6216; make a beat from empty rows, #6247; swap one part, #6222;
  lesson cone marker, #6156; a class is whoever is in the jam room, #6164.
- Sound Guy Sim: cable hum checks on band night, #6150, and the first gig, #6218.
- Load In: flannel sleeves and hands, #6126; reach and carry poses, #6297 and #6357; tape marks, amber stand cues and
  plainer Next lines, #6281, #6317, #6338 (in #6347), #6381, #6415.
- The room and gear wall: control-room glass, #6130; wooden desk, #6226; live room floor dressing, #6264; downlight
  scallops, shadows and reflections, #6321, #6346, #6370; worn paths on the boards, #6396.
- Speakers: left-handed Air Motion as its own box, #6163; Funktion-One violet, horn linings, Res2 coat, throat and
  25 mm edges, F215 braces and clean sides, #6123, #6257, #6261, #6267, #6269, #6315, #6334, #6360.

### Games

- Fleet Commander: eight named levels behind a menu button, #6103; ships built in the app from our own sheets, #6121;
  gravity wells, veils and the interdictor now matter, #6133. #6631 (open) retunes two of the levels.
- Mythic Masters: story beats as found tapes, #6112; lake reflection, #6327; tree shapes, #6402; side camera turns
  slower round close fighters, #6302; compendium ribbons, #6116; grown mouth, hair and skull shape, #6277, #6386,
  #6403 (the shared figures, so Park Hide & Seek's triangle cap rose for #6082's eyelids, #6260, and for the mouth, #6329).
- Skate: jets fade between 46 and 52 degrees. The first fade, 29 to 43, broke three gaps and was replaced, #6113.
- Park Hide & Seek zones got one guard, #6137. Hippo Tycoon drops bad saved settings, #6221.
- Cron Swanson, eqosys and QView3D calls are covered above.

### Menu looks (hill climbs)

Each row is many rounds; the later round wins where they differ.

| App | Where it landed | PRs |
| --- | --- | --- |
| Git Recon | White field manual, range card pinned beside it (a strip on phones), gun slots as chip tiles with tear-off reset stubs | #6097, #6282, #6313, #6335, #6351, #6373, #6388, #6406 |
| Splat Rooms | Spy lab: dark glass with cyan edges, brass faders, kit tabs, screwed metal headers with channel numbers, a watch-bezel emblem | #6099, #6271, #6320, #6331, #6355, #6367, #6384, #6390, #6398, #6408, #6410 |
| Delayed Reaction | Mixing-desk Controls: presets Home, Phone, Night, Club as a band selector, screwed plates, VU station display | #6105, #6272, #6323, #6330, #6352, #6375 |
| Alien Disc Golf | Forecast board: corner brackets, stamped scorecard, course art, report form in the panel's place | #6108, #6285, #6319, #6342 (in #6347), #6366, #6380, #6400, #6416 |
| Two Fronts | Wider report form, one-line heading | #6125 |
