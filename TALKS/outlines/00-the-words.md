# The Words
> Every word the other talks use, one plain sentence and one everyday picture each, so nobody nods along and hopes.

## Why a word list
- The Words :: Every word the talks use. One plain sentence each, and an everyday picture. :: a stack of index cards, the top one blank
- Nobody should nod along and hope :: One word you do not know, and the next ten minutes are lost. :: a person in an audience, nodding, with a question mark over their head
- One word, one meaning :: We use the same word for the same thing, every time. No synonyms. :: one key in one lock
- Every word gets a picture :: Each word comes with a thing you already know from home or the street. :: a word card beside a picture card
- Read it once, come back often :: The other talks use only these words. If a talk needs a new word, it comes here first. :: a bookmark in a dictionary

## The basics
- App :: A program you use, like a game or a website. :: a phone and a laptop with the same game on both
- Server :: A computer far away that apps talk to. Like the kitchen behind a restaurant. :: a diner at a table, a kitchen door behind
- The cloud :: Servers you rent by the second. Someone else looks after them. Like a taxi instead of a car. :: a taxi with a server rack in the back seat
- Code :: The written instructions that make an app. Like a recipe. :: a recipe card whose steps are lines of code
- AI helper (agent) :: An AI that reads and writes code when you give it a job. Like a fast, keen apprentice. :: an apprentice at a workbench with a stack of job cards

## The engine
- Rusty Buns :: Our engine. Write an app once and it runs on a laptop, a server or the cloud. Like one plug for every socket. :: one plug, three different wall sockets
- Bun and Rust :: Bun runs JavaScript and TypeScript, fast. Rust is a strict, fast language. Together: the name. :: a bun and a rusty bolt on a plate
- WebAssembly :: A way to run fast code, like Rust, inside a web page. Like a race engine in a family car. :: a family car with a race engine under the bonnet
- Twin :: A TypeScript copy of a Rust part that gives the same answer. If Rust cannot load, the twin takes over. :: an understudy in the wings, script in hand
- Example apps :: The games and tools we built on the engine to prove it works. :: a shelf of jars, each with a label

## The cloud pieces
- Cloudflare :: The company whose computers run most of our apps, all over the world. :: a world map with dots in many cities
- Worker :: A small program on Cloudflare that wakes up when someone visits. Like a shop light on a motion sensor. :: a shop light switching on as someone walks in
- Durable Object :: A tiny, always-correct memory in the cloud. One per game room. Like the referee's notebook. :: a referee writing in a notebook
- The edge :: Cloudflare's computers near each visitor. Like the corner shop, not the warehouse. :: a corner shop next door, a warehouse far away
- The box :: One plain server that holds many small games at once, for cheap. Like a food hall, not a row of restaurants. :: a food hall with many stalls under one roof

## Where the code gets made
- git :: The usual way to store code and its history. Like "track changes" for code. :: a document with tracked changes in the margin
- codeSplitter :: Our git home. Every line wears a name tag, so many helpers can edit one file at once. :: lines of text, each with a small name tag
- Agent Office :: A 3D office where AI helpers sit at desks. Made by WebDevCody; we run our own version. :: a small 3D office floor seen from above
- Worker, the other kind :: One AI helper at one desk, on one job. Not a Cloudflare Worker. Sorry. :: two name badges that both say "Worker"
- Sandbox :: A sealed room for a program. It touches only what you list. :: a playpen with one gate

## The crew
- Mervin :: Joins everyone's changes together using rules, not AI. Puts two helpers in order before they clash. :: a referee holding two players apart, calmly
- Ester :: When a test goes red, finds which change did it and tells that helper. :: a detective with a magnifying glass over a red light
- Dexter :: Watches the helpers, spots the chores they repeat, and asks for a tool. :: a foreman with a clipboard, ticking the same box again
- Bob :: The big second computer. It runs the tests so the main computer stays free. Sometimes Bob naps. :: a large computer on a desk with a charging cable
- Why they have names :: They are scripts. "The merge script" never got a thank-you card. :: a thank-you card addressed to Mervin

## How code moves
- Trunk (main) :: The one shared copy of the code. Every job starts from it and ends in it. :: a tree trunk with short branches
- Pull request :: A proposed change, waiting for a check before it joins the main code. :: an envelope on a desk, stamped "waiting"
- Squash merge :: A finished job joins the trunk as one change, however many steps it took. Like handing in the essay, not the drafts. :: a pile of drafts, one clean essay on top
- Polymorphic edit :: One change that lands in many files, in the shape each file needs. Like changing a surname on every form. :: one surname changed on a stack of forms
- Primitive :: A small, shared building block that many apps use. Like a brick. :: one brick, then a wall of the same bricks

## The players' side
- eqosys :: One account for all our apps: your library, saves and friends. Like a library card for every branch. :: a library card, three branch doors
- Qollab :: The part that connects players to each other. Like the phone lines between houses. :: houses joined by phone lines
- Hub :: Your own spot in Qollab. Friends find you there. Like a porch light. :: a porch light on at night
- Party and space :: A party is a short-lived room with a code. A space is a group that stays, like a club. :: a café table beside a clubhouse
- Ticket (token) :: A signed note from eqosys that says who you are. A game checks it alone. Like a banknote hologram. :: a banknote held up to the light

## How a shared game stays fair
- Physics and the sim :: Physics is how things move, fall and bump. The sim is the game's rules as code, with no pictures. :: a ball on a ramp, then the same scene as numbers
- Tick :: One step of the game. Many per second. Like one frame of a flip book. :: a flip book, one page lifted
- Server authoritative :: The server holds the true game. The referee's call wins. :: a referee's raised hand
- Netcode and interpolation :: Netcode keeps every screen in step. Interpolation draws the smooth moments in between. :: two dots, a smooth curve drawn between them
- Double Dragon :: Our inside name for the twin engine: the same sim in Rust and TypeScript, step for step. :: two matching dragons, mirror images

## How new code reaches people
- Test and CI :: A test checks a program still works. CI is robots that run every test on every change. :: a spell-checker that never sleeps
- Deploy and sweep :: A deploy puts code live. A sweep is a round of tests on a clock: hourly, nightly, weekly. :: a night watchman with a torch
- Release rings :: New code goes to a few people first, then more, then everyone. Like tasting the soup first. :: a spoon, a pot, a full dining room
- Manual run and hill climb :: A manual run needs the owner's own eyes. A hill climb is a score we raise, round by round. :: a hand on a checkbox beside a climbing line chart
- You now speak Bun :: Every other talk uses only these words. Go and enjoy them. :: the stack of index cards from slide one, now filled in
