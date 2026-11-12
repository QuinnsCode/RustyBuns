# The three factions behind you

Three groups want every cryptid, and all three are one step behind the Book's bearer. Each has a main quest of
eight steps, one per playable region, and posts of rank and file along the trails you have already walked: trainer
fights to go back for. Their words are data (`content/faction-*.json`), their shape is `src/factions/model.ts`, and
what is said depends on what you did first, how long you were away and how you talk to each person.

None of them knows what the Book is. Each has a theory, and each theory is wrong. Nothing here says what the Book
is: that reveal is the owner's.

## Who they are

| | The Office | The Institute | The Lamplighters |
| --- | --- | --- | --- |
| id | `office` | `institute` | `lamplighters` |
| Full name | The Office of Unlisted Fauna (O.U.F.) | The Halloway Institute | The Lamplighters |
| What they are | Government agents in grey suits. Deadpan, by the form. A two-agent team that always arrives late, played as a parody of the bumbling rival duo, with a real cold bureau behind them. | Scientists on a private grant. Polite, exact, short of money and time. | Local partisans: rangers, truckers, cooks, kids on radios. They put the dim lights on the night paths. |
| What they do with a cryptid | Log it, seize it, file it. Theirs are "assets" with numbers. | Tag it, sample it, measure it. Theirs are "specimens" with codes. | Shelter it, move it, walk with it. Theirs have plain first names. |
| What they call you | Subject | Carrier | Bearer |
| Their theory of the Book (wrong) | Stolen government property: a register that left its shelf. | A field instrument: a catalogue that sorts by a measure they do not have yet. | A cage with pages that hires a hand to fill it. |
| People | Agent Pell (senior, reads every procedure aloud), Agent Quist (junior, keeps a scrapbook, likes cryptids), Section Chief Brandt (a voice on the radio: "Control") | Dr. Imogen Vale (principal investigator), Toby Reyes (field technician, overworked, talks too much), Ms. Carrow (grant officer, counts deliverables) | Wren Ashby (ex-ranger, call sign Lamp One), Old Dutch (trucker, call sign Long Haul), Pip (radio operator, call sign Sparrow) |
| No | No firearms: forms, tape, nets, cages. | No cruelty played for laughs: the harm is paperwork and cold rooms. | No claim to speak for any Indigenous nation; they keep away from sacred ground. |

## How they talk: Simplified Technical English, with the game's own names

Every faction line is written like a maintenance manual (ASD-STE100), and the comedy is the procedure.

- A sentence has 20 words at most. One instruction in one sentence.
- Active voice. Simple present, simple past or a command. No contractions ("do not", never "don't").
- No semicolons, no brackets, no exclamation marks, no "...".
- One word, one meaning. "Bind" is only what the Book does. The Office logs, seizes and files. The Institute tags,
  samples and measures. The Lamplighters shelter, move and walk with.
- `WARNING:`, `CAUTION:` and `NOTE:` are allowed, and so are numbered steps ("Step 1.").
- The game's names are the technical names, spelled as the game spells them: the Book, ink, bind, line-up, keeper,
  stone, section, trail, bog-light, campfire, cabin, sighting board, den, lair, the Eldritch Compendium, the Bog Witch,
  Gary, the twelve fields (ember, tide, gale, stone, frost, storm, grove, venom, spirit, shadow, iron, wild), the
  tiers (common, uncommon, rare, legendary, mythic), every region, section and creature name.
- Your own replies (`say`) are in your voice, not theirs, and may be loose.

`bun scripts/factions.ts` checks all of it: sentence length, contractions, ids, and that every flag a line waits on
is set somewhere.

## The small things that are counted

| Data point | Where it is kept | What it changes |
| --- | --- | --- |
| Places you had been before a faction met you | `intro` snapshot: how many section pages, fires, tapes, landmarks, contracts, binds, nights and regions you had at that moment | `before`, `notBefore`, `had`, `hadUnder` |
| Time between talks with one person | `people[id].at` | `gap`: first, soon (under an hour), later (under a day), long |
| How you talk to one person | `people[id].styles`, `last` | `manner` (the style you use most), `last` |
| The order of things | `met` (factions in the order met), `done` (stages in the order finished), `flags` | `met`, `unmet`, `first`, `done`, `undone`, `flags`, `noFlags` |
| What you hold | the journey | `owns`, `lacks`, `starter`, `been` |
| Fights against them | `won`, `lost`, `beaten` (posts, with the time) | `won`, `lost`; a beaten post asks for another go a day later |
| Where you stand | `s`, `area`, `deals`, `recent` | `now`, `past`, `trend`; their teams' levels |
| The hour and the company | the world | `night`, `party` |

