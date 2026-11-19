//! A player's own CLAP plugin, hosted in the desktop app (#5244). Desktop only: the wasm build leaves this out.
//!
//! CLAP is a plain C interface, so it is written out here by hand (only the parts a host needs) rather than pulled
//! in as a crate: the engine keeps no dependencies. A `.clap` file (on macOS a bundle folder) is a library with one
//! symbol, `clap_entry`; its factory names the plugins inside and makes them. [`Bundle`] is the opened file,
//! [`Plugin`] one running plugin: notes and parameter changes go into a queue, and [`Plugin::render`] hands them to
//! the plugin with the next block and adds its stereo output into an interleaved buffer, the same layout `fm_render` writes.
//!
//! Threads: CLAP wants `init`/`activate` on a main thread and `process` on an audio thread. Everything here is
//! called from the one thread that owns the handle, which a plugin accepts (we don't offer the thread-check
//! extension, so it can't tell). A plugin runs in this process: one that crashes takes the app with it.
//!
//! [`tone`] is a plugin of our own, exported from this library as `clap_entry`, so the host can be tried (and
//! tested) without anyone's plugin installed.

use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

pub mod gui;
pub mod tone;

// ---- the CLAP ABI (clap/include/clap/*.h, version 1.2) ----

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ClapVersion { pub major: u32, pub minor: u32, pub revision: u32 }
pub const CLAP_VERSION: ClapVersion = ClapVersion { major: 1, minor: 2, revision: 2 };

#[repr(C)]
pub struct ClapPluginEntry {
    pub clap_version: ClapVersion,
    pub init: unsafe extern "C" fn(plugin_path: *const c_char) -> bool,
    pub deinit: unsafe extern "C" fn(),
    pub get_factory: unsafe extern "C" fn(factory_id: *const c_char) -> *const c_void,
}

#[repr(C)]
pub struct ClapPluginFactory {
    pub get_plugin_count: unsafe extern "C" fn(f: *const ClapPluginFactory) -> u32,
    pub get_plugin_descriptor: unsafe extern "C" fn(f: *const ClapPluginFactory, index: u32) -> *const ClapPluginDescriptor,
    pub create_plugin: unsafe extern "C" fn(f: *const ClapPluginFactory, host: *const ClapHost, plugin_id: *const c_char) -> *const ClapPlugin,
}

#[repr(C)]
pub struct ClapPluginDescriptor {
    pub clap_version: ClapVersion,
    pub id: *const c_char,
    pub name: *const c_char,
    pub vendor: *const c_char,
    pub url: *const c_char,
    pub manual_url: *const c_char,
    pub support_url: *const c_char,
    pub version: *const c_char,
    pub description: *const c_char,
    pub features: *const *const c_char,
}

#[repr(C)]
pub struct ClapHost {
    pub clap_version: ClapVersion,
    pub host_data: *mut c_void,
    pub name: *const c_char,
    pub vendor: *const c_char,
    pub url: *const c_char,
    pub version: *const c_char,
    pub get_extension: unsafe extern "C" fn(h: *const ClapHost, id: *const c_char) -> *const c_void,
    pub request_restart: unsafe extern "C" fn(h: *const ClapHost),
    pub request_process: unsafe extern "C" fn(h: *const ClapHost),
    pub request_callback: unsafe extern "C" fn(h: *const ClapHost),
}

#[repr(C)]
pub struct ClapPlugin {
    pub desc: *const ClapPluginDescriptor,
    pub plugin_data: *mut c_void,
    pub init: unsafe extern "C" fn(p: *const ClapPlugin) -> bool,
    pub destroy: unsafe extern "C" fn(p: *const ClapPlugin),
    pub activate: unsafe extern "C" fn(p: *const ClapPlugin, sample_rate: f64, min_frames: u32, max_frames: u32) -> bool,
    pub deactivate: unsafe extern "C" fn(p: *const ClapPlugin),
    pub start_processing: unsafe extern "C" fn(p: *const ClapPlugin) -> bool,
    pub stop_processing: unsafe extern "C" fn(p: *const ClapPlugin),
    pub reset: unsafe extern "C" fn(p: *const ClapPlugin),
    pub process: unsafe extern "C" fn(p: *const ClapPlugin, process: *const ClapProcess) -> i32,
    pub get_extension: unsafe extern "C" fn(p: *const ClapPlugin, id: *const c_char) -> *const c_void,
    pub on_main_thread: unsafe extern "C" fn(p: *const ClapPlugin),
}

