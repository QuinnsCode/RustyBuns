//! One fight the page plays tick by tick (#3657): `Live::new` from two creatures, `step` with both inputs, and
//! `state`, the flat view (state.rs) src/sim-wasm.ts reads into the Match the page, puppets, effects and bots see.
use crate::data::Roster;
use crate::sim::{new_match, step, Input, Match};
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
    /// A fight between the roster's first two creatures (the page sends just those two).
    pub fn new(roster: Roster) -> Result<Live, String> {
        if roster.creatures.len() != 2 {
            return Err("a live match is two creatures".into());
        }
        let roster = Box::into_raw(Box::new(roster));
        // SAFETY: the box is freed only in Drop, after the match that borrows it.
        let r: &'static Roster = unsafe { &*roster };
        let m = new_match(&r.chart, &r.creatures[0], &r.creatures[1]);
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
    /// One tick, each side's input as INPUT_LEN numbers.
    pub fn step(&mut self, inputs: &[f64]) {
        step(&mut self.m, [input_of(&inputs[..INPUT_LEN]), input_of(&inputs[INPUT_LEN..2 * INPUT_LEN])]);
        self.refresh();
    }
    /// Fighter `side` takes these numbers (state.rs `walk_fighter`'s layout): what the page wrote into its Match.
    pub fn load(&mut self, side: usize, s: &[f64]) -> Result<(), String> {
        state::load_fighter(&mut self.m, side.min(1), s)?;
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