### The reading: where am I, where have I come from, where am I going

Each faction keeps three numbers on you, in the manner of a PID controller.

- **Now (P):** your standing after your last dealing, -10 to 10.
- **Past (I):** the mean of your standing after every dealing so far. A long friendship outlasts one bad day.
- **Trend (D):** your standing now less what it was three dealings ago.

Lines read them as bands (`cold`, `cool`, `even`, `warm`, `close`; `falling`, `steady`, `rising`). The three are
also summed into **pressure**, which sets how many levels a faction's teams stand over their section: cold standing,
a cold past and a falling trend each add to it. Your own run has the same three: how far you are (P), how far you
have come in all (I) and your pace over your last few sections (D). A party's reading is the members' put together.

## The quests

A step opens when the step before it is done and you have cleared its section: they wait at the stone behind you.
Each step is a hail, a question with three replies (one straight, one dry, one hard), and usually a fight.

### The Office: "The File"

| Step | Where | What happens | Sets |
| --- | --- | --- | --- |
| office.1 Form 9-C | Pine Barrens, Apple Pie Hill | Pell and Quist make an official stop under the fire tower and ask for your name and "the item in your hand". Straight: you give your name. Dry: you give Gary's. Hard: you refuse, and they send in Asset 1. | `office-file` or `office-gary` |
| office.2 Quiet Zone | Appalachian hollows, Green Bank | The Office has a listening post in the radio quiet zone. Pell orders the Book "switched off". Quist asks, off the record, what the Mothman looked like. | `quist-warm` (straight) |
| office.3 The Wooden One | Great North Woods, Rhinelander | The Office's oldest asset is the wired wooden hodag from the 1896 fair. Pell guards it. You can tell them it is wood. | `asset-one-wood` |
| office.4 The Frames | Pacific Northwest, The film | Your camcorder is evidence. They want the tape. Straight: Quist makes a copy. Hard: a fight for it. | `tape-copied` |
| office.5 No Cars | Great Lakes, Mackinac Island | No cars on the island, so the agents share a tandem. Control starts Protocol QUIET: the Office now seizes what the other two hold. Quist, alone for a minute, asks what the Book does with them. | `protocol-quiet` (always), `quist-turned` |
| office.6 Annex 9 | Southwest desert, Roswell | The Office's store. If the Lamplighters' raid came first (`annex-raided`) the cages are empty and Pell is writing it up; if not, they are full and Quist is counting. | - |
| office.7 Jurisdiction | Bayou, Barataria | The agents chase Lamplighter boats in a pirogue. Straight: you tell them where the boats go. Dry: you point the wrong way. Hard: you block the channel. | `cache-burned` (straight) |
| office.8 Two Forms | Ozarks, Texarkana | The federal building stands on a state line, so everything needs two forms. Section Chief Brandt comes in person with Asset 0. Her team is smaller if Quist turned. | `office-closed` |

### The Institute: "The Protocol"

| Step | Where | What happens | Sets |
| --- | --- | --- | --- |
| institute.1 Baseline | Pine Barrens, Blue Hole | Toby is in waders in the spring. Dr. Vale wants a baseline: your lead on the scale. Straight: you allow it. Dry: you offer a pebble. Hard: no, and a technician's specimens test you. | `sample-given` |
| institute.2 Cold Room | Appalachian hollows, McClintic | The old concrete igloos are the Institute's cold store. Vale offers Reagent 12, their own ink, for data. | `reagent-taken` |
| institute.3 Field Guide | Great North Woods, Cox's field guide | The Institute treats the 1910 lumberwoods guide as a protocol. They want squonk tears; a bearer who holds a squonk is asked to lend it. | `squonk-lent` |
| institute.4 Ash Layer | Pacific Northwest, Mount St. Helens | Ms. Carrow arrives to count deliverables: twelve specimens, and they have nine. She looks at your line-up. | `carrow-counted` |
| institute.5 The Long Study | Great Lakes, Isle Royale | Vale admires a study that has run since 1958; she has nine days of money. Toby asks you to take a specimen out before the Office comes for the cold room. | `specimen-freed` |
| institute.6 Field Strength | Southwest desert, Meteor Crater | They have built a meter for the twelve fields and want the Book near it. It reads one thing, every time, and Vale will not say what. | `meter-read` |
| institute.7 Grant Review | Bayou, Okeechobee | Carrow will cut the grant unless they tag the rougarou, and Vale's plan uses Toby as the lure. Straight: you get Toby out. Dry: you tell Carrow. Hard: you fight Vale's team. | `toby-out` |
| institute.8 Final Report | Ozarks, Tornado Alley | A storm-chase rig on the plains. Vale's last test is the Book itself: "Put the Book on the scale." Her rig is short-handed if Toby left. | `institute-closed` |

