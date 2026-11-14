//! Mythic Masters' fight sim and bot in Rust, bit for bit with src/sim.ts and src/bot.ts (#3628), for the
//! balance tuner (scripts/tune.ts --rust) and the page's fights (live.rs, src/sim-wasm.ts, #3657). Plain
//! synchronous functions over plain data: `step(match, inputs)` and `Bot::act(match)`, no I/O, no clock, no
//! globals. One crate builds the native CLI (src/main.rs, which fans pairings out over threads) and a wasm module
//! (the `run` and `live_*` exports below) with the same answers.
//!
//! In and out is one JSON command (scripts/sim-rust.ts writes it from the TS roster, so the TS stays the source
//! of truth): `{ roster, cmd: "rates" | "trace", pairs: [[i, j]], n?, seeds?, threads? }`. A trace's fight can also be
//! a team fight, `[[i, j], [k]]`: two against one (#3929).
// dmath's constants are fdlibm's, digit for digit the same literals as src/dmath.ts, and the sim indexes both sides by number.
#![allow(clippy::approx_constant, clippy::excessive_precision, clippy::needless_range_loop)]

pub mod bot;
pub mod data;
pub mod dmath;
pub mod json;
pub mod live;
pub mod sim;
pub mod state;

use bot::Bot;
use data::{Chart, Creature, Roster};
use sim::{new_team_match, step, Event, How};

pub struct Played {
    pub winner: usize,
    pub ticks: f64,
    pub how: Option<How>,
    pub hashes: Vec<u32>,
}

/// scripts/tune.ts play: two bots, seeded `seed` and `seed * 7 + 1`, until someone wins. With `trace`, the state
/// hash after every tick (and before the first).
pub fn play(chart: &Chart, a: &Creature, b: &Creature, seed: f64, trace: bool) -> Played {
    play_teams(chart, [&[a], &[b]], seed, trace)
}

/// `play` for teams: a bot a fighter, the first seeded `seed` and fighter k `seed * 7 + k` (scripts/sim-rust.ts tsTrace).
pub fn play_teams(chart: &Chart, teams: [&[&Creature]; 2], seed: f64, trace: bool) -> Played {
    let mut m = new_team_match(chart, teams).expect("someone on each side");
    let mut bots: Vec<Bot> = (0..m.f.len()).map(|k| Bot::new(k, if k == 0 { seed } else { seed * 7.0 + k as f64 })).collect();
    let mut how = None;
    let mut hashes = Vec::new();
    if trace {
        hashes.push(state::hash_match(&m));
    }
    while !m.over {
        let inputs: Vec<_> = bots.iter_mut().map(|b| b.act(&m)).collect();
        step(&mut m, &inputs);
        if how.is_none() {
            how = m.events.iter().find_map(|e| if let Event::Ko { how, .. } = e { Some(*how) } else { None });
        }
        if trace {
            hashes.push(state::hash_match(&m));
        }
    }
    Played {
        winner: m.winner.unwrap_or(0),
        ticks: m.tick,
        how,
        hashes,
    }
}

/// scripts/tune.ts rate: `n` seeds, sides swapped every other one. (wins, ring-outs, time-outs, seconds a fight)
pub fn rate(chart: &Chart, a: &Creature, b: &Creature, n: usize) -> [f64; 4] {
    let (mut wins, mut ring_outs, mut time, mut ticks) = (0.0, 0.0, 0.0, 0.0);
    for s in 1..=n {
        let flip = s % 2 == 0;
        let r = if flip {
            play(chart, b, a, s as f64, false)
        } else {
            play(chart, a, b, s as f64, false)
        };
        if r.winner == (if flip { 1 } else { 0 }) {
            wins += 1.0;
        }
        if r.how == Some(How::RingOut) {
            ring_outs += 1.0;
        }
        if r.how == Some(How::Time) {
            time += 1.0;
        }
        ticks += r.ticks;
    }
    let n = n as f64;
    [wins / n, ring_outs / n, time / n, ticks / n / 60.0]
}

/// Each item of `items` through `f`, on up to `threads` threads (one on wasm), answers in order.
fn fan<T: Sync, R: Send + Default + Clone>(items: &[T], threads: usize, f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    #[cfg(not(target_arch = "wasm32"))]
    if threads > 1 && items.len() > 1 {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Mutex;
        let next = AtomicUsize::new(0);
        let out = Mutex::new(vec![R::default(); items.len()]);
        std::thread::scope(|s| {
            for _ in 0..threads.min(items.len()) {
                s.spawn(|| loop {
                    let k = next.fetch_add(1, Ordering::Relaxed);
                    if k >= items.len() {
                        break;
                    }
                    let r = f(&items[k]);
                    out.lock().unwrap()[k] = r;
                });
            }
        });
        return out.into_inner().unwrap();
    }
    let _ = threads;
    items.iter().map(f).collect()
}