#[repr(C)]
pub struct ClapAudioBuffer {
    pub data32: *mut *mut f32,
    pub data64: *mut *mut f64,
    pub channel_count: u32,
    pub latency: u32,
    pub constant_mask: u64,
}

#[repr(C)]
pub struct ClapProcess {
    pub steady_time: i64,
    pub frames_count: u32,
    pub transport: *const c_void,
    pub audio_inputs: *const ClapAudioBuffer,
    pub audio_outputs: *mut ClapAudioBuffer,
    pub audio_inputs_count: u32,
    pub audio_outputs_count: u32,
    pub in_events: *const ClapInputEvents,
    pub out_events: *const ClapOutputEvents,
}

#[repr(C)]
pub struct ClapInputEvents {
    pub ctx: *mut c_void,
    pub size: unsafe extern "C" fn(list: *const ClapInputEvents) -> u32,
    pub get: unsafe extern "C" fn(list: *const ClapInputEvents, index: u32) -> *const ClapEventHeader,
}

#[repr(C)]
pub struct ClapOutputEvents {
    pub ctx: *mut c_void,
    pub try_push: unsafe extern "C" fn(list: *const ClapOutputEvents, event: *const ClapEventHeader) -> bool,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ClapEventHeader { pub size: u32, pub time: u32, pub space_id: u16, pub kind: u16, pub flags: u32 }

pub const EVENT_NOTE_ON: u16 = 0;
pub const EVENT_NOTE_OFF: u16 = 1;
pub const EVENT_PARAM_VALUE: u16 = 5;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ClapEventNote { pub header: ClapEventHeader, pub note_id: i32, pub port_index: i16, pub channel: i16, pub key: i16, pub velocity: f64 }

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ClapEventParamValue {
    pub header: ClapEventHeader,
    pub param_id: u32,
    pub cookie: *mut c_void,
    pub note_id: i32,
    pub port_index: i16,
    pub channel: i16,
    pub key: i16,
    pub value: f64,
}

pub const NAME_SIZE: usize = 256;
pub const PATH_SIZE: usize = 1024;

#[repr(C)]
pub struct ClapParamInfo {
    pub id: u32,
    pub flags: u32,
    pub cookie: *mut c_void,
    pub name: [c_char; NAME_SIZE],
    pub module: [c_char; PATH_SIZE],
    pub min_value: f64,
    pub max_value: f64,
    pub default_value: f64,
}
/// A parameter the plugin shows but nobody may set (a meter): left off the sliders.
pub const PARAM_IS_READONLY: u32 = 1 << 5;
pub const PARAM_IS_HIDDEN: u32 = 1 << 4;
pub const PARAM_IS_STEPPED: u32 = 1 << 0;

#[repr(C)]
pub struct ClapPluginParams {
    pub count: unsafe extern "C" fn(p: *const ClapPlugin) -> u32,
    pub get_info: unsafe extern "C" fn(p: *const ClapPlugin, index: u32, info: *mut ClapParamInfo) -> bool,
    pub get_value: unsafe extern "C" fn(p: *const ClapPlugin, id: u32, out: *mut f64) -> bool,
    pub value_to_text: unsafe extern "C" fn(p: *const ClapPlugin, id: u32, value: f64, out: *mut c_char, cap: u32) -> bool,
    pub text_to_value: unsafe extern "C" fn(p: *const ClapPlugin, id: u32, text: *const c_char, out: *mut f64) -> bool,
    pub flush: unsafe extern "C" fn(p: *const ClapPlugin, inp: *const ClapInputEvents, out: *const ClapOutputEvents),
}

#[repr(C)]
pub struct ClapAudioPortInfo {
    pub id: u32,
    pub name: [c_char; NAME_SIZE],
    pub flags: u32,
    pub channel_count: u32,
    pub port_type: *const c_char,
    pub in_place_pair: u32,
}

#[repr(C)]
pub struct ClapPluginAudioPorts {
    pub count: unsafe extern "C" fn(p: *const ClapPlugin, is_input: bool) -> u32,
    pub get: unsafe extern "C" fn(p: *const ClapPlugin, index: u32, is_input: bool, info: *mut ClapAudioPortInfo) -> bool,
}

pub const PLUGIN_FACTORY_ID: &CStr = c"clap.plugin-factory";
pub const EXT_PARAMS: &CStr = c"clap.params";
pub const EXT_AUDIO_PORTS: &CStr = c"clap.audio-ports";

// ---- opening a library ----

#[cfg(unix)]
mod dl {
    use std::ffi::{c_char, c_int, c_void};
    extern "C" {
        fn dlopen(path: *const c_char, flags: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
        fn dlclose(handle: *mut c_void) -> c_int;
    }
    const RTLD_NOW: c_int = 2;
    pub unsafe fn open(path: &std::ffi::CStr) -> *mut c_void { dlopen(path.as_ptr(), RTLD_NOW) }
    pub unsafe fn sym(h: *mut c_void, name: &std::ffi::CStr) -> *mut c_void { dlsym(h, name.as_ptr()) }
    pub unsafe fn close(h: *mut c_void) { dlclose(h); }
}

#[cfg(windows)]
mod dl {
    use std::ffi::{c_char, c_void};
    extern "system" {
        fn LoadLibraryA(path: *const c_char) -> *mut c_void;
        fn GetProcAddress(h: *mut c_void, name: *const c_char) -> *mut c_void;
        fn FreeLibrary(h: *mut c_void) -> i32;
    }
    pub unsafe fn open(path: &std::ffi::CStr) -> *mut c_void { LoadLibraryA(path.as_ptr()) }
    pub unsafe fn sym(h: *mut c_void, name: &std::ffi::CStr) -> *mut c_void { GetProcAddress(h, name.as_ptr()) }
    pub unsafe fn close(h: *mut c_void) { FreeLibrary(h); }
}

/// The library file inside a `.clap`: on macOS a bundle folder, `Foo.clap/Contents/MacOS/Foo`; elsewhere the file itself.
pub fn binary_of(path: &str) -> String {
    let p = std::path::Path::new(path);
    if p.is_dir() {
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let inner = p.join("Contents").join("MacOS").join(stem);
        if inner.exists() { return inner.to_string_lossy().into_owned(); }
        if let Ok(dir) = std::fs::read_dir(p.join("Contents").join("MacOS")) {
            if let Some(f) = dir.flatten().next() { return f.path().to_string_lossy().into_owned(); }
        }
    }
    path.to_string()
}

/// One plugin a bundle holds, as the track menu lists it.
pub struct Descriptor { pub id: String, pub name: String, pub vendor: String, pub version: String, pub features: Vec<String> }

unsafe fn text(p: *const c_char) -> String {
    if p.is_null() { String::new() } else { CStr::from_ptr(p).to_string_lossy().into_owned() }
}

/// An opened `.clap`: its library stays loaded (and its entry initialised) while any plugin made from it runs.
pub struct Bundle {
    lib: *mut c_void,
    entry: *const ClapPluginEntry,
    factory: *const ClapPluginFactory,
}

// The entry and factory are thread-safe by the CLAP spec.
unsafe impl Send for Bundle {}
unsafe impl Sync for Bundle {}

impl Bundle {
    /// Opens a `.clap` file or bundle: `Err` says why not, for the track menu.
    pub fn open(path: &str) -> Result<Arc<Bundle>, String> {
        let bin = CString::new(binary_of(path)).map_err(|_| "a path with a NUL in it".to_string())?;
        unsafe {
            let lib = dl::open(&bin);
            if lib.is_null() { return Err(format!("couldn't load {path}")); }
            let entry = dl::sym(lib, c"clap_entry") as *const ClapPluginEntry;
            if entry.is_null() { dl::close(lib); return Err(format!("{path} isn't a CLAP plugin (no clap_entry)")); }
            Bundle::from_entry(entry, path, lib)
        }
    }

