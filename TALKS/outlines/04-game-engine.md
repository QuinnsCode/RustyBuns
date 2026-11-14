# The Game Engine
> How a shared game stays fair (the referee) and smooth (the commentator), and the buffer engine that smooths twice.

## A football match on the radio
- The Game Engine :: Physics and netcode: how a shared game stays fair, and how it stays smooth. :: a radio with a football pitch inside it
- You hear it a little late :: The match happened half a second ago. You still enjoy it. :: a radio with a small clock showing a delay
- The referee's call is final :: The referee sees the real match. :: a referee with a raised hand
- The commentator fills the gap :: A good commentator never lets it sound like it stopped. :: a commentator at a microphone, talking fast
- Server is referee, screen is commentator :: In our games, the server decides and your screen describes. :: two labels: server above the referee, screen above the commentator
- No invented goals :: The commentator may fill gaps, but never make up a result. :: a goal net with a "no" sign
- Fair, then smooth :: Fair is easy. Smooth is easy. Both at once, over the internet, is the job. :: two halves of a pitch: fair on one side, smooth on the other

## Rules that step, not rules that flow
- The game moves in ticks :: Many small steps every second. :: a flip book, pages fanned
- Each tick, a little :: Everything moves a little, falls a little, bumps a little. :: a ball shown at five small steps down a ramp
- Same start, same game :: The same start and the same presses give the same game, every time. :: two identical flip books side by side
- The sim has no pictures :: The rules run as numbers. The pictures are drawn on top. :: a game scene peeled back to show a grid of numbers
- A test plays with no screen :: A whole game runs and gets checked, with nothing drawn. :: a game running inside a closed box, a tick on the lid
- Robots play thousands of games :: To find bugs and to keep the game balanced. :: many small boxes, each playing a game
- No surprises :: A flip book never surprises you. That is a compliment. :: the flip book, closed, with a gold star

## The server holds the true game
- Your screen sends only your presses :: It sends what you pressed, not where you are. :: a hand pressing a button, an arrow out
- The server runs the rules :: It makes the true frame. :: a referee writing in a notebook
- Everyone gets the true frame :: The same answer goes back to every player. :: one notebook page copied to four screens
- Only what you can see :: In hide and seek, the server never tells you where the hiders are. :: a map with fog everywhere but your circle
- One room, one notebook :: Each game room lives in its own small cloud memory. :: a row of small rooms, each with its own notebook
- A world in pieces :: A big map splits into regions. Each busy region gets its own referee. :: a map cut into tiles, a referee on the busy ones
- The cheapest anti-cheat :: A cheater cannot read what the server never sent. :: an empty envelope labelled "hiders"

## The internet is a post office
- Letters arrive fast, late, or in bunches :: Most come fast. Some come late. A few come together. :: a postbox with letters spilling out unevenly
- Draw each frame as it lands :: The game stutters. :: a choppy line with gaps
- Wait for every frame :: The game feels slow. :: a long queue at a post office counter
- Lag and stutter :: Lag is the whistle arriving late. Stutter is three whistles at once. :: one late whistle beside three bunched whistles
- Your press makes a round trip :: To the server and back, before it counts. :: a button, a long loop to a cloud and back
- So we hide the whistle :: Most of the clever parts are about hiding the delay. :: a whistle tucked under a hat
- Two tools :: Draw the in-betweens on your screen. Buffer the frames on the way. :: two labelled tools on a bench

## Draw the moments in between
- Keep the last few frames :: Your screen holds the last few true frames. :: three cards in a hand
- Draw between them :: It draws smooth moments from one true frame to the next. :: two dots joined by a smooth curve with ghost dots along it
- One breath behind, on purpose :: The screen stays a tiny bit behind the newest frame. :: a runner one step behind a pacer
- Always a next frame :: So there is always a frame to slide toward. :: a hand reaching for the next card
- A late frame is a slower slide :: When a frame is late, the slide simply takes a little longer. :: a slide stretched a little longer on a timeline
- Fix gently :: When a guess is wrong, the next true frame corrects it with no jump. :: a curve bending back onto the true path
- Live today :: In-between frames run in the shared games now. :: a green tag on a game screen

## The buffer engine: smoothing twice
- Smoothing in two places :: A new engine in Rust, running as WebAssembly, smooths at the edge and on your screen. :: two smoothing stations on one road
- Two commentators :: One at the stadium gate, one in your living room. The referee still has the last word. :: a commentator at a gate, another on a sofa
- The long trip and the short trip :: The edge covers the long trip from the server. Your screen covers the short trip home. :: a long road to a gate, then a short path to a house
- A relay race :: Each runner only has to be good at their own stretch. :: two runners passing a baton
- The referee decides :: Smoothing never changes the result. :: the referee's notebook, closed and locked
- What runs, what is rising :: Live: server-held games, smooth screens. Being written: the buffer engine. :: green tags and one amber tag
- Fair first. Then smooth. :: The referee decides. The commentators fill the silence. Nobody invents a goal. :: the radio from slide one, with a whistle on top
