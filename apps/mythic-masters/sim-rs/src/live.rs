//! One fight the page plays tick by tick (#3657): `Live::new` from its creatures and teams, `step` with every input, and
//! `state`, the flat view (state.rs) src/sim-wasm.ts reads into the Match the page, puppets, effects and bots see.
use crate::data::{Creature, Roster};
use crate::sim::{new_team_match, step, Input, Match};
use crate::state::{self, KEYS};
use std::mem::ManuallyDrop;

/// An Input as 11 numbers: mx, mz, then each button (0 or 1) in sim.ts Input's order.
pub const INPUT_LEN: usize = 11;

pub fn input_of(s: &[f64]) -> Input {
    let mut i = Input {
        mx: s[0],
        mz: s[1],
        ..Input::default()
    };
    for (k, key) in KEYS.iter().enumerate() {
        i.set(*key, s[2 + k] != 0.0);
    }
    i
}

/// The match borrows its roster, so the two live together: the roster is boxed (it never moves) and the match is
/// dropped before it.
pub struct Live {
    m: ManuallyDrop<Match<'static>>,
    roster: *mut Roster,
    state: Vec<f64>,
}

impl Live {
    /// A fight between the roster's creatures (the page sends just those in it): `left` of them on the first team,
    /// the rest on the second (one on one, the first against the second).
    pub fn new(roster: Roster, left: usize) -> Result<Live, String> {
        if left == 0 || left >= roster.creatures.len() {
            return Err("a live match needs someone on each side".into());
        }
        let roster = Box::into_raw(Box::new(roster));
        // SAFETY: the box is freed only in Drop, after the match that borrows it.
        let r: &'static Roster = unsafe { &*roster };
        let cs: Vec<&Creature> = r.creatures.iter().collect();
        let m = match new_team_match(&r.chart, [&cs[..left], &cs[left..]]) {
            Ok(m) => m,
            Err(e) => {
                // SAFETY: nothing borrows the roster yet.
                drop(unsafe { Box::from_raw(roster) });
                return Err(e);
            }
        };
        let mut live = Live {
            m: ManuallyDrop::new(m),
            roster,
            state: Vec::with_capacity(512),
        };
        live.refresh();
        Ok(live)
    }
    fn refresh(&mut self) {
        state::flat(&self.m, &mut self.state);
    }
    /// One tick, each fighter's input as INPUT_LEN numbers, in order.
    pub fn step(&mut self, inputs: &[f64]) {
        let all: Vec<Input> = (0..self.m.f.len())
            .map(|k| inputs.get(k * INPUT_LEN..(k + 1) * INPUT_LEN).map_or(Input::default(), input_of))
            .collect();
        step(&mut self.m, &all);
        self.refresh();
    }
    /// Fighter `side` takes these numbers (state.rs `walk_fighter`'s layout): what the page wrote into its Match.
    pub fn load(&mut self, side: usize, s: &[f64]) -> Result<(), String> {
        if side >= self.m.f.len() {
            return Err(format!("no fighter {side}"));
        }
        state::load_fighter(&mut self.m, side, s)?;
        self.refresh();
        Ok(())
    }
    pub fn state(&self) -> &[f64] {
        &self.state
    }
}

impl Drop for Live {
    fn drop(&mut self) {
        // SAFETY: the match goes first, then the roster it borrowed, which nothing else holds.
        unsafe {
            ManuallyDrop::drop(&mut self.m);
            drop(Box::from_raw(self.roster));
        }
    }
}
