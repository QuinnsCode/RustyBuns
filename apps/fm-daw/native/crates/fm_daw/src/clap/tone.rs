//! Test Tone: a small CLAP instrument of our own, exported from this library as `clap_entry`. Eight voices of a
//! sine or a square, a level and a shape, no envelope (a note sounds until it stops). It is what the plugin host is
//! tried and tested on when nobody's own plugins are installed.

use super::*;
use std::f64::consts::TAU;

struct Shared<T>(T);
unsafe impl<T> Sync for Shared<T> {}

static FEATURES: Shared<[*const c_char; 3]> = Shared([c"instrument".as_ptr(), c"synthesizer".as_ptr(), std::ptr::null()]);

static DESC: Shared<ClapPluginDescriptor> = Shared(ClapPluginDescriptor {
    clap_version: CLAP_VERSION,
    id: c"com.rustybuns.fm-daw.test-tone".as_ptr(),
    name: c"Test Tone".as_ptr(),
    vendor: c"RustyBuns".as_ptr(),
    url: c"".as_ptr(),
    manual_url: c"".as_ptr(),
    support_url: c"".as_ptr(),
    version: c"0.0.1".as_ptr(),
    description: c"A sine or a square, to try the plugin host on".as_ptr(),
    features: &FEATURES.0 as *const [*const c_char; 3] as *const *const c_char,
});

const VOICES: usize = 8;
const LEVEL: u32 = 0;
const SHAPE: u32 = 1;

#[repr(C)]
struct Tone {
    plugin: ClapPlugin,
    rate: f64,
    keys: [i16; VOICES],
    phase: [f64; VOICES],
    level: f64,
    shape: f64,
}

unsafe fn me<'a>(p: *const ClapPlugin) -> &'a mut Tone { &mut *((*p).plugin_data as *mut Tone) }

unsafe extern "C" fn init(_: *const ClapPlugin) -> bool { true }
unsafe extern "C" fn destroy(p: *const ClapPlugin) { drop(Box::from_raw((*p).plugin_data as *mut Tone)); }
unsafe extern "C" fn activate(p: *const ClapPlugin, rate: f64, _: u32, _: u32) -> bool { me(p).rate = rate; true }
unsafe extern "C" fn nothing(_: *const ClapPlugin) {}
unsafe extern "C" fn start(_: *const ClapPlugin) -> bool { true }
unsafe extern "C" fn reset(p: *const ClapPlugin) { me(p).keys = [-1; VOICES]; }

unsafe fn apply(t: &mut Tone, h: *const ClapEventHeader) {
    if (*h).space_id != 0 { return; }
    match (*h).kind {
        EVENT_NOTE_ON => {
            let n = &*(h as *const ClapEventNote);
            if let Some(v) = t.keys.iter().position(|k| *k < 0) { t.keys[v] = n.key; t.phase[v] = 0.0; }
        }
        EVENT_NOTE_OFF => {
            let n = &*(h as *const ClapEventNote);
            for k in t.keys.iter_mut() { if *k == n.key { *k = -1; } }
        }
        EVENT_PARAM_VALUE => {
            let e = &*(h as *const ClapEventParamValue);
            match e.param_id { LEVEL => t.level = e.value.clamp(0.0, 1.0), SHAPE => t.shape = e.value.round().clamp(0.0, 1.0), _ => {} }
        }
        _ => {}
    }
}

unsafe fn apply_all(t: &mut Tone, list: *const ClapInputEvents) {
    if list.is_null() { return; }
    for i in 0..((*list).size)(list) { let h = ((*list).get)(list, i); if !h.is_null() { apply(t, h); } }
}

unsafe extern "C" fn process(p: *const ClapPlugin, pr: *const ClapProcess) -> i32 {
    let t = me(p);
    let pr = &*pr;
    apply_all(t, pr.in_events);
    if pr.audio_outputs_count == 0 { return 1; }
    let out = &*pr.audio_outputs;
    let n = pr.frames_count as usize;
    for i in 0..n {
        let mut s = 0.0;
        for v in 0..VOICES {
            if t.keys[v] < 0 { continue; }
            let f = 440.0 * 2f64.powf((t.keys[v] as f64 - 69.0) / 12.0);
            t.phase[v] = (t.phase[v] + f / t.rate).fract();
            let x = (t.phase[v] * TAU).sin();
            s += if t.shape >= 0.5 { x.signum() } else { x };
        }
        let y = (s * 0.25 * t.level) as f32;
        for c in 0..out.channel_count as usize { *(*out.data32.add(c)).add(i) = y; }
    }
    1
}