    /// A bundle from an entry already in memory (`lib` null: nothing to unload).
    /// # Safety
    /// `entry` must be a valid CLAP entry that outlives the bundle.
    pub unsafe fn from_entry(entry: *const ClapPluginEntry, path: &str, lib: *mut c_void) -> Result<Arc<Bundle>, String> {
        let fail = |why: String| { if !lib.is_null() { dl::close(lib); } Err(why) };
        let e = &*entry;
        if e.clap_version.major < 1 { return fail(format!("{path} speaks CLAP {}, older than 1.0", e.clap_version.major)); }
        let cpath = CString::new(path).unwrap_or_default();
        if !(e.init)(cpath.as_ptr()) { return fail(format!("{path} refused to start")); }
        let factory = (e.get_factory)(PLUGIN_FACTORY_ID.as_ptr()) as *const ClapPluginFactory;
        if factory.is_null() { (e.deinit)(); return fail(format!("{path} makes no plugins")); }
        Ok(Arc::new(Bundle { lib, entry, factory }))
    }

    pub fn count(&self) -> u32 { unsafe { ((*self.factory).get_plugin_count)(self.factory) } }

    pub fn describe(&self, index: u32) -> Option<Descriptor> {
        unsafe {
            let d = ((*self.factory).get_plugin_descriptor)(self.factory, index);
            if d.is_null() { return None; }
            let d = &*d;
            let mut features = Vec::new();
            if !d.features.is_null() {
                let mut f = d.features;
                while !(*f).is_null() && features.len() < 32 { features.push(text(*f)); f = f.add(1); }
            }
            Some(Descriptor { id: text(d.id), name: text(d.name), vendor: text(d.vendor), version: text(d.version), features })
        }
    }
}

impl Drop for Bundle {
    fn drop(&mut self) {
        unsafe {
            ((*self.entry).deinit)();
            if !self.lib.is_null() { dl::close(self.lib); }
        }
    }
}

// ---- the host side a plugin sees ----

/// What a plugin asked of the host since the last [`Plugin::pump`]. A plugin may ask from any thread, so it's atomics.
#[derive(Default)]
pub struct HostState {
    /// `clap.host.gui closed`: its editor went away (the player closed a floating window, or it lost its window).
    pub closed: AtomicBool,
    /// `request_callback`: it wants `on_main_thread` called.
    pub callback: AtomicBool,
    /// `clap.host.params request_flush`: it has parameter moves to hand over while no block is running.
    pub flush: AtomicBool,
    /// `clap.host.gui request_resize`: the editor wants this size; 0 while it wants none.
    pub resize: AtomicU64,
}

unsafe fn state<'a>(h: *const ClapHost) -> Option<&'a HostState> {
    if h.is_null() { return None; }
    ((*h).host_data as *const HostState).as_ref()
}

unsafe extern "C" fn host_get_extension(_: *const ClapHost, id: *const c_char) -> *const c_void {
    if id.is_null() { return std::ptr::null(); }
    let id = CStr::from_ptr(id);
    if id == gui::HOST_GUI { &gui::HOST_GUI_EXT as *const gui::ClapHostGui as *const c_void }
    else if id == gui::HOST_PARAMS { &gui::HOST_PARAMS_EXT as *const gui::ClapHostParams as *const c_void }
    else { std::ptr::null() }
}
unsafe extern "C" fn host_request(_: *const ClapHost) {}
unsafe extern "C" fn host_request_callback(h: *const ClapHost) { if let Some(s) = state(h) { s.callback.store(true, Ordering::Release); } }

/// The events queued for the next block: notes and parameter values, all at the block's start.
#[repr(C)]
#[derive(Clone, Copy)]
union Event { header: ClapEventHeader, note: ClapEventNote, param: ClapEventParamValue }

unsafe extern "C" fn in_size(list: *const ClapInputEvents) -> u32 { (*((*list).ctx as *const Vec<Event>)).len() as u32 }
unsafe extern "C" fn in_get(list: *const ClapInputEvents, i: u32) -> *const ClapEventHeader {
    let q = &*((*list).ctx as *const Vec<Event>);
    q.get(i as usize).map_or(std::ptr::null(), |e| &e.header as *const ClapEventHeader)
}
/// What a plugin says back: its own parameter moves (a knob turned in its editor) are kept, last value per
/// parameter, for the desk's sliders; the rest (note ends, gestures) is dropped.
unsafe extern "C" fn out_push(list: *const ClapOutputEvents, e: *const ClapEventHeader) -> bool {
    if list.is_null() || e.is_null() || (*list).ctx.is_null() { return true; }
    let h = std::ptr::read_unaligned(e);
    if h.space_id != 0 || h.kind != EVENT_PARAM_VALUE || (h.size as usize) < std::mem::size_of::<ClapEventParamValue>() { return true; }
    let ev = std::ptr::read_unaligned(e as *const ClapEventParamValue);
    if !ev.value.is_finite() { return true; }
    let changes = &mut *((*list).ctx as *mut Vec<(u32, f64)>);
    match changes.iter().position(|c| c.0 == ev.param_id) {
        Some(i) => changes[i].1 = ev.value,
        None if changes.len() < MAX_CHANGES => changes.push((ev.param_id, ev.value)),
        None => {}
    }
    true
}

/// Parameter moves kept between asks past this are dropped (a plugin has fewer parameters than this).
pub const MAX_CHANGES: usize = 4096;

/// One of a plugin's parameters, for a slider.
pub struct Param { pub id: u32, pub name: String, pub module: String, pub min: f64, pub max: f64, pub default: f64, pub value: f64, pub stepped: bool }

/// Blocks longer than this are split.
pub const MAX_FRAMES: usize = 4096;
/// Queued events past this are dropped (a block never needs this many).
pub const MAX_EVENTS: usize = 1024;

/// A running plugin.
pub struct Plugin {
    _bundle: Arc<Bundle>,
    _host: Box<ClapHost>,
    host_state: Box<HostState>,
    name: String,
    plugin: *const ClapPlugin,
    params: *const ClapPluginParams,
    gui: *const gui::ClapPluginGui,
    editor: Option<gui::Editor>,
    changes: Vec<(u32, f64)>,
    queue: Vec<Event>,
    inputs: Vec<Vec<Vec<f32>>>,
    outputs: Vec<Vec<Vec<f32>>>,
    steady: i64,
    processing: bool,
    broken: bool,
}

const HOST_NAME: &CStr = c"FM DAW";
const HOST_VENDOR: &CStr = c"RustyBuns";
const HOST_URL: &CStr = c"https://github.com/QuinnsCode/RustyBuns";
const HOST_VERSION: &CStr = c"0.0.1";

fn ports(p: *const ClapPlugin, ext: *const ClapPluginAudioPorts, input: bool) -> Vec<Vec<Vec<f32>>> {
    if ext.is_null() { return if input { vec![] } else { vec![vec![vec![0.0; MAX_FRAMES]; 2]] }; }
    unsafe {
        let n = ((*ext).count)(p, input).min(16);
        (0..n).map(|i| {
            let mut info: ClapAudioPortInfo = std::mem::zeroed();
            let ch = if ((*ext).get)(p, i, input, &mut info) { info.channel_count.clamp(1, 16) } else { 2 };
            vec![vec![0.0; MAX_FRAMES]; ch as usize]
        }).collect()
    }
}

impl Plugin {
    /// Makes plugin `index` of `bundle` and starts it at `sample_rate`.
    pub fn new(bundle: &Arc<Bundle>, index: u32, sample_rate: f64) -> Result<Plugin, String> {
        let d = bundle.describe(index).ok_or("no plugin at that index")?;
        let id = CString::new(d.id.clone()).map_err(|_| "a plugin id with a NUL in it")?;
        let host_state = Box::new(HostState::default());
        let host = Box::new(ClapHost {
            clap_version: CLAP_VERSION, host_data: &*host_state as *const HostState as *mut c_void,
            name: HOST_NAME.as_ptr(), vendor: HOST_VENDOR.as_ptr(), url: HOST_URL.as_ptr(), version: HOST_VERSION.as_ptr(),
            get_extension: host_get_extension, request_restart: host_request, request_process: host_request, request_callback: host_request_callback,
        });
        unsafe {
            let f = bundle.factory;
            let plugin = ((*f).create_plugin)(f, &*host, id.as_ptr());
            if plugin.is_null() { return Err(format!("{} couldn't be made", d.name)); }
            if !((*plugin).init)(plugin) { ((*plugin).destroy)(plugin); return Err(format!("{} refused to start", d.name)); }
            let params = ((*plugin).get_extension)(plugin, EXT_PARAMS.as_ptr()) as *const ClapPluginParams;
            let aports = ((*plugin).get_extension)(plugin, EXT_AUDIO_PORTS.as_ptr()) as *const ClapPluginAudioPorts;
            let gui = ((*plugin).get_extension)(plugin, gui::EXT_GUI.as_ptr()) as *const gui::ClapPluginGui;
            let inputs = ports(plugin, aports, true);
            let outputs = ports(plugin, aports, false);
            if !((*plugin).activate)(plugin, sample_rate, 1, MAX_FRAMES as u32) {
                ((*plugin).destroy)(plugin);
                return Err(format!("{} won't run at {sample_rate} Hz", d.name));
            }
            Ok(Plugin {
                _bundle: bundle.clone(), _host: host, host_state, name: d.name, plugin, params, gui, editor: None,
                changes: Vec::new(), queue: Vec::with_capacity(MAX_EVENTS), inputs, outputs, steady: 0, processing: false, broken: false,
            })
        }
    }

