//! A player's own plugin, CLAP, VST3 or (on macOS) an Audio Unit, behind one surface (#5268, #5517): the desk
//! (through `fm_plugin_*`) opens one, lists it, starts a plugin, sends notes and slider moves, and asks for blocks,
//! and never asks which format it is. The format comes from the name: `au:type:subtype:maker` is an AU (the system
//! keeps those, so `system_plugins` lists them), `.vst3` is VST3, anything else is tried as CLAP.

#[cfg(target_os = "macos")]
use crate::au;
use crate::clap::{self, gui::Kind, Descriptor, Param};
use crate::vst3;
use std::sync::Arc;

pub enum Bundle {
    Clap(Arc<clap::Bundle>),
    Vst3(Arc<vst3::Bundle>),
    #[cfg(target_os = "macos")]
    Au(Arc<au::Bundle>),
}

pub enum Plugin {
    Clap(clap::Plugin),
    Vst3(vst3::Plugin),
    #[cfg(target_os = "macos")]
    Au(au::Plugin),
}

pub fn is_vst3(path: &str) -> bool {
    std::path::Path::new(path).extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("vst3"))
}

/// The plugins the system keeps rather than a folder: the AUs, by their `au:` names. None off macOS.
pub fn system_plugins() -> Vec<String> {
    #[cfg(target_os = "macos")]
    return au::names();
    #[cfg(not(target_os = "macos"))]
    return Vec::new();
}

impl Bundle {
    /// Opens an `au:` name, a `.clap` or a `.vst3` (a file, or a bundle folder): `Err` says why not, for the track menu.
    pub fn open(path: &str) -> Result<Bundle, String> {
        if path.starts_with(crate::au::SCHEME) {
            #[cfg(target_os = "macos")]
            return au::Bundle::open(path).map(Bundle::Au);
            #[cfg(not(target_os = "macos"))]
            return Err(format!("{path} is an Audio Unit: those play on macOS"));
        }
        if is_vst3(path) { vst3::Bundle::open(path).map(Bundle::Vst3) } else { clap::Bundle::open(path).map(Bundle::Clap) }
    }

    pub fn plugins(&self) -> Vec<Descriptor> {
        match self {
            Bundle::Clap(b) => b.plugins(),
            Bundle::Vst3(b) => b.plugins(),
            #[cfg(target_os = "macos")]
            Bundle::Au(b) => b.plugins(),
        }
    }

    /// Starts plugin `index` at `sample_rate`; it keeps the bundle's library loaded until it's dropped.
    pub fn make(&self, index: u32, sample_rate: f64) -> Result<Plugin, String> {
        match self {
            Bundle::Clap(b) => clap::Plugin::new(b, index, sample_rate).map(Plugin::Clap),
            Bundle::Vst3(b) => vst3::Plugin::new(b, index, sample_rate).map(Plugin::Vst3),
            #[cfg(target_os = "macos")]
            Bundle::Au(b) => au::Plugin::new(b, index, sample_rate).map(Plugin::Au),
        }
    }
}

/// The same call on whichever format it is.
macro_rules! each {
    ($self:expr, $p:ident => $e:expr) => {
        match $self {
            Plugin::Clap($p) => $e,
            Plugin::Vst3($p) => $e,
            #[cfg(target_os = "macos")]
            Plugin::Au($p) => $e,
        }
    };
}

impl Plugin {
    pub fn note_on(&mut self, key: u32, velocity: f64, channel: u32) { each!(self, p => p.note_on(key, velocity, channel)) }
    pub fn note_off(&mut self, key: u32, channel: u32) { each!(self, p => p.note_off(key, channel)) }
    pub fn set_param(&mut self, id: u32, value: f64) { each!(self, p => p.set_param(id, value)) }
    pub fn params(&self) -> Vec<Param> { each!(self, p => p.params()) }
    pub fn render(&mut self, out: &mut [f32], frames: usize) -> bool { each!(self, p => p.render(out, frames)) }
    pub fn take_changes(&mut self, cap: usize) -> String { each!(self, p => p.take_changes(cap)) }
    /// How its own editor opens here: a VST3's always inside a window of ours (#5516); an AU's doesn't yet (#5741).
    pub fn editor_kind(&self) -> Option<Kind> {
        match self {
            Plugin::Clap(p) => p.editor_kind(),
            Plugin::Vst3(p) => p.editor_kind(),
            #[cfg(target_os = "macos")]
            Plugin::Au(_) => None,
        }
    }
    pub fn open_editor(&mut self, title: &str) -> Result<(), String> {
        match self {
            Plugin::Clap(p) => p.open_editor(title),
            Plugin::Vst3(p) => p.open_editor(title),
            #[cfg(target_os = "macos")]
            Plugin::Au(p) => Err(format!("{}'s editor doesn't open here yet: FM DAW opens CLAP and VST3 editors, Audio Unit ones come later", p.name())),
        }
    }
    pub fn close_editor(&mut self) {
        match self { Plugin::Clap(p) => p.close_editor(), Plugin::Vst3(p) => p.close_editor(), #[cfg(target_os = "macos")] Plugin::Au(_) => {} }
    }
    pub fn pump(&mut self) -> bool {
        match self { Plugin::Clap(p) => p.pump(), Plugin::Vst3(p) => p.pump(), #[cfg(target_os = "macos")] Plugin::Au(_) => false }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_name_picks_the_format() {
        assert!(is_vst3("/Library/Audio/Plug-Ins/VST3/Synth.VST3"));
        assert!(!is_vst3("/Library/Audio/Plug-Ins/CLAP/Synth.clap"));
        assert!(Bundle::open("/nowhere/Synth.vst3").err().unwrap().contains("couldn't load"));
        let au = Bundle::open("au:aumu:nope:nope").err().unwrap();
        assert!(au.contains(if cfg!(target_os = "macos") { "no Audio Unit" } else { "play on macOS" }), "{au}");
    }
}