### The Lamplighters: "The Line"

| Step | Where | What happens | Sets |
| --- | --- | --- | --- |
| lamplighters.1 First Lamp | Pine Barrens, Wharton Forest (after your first night) | Wren Ashby stands at a path light. The lights are theirs, and you have been walking on them. She asks why you carry the Book. Straight earns a lamp. | `lamp-carried` |
| lamplighters.2 Dead Drop | Appalachian hollows, Tug Fork | No radios near Green Bank, so they use lamps and mirrors. Pip needs a message carried past the Office's cordon. | `message-run` |
| lamplighters.3 Tall Tales | Great North Woods, Logging camp | The camps' tall tales are the Lamplighters' code book. Old Dutch asks you to leave the hidebehind alone; if the Book holds one already, they count it. | `tale-kept` |
| lamplighters.4 The Road Shut | Pacific Northwest, Redwood Creek | They keep people off the ridge and ask for a promise: beat the giant if you must, do not bind it. The promise is checked later. | `ridge-promise` |
| lamplighters.5 Night Boat | Great Lakes, Lake Champlain | They move creatures over the lake after dark. If Protocol QUIET has begun, a safe house is already empty, and Wren plans a raid. | `raid-plan` |
| lamplighters.6 Annex Raid | Southwest desert, White Sands | The raid on Annex 9, against Office cordon officers. Easier if you have stood inside the Annex. | `annex-raided` |
| lamplighters.7 Smugglers' Bay | Bayou, Barataria | The same bay as office.7. If you sent the Office here first, it is a rescue; if you get here first, the Office finds it empty. | `bay-held` |
| lamplighters.8 The Long Haul | Ozarks, Route 66 | Old Dutch's truck, and Wren's own team that walks with her. Her verdict reads your whole past. | `lamplighters-closed` |

## Where the three cross

| Crossing | Order that matters |
| --- | --- |
| Who met you first | Each faction's first hail has a line for being first, second or third. |
| Your name | `office-file` or `office-gary`: the Institute buys Office files and addresses you by what is on yours; the Lamplighters trust you less if you signed. |
| Green Bank | office.2 before lamplighters.2: Pip asks what you told the suits. After: Pell has a report of a light signal. |
| Reagent 12 | `reagent-taken`: the Office wants the bottle; the Lamplighters will not stand near it. |
| The hidebehind | Holding one before lamplighters.3 changes that step. It is always behind you, like they are. |
| Protocol QUIET | office.5 done turns institute.5 and lamplighters.5 from warnings into losses. |
| The Annex | lamplighters.6 before office.6: empty cages. After: you can draw the rooms, and the raid is easier. |
| Barataria | office.7 and lamplighters.7 share a section. Whichever you do first rewrites the other. |
| Toby | `toby-out` with the Lamplighters met: he turns up at a Lamplighter post. |
| The ridge | `ridge-promise` then a bound Sasquatch: the Lamplighters know, and their standing drops once. |
| The finales | The first quest you close makes the other two finales harder; the last faction standing gets the others' leftovers. |
| The howler's hollow | With all three closed, all three arrive at the last stone at once, late, in the order you finished them. |

## Posts

Each faction holds three posts a region, in the sections below, manned once you have met the faction and opened the
section. A post is one trainer with a team from the creatures of the sections behind you. Beaten, it asks for another
go a day later. Two factions in one section is contested ground, and their lines say so. Nobody posts at Sásq'ets or
in Monument Valley.