    fn push(&mut self, e: Event) { if self.queue.len() < MAX_EVENTS { self.queue.push(e); } }

    fn note(&mut self, kind: u16, key: u32, velocity: f64, channel: u32) {
        let header = ClapEventHeader { size: std::mem::size_of::<ClapEventNote>() as u32, time: 0, space_id: 0, kind, flags: 0 };
        self.push(Event { note: ClapEventNote { header, note_id: -1, port_index: 0, channel: (channel & 15) as i16, key: key.min(127) as i16, velocity: velocity.clamp(0.0, 1.0) } });
    }
    pub fn note_on(&mut self, key: u32, velocity: f64, channel: u32) { self.note(EVENT_NOTE_ON, key, velocity, channel) }
    pub fn note_off(&mut self, key: u32, channel: u32) { self.note(EVENT_NOTE_OFF, key, 0.0, channel) }

    pub fn set_param(&mut self, id: u32, value: f64) {
        if !value.is_finite() { return; }
        let header = ClapEventHeader { size: std::mem::size_of::<ClapEventParamValue>() as u32, time: 0, space_id: 0, kind: EVENT_PARAM_VALUE, flags: 0 };
        self.push(Event { param: ClapEventParamValue { header, param_id: id, cookie: std::ptr::null_mut(), note_id: -1, port_index: -1, channel: -1, key: -1, value } });
    }

