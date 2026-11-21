//! A player's own plugin, CLAP or VST3, behind one surface (#5268): the desk (through `fm_plugin_*`) opens a file,
//! lists it, starts a plugin, sends notes and slider moves, and asks for blocks, and never asks which format it is.
//! The format comes from the file's name: `.vst3` is VST3, anything else is tried as CLAP.

use crate::clap::{self, gui::Kind, Descriptor, Param};
use crate::vst3;
use std::sync::Arc;

pub enum Bundle { Clap(Arc<clap::Bundle>), Vst3(Arc<vst3::Bundle>) }

pub enum Plugin { Clap(clap::Plugin), Vst3(vst3::Plugin) }

pub fn is_vst3(path: &str) -> bool {
    std::path::Path::new(path).extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("vst3"))
}

impl Bundle {
    /// Opens a `.clap` or a `.vst3` (a file, or a bundle folder): `Err` says why not, for the track menu.
    pub fn open(path: &str) -> Result<Bundle, String> {
        if is_vst3(path) { vst3::Bundle::open(path).map(Bundle::Vst3) } else { clap::Bundle::open(path).map(Bundle::Clap) }
    }

    pub fn plugins(&self) -> Vec<Descriptor> {
        match self { Bundle::Clap(b) => b.plugins(), Bundle::Vst3(b) => b.plugins() }
    }

    /// Starts plugin `index` at `sample_rate`; it keeps the bundle's library loaded until it's dropped.
    pub fn make(&self, index: u32, sample_rate: f64) -> Result<Plugin, String> {
        match self {
            Bundle::Clap(b) => clap::Plugin::new(b, index, sample_rate).map(Plugin::Clap),
            Bundle::Vst3(b) => vst3::Plugin::new(b, index, sample_rate).map(Plugin::Vst3),
        }
    }
}

impl Plugin {
    pub fn note_on(&mut self, key: u32, velocity: f64, channel: u32) {
        match self { Plugin::Clap(p) => p.note_on(key, velocity, channel), Plugin::Vst3(p) => p.note_on(key, velocity, channel) }
    }
    pub fn note_off(&mut self, key: u32, channel: u32) {
        match self { Plugin::Clap(p) => p.note_off(key, channel), Plugin::Vst3(p) => p.note_off(key, channel) }
    }
    pub fn set_param(&mut self, id: u32, value: f64) {
        match self { Plugin::Clap(p) => p.set_param(id, value), Plugin::Vst3(p) => p.set_param(id, value) }
    }
    pub fn params(&self) -> Vec<Param> {
        match self { Plugin::Clap(p) => p.params(), Plugin::Vst3(p) => p.params() }
    }
    pub fn render(&mut self, out: &mut [f32], frames: usize) -> bool {
        match self { Plugin::Clap(p) => p.render(out, frames), Plugin::Vst3(p) => p.render(out, frames) }
    }
    pub fn take_changes(&mut self, cap: usize) -> String {
        match self { Plugin::Clap(p) => p.take_changes(cap), Plugin::Vst3(p) => p.take_changes(cap) }
    }
    /// How its own editor opens here; a VST3's doesn't yet (#5516).
    pub fn editor_kind(&self) -> Option<Kind> {
        match self { Plugin::Clap(p) => p.editor_kind(), Plugin::Vst3(_) => None }
    }
    pub fn open_editor(&mut self, title: &str) -> Result<(), String> {
        match self {
            Plugin::Clap(p) => p.open_editor(title),
            Plugin::Vst3(p) => Err(format!("{}'s editor doesn't open here yet: FM DAW opens CLAP editors, VST3 ones are next", p.name())),
        }
    }
    pub fn close_editor(&mut self) { if let Plugin::Clap(p) = self { p.close_editor() } }
    pub fn pump(&mut self) -> bool { match self { Plugin::Clap(p) => p.pump(), Plugin::Vst3(_) => false } }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_name_picks_the_format() {
        assert!(is_vst3("/Library/Audio/Plug-Ins/VST3/Synth.VST3"));
        assert!(!is_vst3("/Library/Audio/Plug-Ins/CLAP/Synth.clap"));
        assert!(Bundle::open("/nowhere/Synth.vst3").err().unwrap().contains("couldn't load"));
    }
}