| Region | Office | Institute | Lamplighters | Contested |
| --- | --- | --- | --- | --- |
| 1 Pine Barrens | 0, 6, 9 | 3, 6, 10 | 1, 7, 9 | 6 Cranberry bogs (Office, Institute), 9 Ong's Hat (Office, Lamplighters) |
| 2 Appalachian hollows | 0, 7, 10 | 3, 6, 7 | 1, 4, 10 | 7 Flatwoods (Office, Institute), 10 Silver Bridge (Office, Lamplighters) |
| 3 Great North Woods | 4, 7, 9 | 1, 5, 9 | 3, 6, 7 | 9 Moosehead Lake (Office, Institute), 7 Paul Bunyan (Office, Lamplighters) |
| 4 Pacific Northwest | 0, 6, 9 | 1, 5, 9 | 2, 3, 6 | 9 Crater Lake (Office, Institute), 6 Bluff Creek (Office, Lamplighters) |
| 5 Great Lakes | 2, 3, 9 | 0, 9, 10 | 1, 4, 10 | 9 The photograph (Office, Institute), 10 Valcour Island (Institute, Lamplighters) |
| 6 Southwest desert | 0, 3, 7 | 5, 7, 9 | 3, 8, 9 | 7 Death Valley (Office, Institute), 3 Carlsbad Caverns (Office, Lamplighters), 9 Douglas (Institute, Lamplighters) |
| 7 Bayou | 0, 2, 9 | 1, 2, 8 | 3, 5, 8 | 2 Honey Island (Office, Institute), 8 Skunk ape (Institute, Lamplighters) |
| 8 Ozarks | 3, 6, 9 | 2, 4, 9 | 0, 6, 10 | 9 Fouke (Office, Institute), 6 Wichita Mountains (Office, Lamplighters) |

## Hooks

A hook is something that happened outside a faction's own quest. Each faction has an `echoes` line for every hook
that is not its own doing, said once, the next time you walk up to one of its people.

- Your deeds: `mythic-bound`, `mythic-loose` (beaten, not bound), `hunt-closed`, `binds-8`, `binds-16`, `long-away` (three days or more).
- The Office's: `office-file`, `office-gary`, `protocol-quiet`, `cache-burned`, `quist-turned`, `office-closed`.
- The Institute's: `sample-given`, `reagent-taken`, `squonk-lent`, `specimen-freed`, `toby-out`, `institute-closed`.
- The Lamplighters': `lamp-carried`, `message-run`, `ridge-promise`, `annex-raided`, `bay-held`, `lamplighters-closed`.

## Seeing them

- **On the ground.** Within 40 m each faction person has a name tag, as the wild ones do: who they are, then the
  faction and the step ("Agent Pell", "The Office · The Wooden One"), or a post's rank. A quest giver's tag has a
  sparkle, and a resting post says so.
- **On the map.** The corner map and the big map mark every step waiting behind you with a diamond, and the posts
  of the region you are in with a dot, in the faction's coat colour; a resting post is dimmed.
- **In the Compendium.** The Factions chapter lists each faction you have met, in the order you met them: what they
  call you, where you stand (now, on the whole, and which way it goes), every step you have done with its line, and
  where the next waits. The Book writes its own line over it.

## In a party

Everyone plays their own journey, but a party answers a faction as one, the way it answers the Book
(`src/book-party.ts`). When a step's question is up, only the host's replies work; a guest's sheet says who it waits
on ("Agent Pell is waiting on Ada.") and closes with the host's reply when it comes, with the same flags and sway in
the guest's own save. If the host's step is another one, or the host has not answered in half a minute, the guest
answers for themselves. The party size goes into every moment (`party`, the intro snapshot, the `in-company-*`
crossings): the friends walking your region with you or the party reading the Book with you, whichever is more. A
friend who takes on a faction's team is told to the others in the room ("Ada is fighting a team of the Office of
Unlisted Fauna."), as a wild one is.

## Jump links

`?faction=<step>` (`?faction=office.3`, any of the 24 steps) opens the world at that step: a fresh journey with
every region before it cleared and its mythic bound, its own region cleared up to the step's stone, and the
faction's earlier steps played through the real engine with the straight reply and a won fight
(`src/factions/jump.ts`). You stand a few metres from whoever waits there. Nothing of it is saved: your own journey
and map are there again on the next load. `scripts/manual-runs-lib.ts` carries these links for the manual runs.