/// Each fight in `pairs`: `[i, j]` one on one, or `[[i, ...], [j, ...]]` a team a side, as roster indices.
fn fights_of(v: &json::Json, roster: &Roster) -> Result<Vec<[Vec<usize>; 2]>, String> {
    let bad = || "pairs: [i, j] or [[i, ...], [j, ...]] roster indices".to_string();
    let ok = |x: f64| x >= 0.0 && x.fract() == 0.0 && (x as usize) < roster.creatures.len();
    let side = |s: &json::Json| -> Result<Vec<usize>, String> {
        let s = match s.nums() {
            Ok(xs) => xs,
            Err(_) => return Err(bad()),
        };
        if !s.is_empty() && s.iter().all(|&x| ok(x)) {
            Ok(s.iter().map(|&x| x as usize).collect())
        } else {
            Err(bad())
        }
    };
    v.get("pairs")?
        .arr()?
        .iter()
        .map(|p| {
            let p = p.arr()?;
            if p.len() != 2 {
                return Err(bad());
            }
            match (p[0].num(), p[1].num()) {
                (Ok(i), Ok(j)) if ok(i) && ok(j) => Ok([vec![i as usize], vec![j as usize]]),
                (Ok(_), _) | (_, Ok(_)) => Err(bad()),
                _ => Ok([side(&p[0])?, side(&p[1])?]),
            }
        })
        .collect()
}
fn pairs_of(v: &json::Json, roster: &Roster) -> Result<Vec<(usize, usize)>, String> {
    fights_of(v, roster)?
        .into_iter()
        .map(|[a, b]| {
            if a.len() == 1 && b.len() == 1 {
                Ok((a[0], b[0]))
            } else {
                Err("rates: one on one pairs only".to_string())
            }
        })
        .collect()
}

/// One command, as JSON in and JSON out (see the crate docs).
pub fn run(input: &str, default_threads: usize) -> Result<String, String> {
    let v = json::parse(input)?;
    let roster = data::roster_of(v.get("roster")?).map_err(|e| format!("roster: {e}"))?;
    let threads = v.opt("threads").map(|t| t.num()).transpose()?.map_or(default_threads, |t| t.max(1.0) as usize);
    let (chart, cs) = (&roster.chart, &roster.creatures);
    let mut out = String::new();
    match v.get("cmd")?.str()? {
        "rates" => {
            let pairs = pairs_of(&v, &roster)?;
            let n = v.field("n")?.max(1.0) as usize;
            let got = fan(&pairs, threads, |&(i, j)| rate(chart, &cs[i], &cs[j], n));
            out.push('[');
            for (k, r) in got.iter().enumerate() {
                if k > 0 {
                    out.push(',');
                }
                out.push('[');
                for (q, x) in r.iter().enumerate() {
                    if q > 0 {
                        out.push(',');
                    }
                    json::num(&mut out, *x);
                }
                out.push(']');
            }
            out.push(']');
        }
        "trace" => {
            let seeds = v.get("seeds")?.nums()?;
            let teams = fights_of(&v, &roster)?;
            let fights: Vec<(&[Vec<usize>; 2], f64)> = teams.iter().flat_map(|t| seeds.iter().map(move |&s| (t, s))).collect();
            let got = fan(&fights, threads, |&(t, s)| {
                let side = |k: usize| t[k].iter().map(|&i| &cs[i]).collect::<Vec<_>>();
                let (a, b) = (side(0), side(1));
                let p = play_teams(chart, [&a, &b], s, true);
                (p.winner, p.ticks, p.hashes)
            });
            out.push('[');
            for (k, (winner, ticks, hashes)) in got.iter().enumerate() {
                if k > 0 {
                    out.push(',');
                }
                out.push_str(&format!("{{\"winner\":{winner},\"ticks\":{ticks},\"hashes\":["));
                for (q, h) in hashes.iter().enumerate() {
                    if q > 0 {
                        out.push(',');
                    }
                    out.push_str(&h.to_string());
                }
                out.push_str("]}");
            }
            out.push(']');
        }
        c => return Err(format!("cmd {c}: rates or trace")),
    }
    Ok(out)
}