unsafe extern "C" fn param_count(_: *const ClapPlugin) -> u32 { 2 }
unsafe extern "C" fn param_info(_: *const ClapPlugin, i: u32, info: *mut ClapParamInfo) -> bool {
    let (name, stepped, default): (&[u8], bool, f64) = match i { 0 => (b"Level", false, 0.8), 1 => (b"Shape", true, 0.0), _ => return false };
    let info = &mut *info;
    info.id = i;
    info.flags = if stepped { PARAM_IS_STEPPED } else { 0 };
    info.cookie = std::ptr::null_mut();
    info.name = [0; NAME_SIZE];
    for (k, b) in name.iter().enumerate() { info.name[k] = *b as c_char; }
    info.module = [0; PATH_SIZE];
    info.min_value = 0.0;
    info.max_value = 1.0;
    info.default_value = default;
    true
}
unsafe extern "C" fn param_value(p: *const ClapPlugin, id: u32, out: *mut f64) -> bool {
    let t = me(p);
    match id { LEVEL => *out = t.level, SHAPE => *out = t.shape, _ => return false }
    true
}
unsafe extern "C" fn param_to_text(_: *const ClapPlugin, _: u32, _: f64, _: *mut c_char, _: u32) -> bool { false }
unsafe extern "C" fn param_from_text(_: *const ClapPlugin, _: u32, _: *const c_char, _: *mut f64) -> bool { false }
unsafe extern "C" fn param_flush(p: *const ClapPlugin, inp: *const ClapInputEvents, _: *const ClapOutputEvents) { apply_all(me(p), inp); }

static PARAMS: ClapPluginParams = ClapPluginParams {
    count: param_count, get_info: param_info, get_value: param_value,
    value_to_text: param_to_text, text_to_value: param_from_text, flush: param_flush,
};

unsafe extern "C" fn port_count(_: *const ClapPlugin, input: bool) -> u32 { if input { 0 } else { 1 } }
unsafe extern "C" fn port_get(_: *const ClapPlugin, i: u32, input: bool, info: *mut ClapAudioPortInfo) -> bool {
    if input || i != 0 { return false; }
    let info = &mut *info;
    info.id = 0;
    info.name = [0; NAME_SIZE];
    for (k, b) in b"Out".iter().enumerate() { info.name[k] = *b as c_char; }
    info.flags = 1; // main
    info.channel_count = 2;
    info.port_type = c"stereo".as_ptr();
    info.in_place_pair = u32::MAX;
    true
}
static PORTS: ClapPluginAudioPorts = ClapPluginAudioPorts { count: port_count, get: port_get };

unsafe extern "C" fn extension(_: *const ClapPlugin, id: *const c_char) -> *const c_void {
    let id = CStr::from_ptr(id);
    if id == EXT_PARAMS { &PARAMS as *const ClapPluginParams as *const c_void }
    else if id == EXT_AUDIO_PORTS { &PORTS as *const ClapPluginAudioPorts as *const c_void }
    else { std::ptr::null() }
}

unsafe extern "C" fn count(_: *const ClapPluginFactory) -> u32 { 1 }
unsafe extern "C" fn descriptor(_: *const ClapPluginFactory, i: u32) -> *const ClapPluginDescriptor {
    if i == 0 { &DESC.0 } else { std::ptr::null() }
}
unsafe extern "C" fn create(_: *const ClapPluginFactory, _: *const ClapHost, id: *const c_char) -> *const ClapPlugin {
    if id.is_null() || CStr::from_ptr(id) != CStr::from_ptr(DESC.0.id) { return std::ptr::null(); }
    let t = Box::into_raw(Box::new(Tone {
        plugin: ClapPlugin {
            desc: &DESC.0, plugin_data: std::ptr::null_mut(), init, destroy, activate, deactivate: nothing,
            start_processing: start, stop_processing: nothing, reset, process, get_extension: extension, on_main_thread: nothing,
        },
        rate: 48000.0, keys: [-1; VOICES], phase: [0.0; VOICES], level: 0.8, shape: 0.0,
    }));
    (*t).plugin.plugin_data = t as *mut c_void;
    &(*t).plugin
}

static FACTORY: ClapPluginFactory = ClapPluginFactory { get_plugin_count: count, get_plugin_descriptor: descriptor, create_plugin: create };

unsafe extern "C" fn entry_init(_: *const c_char) -> bool { true }
unsafe extern "C" fn entry_deinit() {}
unsafe extern "C" fn entry_factory(id: *const c_char) -> *const c_void {
    if !id.is_null() && CStr::from_ptr(id) == PLUGIN_FACTORY_ID { &FACTORY as *const ClapPluginFactory as *const c_void } else { std::ptr::null() }
}

/// The CLAP entry point: this library is itself a `.clap` holding Test Tone.
#[no_mangle]
#[allow(non_upper_case_globals)]
pub static clap_entry: ClapPluginEntry = ClapPluginEntry { clap_version: CLAP_VERSION, init: entry_init, deinit: entry_deinit, get_factory: entry_factory };