    /// The plugin's parameters a player may move, with their values now.
    pub fn params(&self) -> Vec<Param> {
        if self.params.is_null() { return vec![]; }
        unsafe {
            let ext = &*self.params;
            let n = (ext.count)(self.plugin).min(4096);
            let mut out = Vec::with_capacity(n as usize);
            for i in 0..n {
                let mut info: ClapParamInfo = std::mem::zeroed();
                if !(ext.get_info)(self.plugin, i, &mut info) { continue; }
                if info.flags & (PARAM_IS_READONLY | PARAM_IS_HIDDEN) != 0 { continue; }
                let mut value = info.default_value;
                (ext.get_value)(self.plugin, info.id, &mut value);
                info.name[NAME_SIZE - 1] = 0;
                info.module[PATH_SIZE - 1] = 0;
                out.push(Param {
                    id: info.id, name: text(info.name.as_ptr()), module: text(info.module.as_ptr()),
                    min: info.min_value, max: info.max_value, default: info.default_value, value,
                    stepped: info.flags & PARAM_IS_STEPPED != 0,
                });
            }
            out
        }
    }

    /// Runs the plugin for `frames` and adds its first output into `out` (interleaved stereo; a mono port goes to
    /// both sides). False once the plugin has failed: it stays silent from then on.
    pub fn render(&mut self, out: &mut [f32], frames: usize) -> bool {
        let frames = frames.min(out.len() / 2);
        if self.broken { return false; }
        unsafe {
            if !self.processing {
                if !((*self.plugin).start_processing)(self.plugin) { self.broken = true; return false; }
                self.processing = true;
            }
        }
        let mut done = 0;
        while done < frames {
            let n = (frames - done).min(MAX_FRAMES);
            if !self.block(n) { self.broken = true; return false; }
            let port = &self.outputs[0];
            let (l, r) = (&port[0], &port[if port.len() > 1 { 1 } else { 0 }]);
            for i in 0..n {
                let (a, b) = (l[i], r[i]);
                // a plugin that writes NaN or wild values is held to silence on that sample, not passed to the mix
                if a.is_finite() && b.is_finite() && a.abs() < 16.0 && b.abs() < 16.0 {
                    out[2 * (done + i)] += a;
                    out[2 * (done + i) + 1] += b;
                }
            }
            done += n;
        }
        true
    }