// The wasm face: no bindings crate, just memory. The page (or a test) asks `alloc(len)` for room, writes the
// command's UTF-8 there, calls `run(ptr, len)`, and reads `out_len()` bytes back from the pointer it returns
// (a JSON answer, or `{"error": "..."}`). One fight at a time, in one thread.
#[cfg(target_arch = "wasm32")]
mod wasm {
    use std::cell::RefCell;
    thread_local! { static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) }; }

    #[no_mangle]
    pub extern "C" fn alloc(len: usize) -> *mut u8 {
        let mut v = Vec::<u8>::with_capacity(len);
        let p = v.as_mut_ptr();
        std::mem::forget(v);
        p
    }
    /// # Safety
    /// `ptr` came from `alloc(len)` and holds `len` bytes; it is freed here.
    #[no_mangle]
    pub unsafe extern "C" fn run(ptr: *mut u8, len: usize) -> *const u8 {
        let input = Vec::from_raw_parts(ptr, len, len);
        let answer = match std::str::from_utf8(&input) {
            Ok(s) => super::run(s, 1).unwrap_or_else(|e| format!("{{\"error\":{:?}}}", e)),
            Err(e) => format!("{{\"error\":{:?}}}", e.to_string()),
        };
        OUT.with(|o| {
            *o.borrow_mut() = answer.into_bytes();
            o.borrow().as_ptr()
        })
    }
    #[no_mangle]
    pub extern "C" fn out_len() -> usize {
        OUT.with(|o| o.borrow().len())
    }

    // The page's fight (src/sim-wasm.ts), one at a time: `live_new` with `{ roster, left? }` of just the creatures in it,
    // the first `left` (default 1) on one team and the rest on the other (as `alloc` + `run` take a command; 0 and the
    // error in `out_len` bytes at `out_ptr`, or 1), then each tick every fighter's input into `live_io` (live::INPUT_LEN
    // numbers each) and `live_step`, and the state is `live_state_len` numbers
    // at `live_state`. A fighter the page changed goes back in the same way: its numbers into `live_io`, `live_load`.
    thread_local! {
        static LIVE: RefCell<Option<crate::live::Live>> = const { RefCell::new(None) };
        static IO: RefCell<Vec<f64>> = RefCell::new(vec![0.0; 256]);
    }
    fn fail(e: String) -> u32 {
        OUT.with(|o| *o.borrow_mut() = e.into_bytes());
        0
    }
    #[no_mangle]
    pub extern "C" fn out_ptr() -> *const u8 {
        OUT.with(|o| o.borrow().as_ptr())
    }
    /// # Safety
    /// `ptr` came from `alloc(len)` and holds `len` bytes; it is freed here.
    #[no_mangle]
    pub unsafe extern "C" fn live_new(ptr: *mut u8, len: usize) -> u32 {
        let input = Vec::from_raw_parts(ptr, len, len);
        let made = std::str::from_utf8(&input)
            .map_err(|e| e.to_string())
            .and_then(crate::json::parse)
            .and_then(|v| {
                let left = v.opt("left").map(|x| x.num()).transpose()?.map_or(1, |x| x.max(0.0) as usize);
                crate::live::Live::new(crate::data::roster_of(v.get("roster")?)?, left)
            });
        LIVE.with(|l| *l.borrow_mut() = None); // the last fight's match and roster go first
        match made {
            Ok(live) => {
                LIVE.with(|l| *l.borrow_mut() = Some(live));
                1
            }
            Err(e) => fail(e),
        }
    }
    #[no_mangle]
    pub extern "C" fn live_io() -> *mut f64 {
        IO.with(|io| io.borrow_mut().as_mut_ptr())
    }
    #[no_mangle]
    pub extern "C" fn live_step() {
        IO.with(|io| LIVE.with(|l| l.borrow_mut().as_mut().map(|live| live.step(&io.borrow()))));
    }
    #[no_mangle]
    pub extern "C" fn live_load(side: usize, len: usize) -> u32 {
        let done = IO.with(|io| LIVE.with(|l| l.borrow_mut().as_mut().map(|live| live.load(side, &io.borrow()[..len.min(256)]))));
        match done {
            Some(Ok(())) => 1,
            Some(Err(e)) => fail(e),
            None => fail("no live match".into()),
        }
    }
    #[no_mangle]
    pub extern "C" fn live_state() -> *const f64 {
        LIVE.with(|l| l.borrow().as_ref().map_or(std::ptr::null(), |live| live.state().as_ptr()))
    }
    #[no_mangle]
    pub extern "C" fn live_state_len() -> usize {
        LIVE.with(|l| l.borrow().as_ref().map_or(0, |live| live.state().len()))
    }
}