    fn block(&mut self, n: usize) -> bool {
        for port in self.inputs.iter_mut() { for ch in port.iter_mut() { ch[..n].fill(0.0); } }
        for port in self.outputs.iter_mut() { for ch in port.iter_mut() { ch[..n].fill(0.0); } }
        let mut in_ptrs: Vec<Vec<*mut f32>> = self.inputs.iter_mut().map(|p| p.iter_mut().map(|c| c.as_mut_ptr()).collect()).collect();
        let mut out_ptrs: Vec<Vec<*mut f32>> = self.outputs.iter_mut().map(|p| p.iter_mut().map(|c| c.as_mut_ptr()).collect()).collect();
        let buf = |p: &mut Vec<*mut f32>| ClapAudioBuffer { data32: p.as_mut_ptr(), data64: std::ptr::null_mut(), channel_count: p.len() as u32, latency: 0, constant_mask: 0 };
        let ins: Vec<ClapAudioBuffer> = in_ptrs.iter_mut().map(buf).collect();
        let mut outs: Vec<ClapAudioBuffer> = out_ptrs.iter_mut().map(buf).collect();
        let in_events = ClapInputEvents { ctx: &self.queue as *const Vec<Event> as *mut c_void, size: in_size, get: in_get };
        let out_events = ClapOutputEvents { ctx: &mut self.changes as *mut Vec<(u32, f64)> as *mut c_void, try_push: out_push };
        let process = ClapProcess {
            steady_time: self.steady, frames_count: n as u32, transport: std::ptr::null(),
            audio_inputs: ins.as_ptr(), audio_outputs: outs.as_mut_ptr(),
            audio_inputs_count: ins.len() as u32, audio_outputs_count: outs.len() as u32,
            in_events: &in_events, out_events: &out_events,
        };
        let status = unsafe { ((*self.plugin).process)(self.plugin, &process) };
        self.queue.clear();
        self.steady += n as i64;
        status != 0
    }
}

impl Drop for Plugin {
    fn drop(&mut self) {
        self.close_editor();
        unsafe {
            if self.processing { ((*self.plugin).stop_processing)(self.plugin); }
            ((*self.plugin).deactivate)(self.plugin);
            ((*self.plugin).destroy)(self.plugin);
        }
    }
}

// ---- JSON for the page (no serde: the engine keeps no dependencies) ----

pub fn json_str(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn json_num(v: f64, out: &mut String) { if v.is_finite() { out.push_str(&format!("{v}")); } else { out.push('0'); } }

/// The bundle's plugins: `[{"id","name","vendor","version","features":[..]}]`.
pub fn describe_json(b: &Bundle) -> String {
    let mut s = String::from("[");
    for i in 0..b.count().min(256) {
        let Some(d) = b.describe(i) else { continue };
        if s.len() > 1 { s.push(','); }
        s.push_str("{\"id\":"); json_str(&d.id, &mut s);
        s.push_str(",\"name\":"); json_str(&d.name, &mut s);
        s.push_str(",\"vendor\":"); json_str(&d.vendor, &mut s);
        s.push_str(",\"version\":"); json_str(&d.version, &mut s);
        s.push_str(",\"features\":[");
        for (k, f) in d.features.iter().enumerate() { if k > 0 { s.push(','); } json_str(f, &mut s); }
        s.push_str("]}");
    }
    s.push(']');
    s
}

/// The plugin's parameters: `[{"id","name","module","min","max","default","value","stepped"}]`.
pub fn params_json(p: &Plugin) -> String {
    let mut s = String::from("[");
    for (k, q) in p.params().iter().enumerate() {
        if k > 0 { s.push(','); }
        s.push_str(&format!("{{\"id\":{},\"name\":", q.id)); json_str(&q.name, &mut s);
        s.push_str(",\"module\":"); json_str(&q.module, &mut s);
        s.push_str(",\"min\":"); json_num(q.min, &mut s);
        s.push_str(",\"max\":"); json_num(q.max, &mut s);
        s.push_str(",\"default\":"); json_num(q.default, &mut s);
        s.push_str(",\"value\":"); json_num(q.value, &mut s);
        s.push_str(&format!(",\"stepped\":{}}}", q.stepped));
    }
    s.push(']');
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle() -> Arc<Bundle> { unsafe { Bundle::from_entry(&tone::clap_entry, "test-tone", std::ptr::null_mut()).unwrap() } }

    #[test]
    fn lists_the_tone_and_its_params() {
        let b = bundle();
        assert_eq!(b.count(), 1);
        assert!(describe_json(&b).contains("\"name\":\"Test Tone\""));
        let p = Plugin::new(&b, 0, 48000.0).unwrap();
        let ps = p.params();
        assert_eq!(ps.iter().map(|q| q.name.as_str()).collect::<Vec<_>>(), ["Level", "Shape"]);
        assert!(params_json(&p).starts_with("[{\"id\":0,\"name\":\"Level\""));
    }

    #[test]
    fn a_note_sounds_until_it_stops_and_level_zero_silences_it() {
        let b = bundle();
        let mut p = Plugin::new(&b, 0, 48000.0).unwrap();
        let peak = |p: &mut Plugin| { let mut out = vec![0f32; 2 * 6000]; assert!(p.render(&mut out, 6000)); out.iter().fold(0f32, |m, x| m.max(x.abs())) };
        assert_eq!(peak(&mut p), 0.0);
        p.note_on(69, 1.0, 0);
        assert!(peak(&mut p) > 0.1);
        p.set_param(0, 0.0);
        assert_eq!(peak(&mut p), 0.0);
        p.set_param(0, 1.0);
        assert!(peak(&mut p) > 0.1);
        p.note_off(69, 0);
        assert_eq!(peak(&mut p), 0.0);
        assert_eq!(p.params()[0].value, 1.0);
    }

    #[test]
    fn a_missing_file_says_so() {
        assert!(Bundle::open("/nowhere/at-all.clap").err().unwrap().contains("couldn't load"));
    }
}
