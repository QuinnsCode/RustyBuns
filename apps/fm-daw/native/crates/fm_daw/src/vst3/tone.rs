//! Test Tone as a VST3, exported from this library as `GetPluginFactory`: the CLAP Test Tone's sound (eight voices of
//! a sine or a square, a level and a shape, no envelope), built the way most VST3s are, a processor class and a
//! separate controller class that learns the processor's settings from its saved state. It is what the VST3 host is
//! tried and tested on when nobody's own plugins are installed.

use super::*;
use std::f64::consts::TAU;
use std::mem::offset_of;
use std::sync::atomic::{AtomicU32, Ordering};

pub const TONE_CID: Tuid = uid(0x52427573, 0x7479546F, 0x6E650001, 0x464D4441);
pub const TONE_CONTROLLER_CID: Tuid = uid(0x52427573, 0x7479546F, 0x6E650002, 0x464D4441);

const VOICES: usize = 8;
const LEVEL: u32 = 0;
const SHAPE: u32 = 1;
const DEFAULTS: [f64; 2] = [0.8, 0.0];

fn put(s: &str, out: &mut [c_char]) {
    out.fill(0);
    for (k, b) in s.bytes().take(out.len() - 1).enumerate() { out[k] = b as c_char; }
}

// ---- the factory: one static object ----

#[repr(C)]
struct Factory { vtbl: &'static FactoryVtbl }
unsafe impl Sync for Factory {}

unsafe extern "system" fn static_ref(_: This) -> u32 { 1 }
unsafe extern "system" fn factory_query(this: This, iid: *const Tuid, obj: *mut *mut c_void) -> TResult {
    if obj.is_null() || iid.is_null() { return NO_INTERFACE; }
    if [FUNKNOWN, IPLUGIN_FACTORY, IPLUGIN_FACTORY2].contains(&*iid) { *obj = this; return OK; }
    *obj = std::ptr::null_mut();
    NO_INTERFACE
}
unsafe extern "system" fn factory_info(_: This, info: *mut FactoryInfo) -> TResult {
    let i = &mut *info;
    put("RustyBuns", &mut i.vendor);
    put("https://github.com/QuinnsCode/RustyBuns", &mut i.url);
    put("", &mut i.email);
    i.flags = 0;
    OK
}
unsafe extern "system" fn factory_count(_: This) -> i32 { 2 }
fn class(i: i32) -> Option<(Tuid, &'static str, &'static str)> {
    match i { 0 => Some((TONE_CID, "Audio Module Class", "Test Tone (VST3)")), 1 => Some((TONE_CONTROLLER_CID, "Component Controller Class", "Test Tone (VST3) Controller")), _ => None }
}
unsafe extern "system" fn factory_class(_: This, i: i32, info: *mut ClassInfo) -> TResult {
    let Some((cid, category, name)) = class(i) else { return FALSE };
    let c = &mut *info;
    c.cid = cid;
    c.cardinality = 0x7FFF_FFFF;
    put(category, &mut c.category);
    put(name, &mut c.name);
    OK
}
unsafe extern "system" fn factory_class2(_: This, i: i32, info: *mut ClassInfo2) -> TResult {
    let Some((cid, category, name)) = class(i) else { return FALSE };
    let c = &mut *info;
    c.cid = cid;
    c.cardinality = 0x7FFF_FFFF;
    put(category, &mut c.category);
    put(name, &mut c.name);
    c.class_flags = 0;
    put(if i == 0 { "Instrument|Synth" } else { "" }, &mut c.sub_categories);
    put("RustyBuns", &mut c.vendor);
    put("0.0.1", &mut c.version);
    put("VST 3.8.0", &mut c.sdk_version);
    OK
}
unsafe extern "system" fn factory_create(_: This, cid: *const c_char, iid: *const c_char, obj: *mut *mut c_void) -> TResult {
    if cid.is_null() || iid.is_null() || obj.is_null() { return NO_INTERFACE; }
    let (cid, iid) = (&*(cid as *const Tuid), &*(iid as *const Tuid));
    let made: *mut c_void = if *cid == TONE_CID {
        let t = Box::into_raw(Box::new(Tone {
            component: &COMPONENT_VTBL, processor: &PROCESSOR_VTBL, refs: AtomicU32::new(1),
            rate: 48000.0, keys: [-1; VOICES], phase: [0.0; VOICES], values: DEFAULTS,
        }));
        t as *mut c_void
    } else if *cid == TONE_CONTROLLER_CID {
        Box::into_raw(Box::new(Controller { vtbl: &CONTROLLER_VTBL, refs: AtomicU32::new(1), values: DEFAULTS })) as *mut c_void
    } else {
        *obj = std::ptr::null_mut();
        return NO_INTERFACE;
    };
    // hand over the side asked for (a new reference), then drop the one it was made with
    let unknown: &Unknown = vt(made);
    let r = (unknown.query_interface)(made, iid, obj);
    (unknown.release)(made);
    r
}
static FACTORY_VTBL: FactoryVtbl = FactoryVtbl {
    unknown: Unknown { query_interface: factory_query, add_ref: static_ref, release: static_ref },
    get_factory_info: factory_info, count_classes: factory_count, get_class_info: factory_class,
    create_instance: factory_create, get_class_info2: factory_class2,
};
static FACTORY: Factory = Factory { vtbl: &FACTORY_VTBL };

/// The VST3 entry point: this library is itself a `.vst3` holding Test Tone.
#[no_mangle]
#[allow(non_snake_case)]
pub extern "system" fn GetPluginFactory() -> *mut c_void { &FACTORY as *const Factory as *mut c_void }

// ---- the processor: IComponent and IAudioProcessor on one object, a vtable each ----

#[repr(C)]
struct Tone {
    component: &'static ComponentVtbl,
    processor: &'static ProcessorVtbl,
    refs: AtomicU32,
    rate: f64,
    keys: [i16; VOICES],
    phase: [f64; VOICES],
    values: [f64; 2],
}

unsafe fn tone<'a>(this: This) -> &'a mut Tone { &mut *(this as *mut Tone) }
unsafe fn from_processor(this: This) -> This { (this as *mut u8).sub(offset_of!(Tone, processor)) as This }

unsafe extern "system" fn tone_query(this: This, iid: *const Tuid, obj: *mut *mut c_void) -> TResult {
    if obj.is_null() || iid.is_null() { return NO_INTERFACE; }
    let t = tone(this);
    *obj = if [FUNKNOWN, IPLUGIN_BASE, ICOMPONENT].contains(&*iid) { &mut t.component as *mut _ as This }
        else if *iid == IAUDIO_PROCESSOR { &mut t.processor as *mut _ as This }
        else { *obj = std::ptr::null_mut(); return NO_INTERFACE; };
    t.refs.fetch_add(1, Ordering::AcqRel);
    OK
}
unsafe extern "system" fn tone_add_ref(this: This) -> u32 { tone(this).refs.fetch_add(1, Ordering::AcqRel) + 1 }
unsafe extern "system" fn tone_release(this: This) -> u32 {
    let left = tone(this).refs.fetch_sub(1, Ordering::AcqRel) - 1;
    if left == 0 { drop(Box::from_raw(this as *mut Tone)); }
    left
}
unsafe extern "system" fn ok_ptr(_: This, _: *mut c_void) -> TResult { OK }
unsafe extern "system" fn ok(_: This) -> TResult { OK }
unsafe extern "system" fn ok_i32(_: This, _: i32) -> TResult { OK }
unsafe extern "system" fn ok_u8(_: This, _: u8) -> TResult { OK }
unsafe extern "system" fn controller_id(_: This, out: *mut Tuid) -> TResult { *out = TONE_CONTROLLER_CID; OK }
unsafe extern "system" fn bus_count(_: This, media: i32, dir: i32) -> i32 { ((media == MEDIA_AUDIO && dir == DIR_OUTPUT) || (media == MEDIA_EVENT && dir == DIR_INPUT)) as i32 }
unsafe extern "system" fn bus_info(this: This, media: i32, dir: i32, i: i32, info: *mut BusInfo) -> TResult {
    if i != 0 || bus_count(this, media, dir) == 0 { return FALSE; }
    let b = &mut *info;
    b.media_type = media;
    b.direction = dir;
    b.channel_count = if media == MEDIA_AUDIO { 2 } else { 16 };
    put_utf16(if media == MEDIA_AUDIO { "Out" } else { "Notes" }, b.name.as_mut_ptr());
    b.bus_type = 0;
    b.flags = BUS_DEFAULT_ACTIVE;
    OK
}
unsafe extern "system" fn no_routing(_: This, _: *mut c_void, _: *mut c_void) -> TResult { FALSE }
unsafe extern "system" fn activate_bus(_: This, _: i32, _: i32, _: i32, _: u8) -> TResult { OK }

/// The settings, as two f64s: what the processor saves and the controller reads.
unsafe fn write_values(stream: This, values: &[f64; 2]) -> TResult {
    let mut b = [0u8; 16];
    b[..8].copy_from_slice(&values[0].to_le_bytes());
    b[8..].copy_from_slice(&values[1].to_le_bytes());
    let mut n = 0;
    (vt::<StreamVtbl>(stream).write)(stream, b.as_mut_ptr() as *mut c_void, 16, &mut n)
}
unsafe fn read_values(stream: This, values: &mut [f64; 2]) -> TResult {
    if stream.is_null() { return FALSE; }
    let mut b = [0u8; 16];
    let mut n = 0;
    if (vt::<StreamVtbl>(stream).read)(stream, b.as_mut_ptr() as *mut c_void, 16, &mut n) != OK || n != 16 { return FALSE; }
    let (l, s) = (f64::from_le_bytes(b[..8].try_into().unwrap_or_default()), f64::from_le_bytes(b[8..].try_into().unwrap_or_default()));
    if l.is_finite() && s.is_finite() { *values = [l.clamp(0.0, 1.0), s.round().clamp(0.0, 1.0)]; }
    OK
}
unsafe extern "system" fn tone_set_state(this: This, s: *mut c_void) -> TResult { read_values(s, &mut tone(this).values) }
unsafe extern "system" fn tone_get_state(this: This, s: *mut c_void) -> TResult { if s.is_null() { FALSE } else { write_values(s, &tone(this).values) } }
unsafe extern "system" fn tone_set_active(this: This, _: u8) -> TResult { tone(this).keys = [-1; VOICES]; OK }

static COMPONENT_VTBL: ComponentVtbl = ComponentVtbl {
    unknown: Unknown { query_interface: tone_query, add_ref: tone_add_ref, release: tone_release },
    initialize: ok_ptr, terminate: ok, get_controller_class_id: controller_id, set_io_mode: ok_i32,
    get_bus_count: bus_count, get_bus_info: bus_info, get_routing_info: no_routing, activate_bus,
    set_active: tone_set_active, set_state: tone_set_state, get_state: tone_get_state,
};

unsafe extern "system" fn proc_query(this: This, iid: *const Tuid, obj: *mut *mut c_void) -> TResult { tone_query(from_processor(this), iid, obj) }
unsafe extern "system" fn proc_add_ref(this: This) -> u32 { tone_add_ref(from_processor(this)) }
unsafe extern "system" fn proc_release(this: This) -> u32 { tone_release(from_processor(this)) }
unsafe extern "system" fn arrangements(_: This, _: *mut u64, ins: i32, outs: *mut u64, n: i32) -> TResult {
    if ins == 0 && n == 1 && !outs.is_null() && *outs == STEREO { OK } else { FALSE }
}
unsafe extern "system" fn arrangement(_: This, dir: i32, i: i32, out: *mut u64) -> TResult {
    if dir != DIR_OUTPUT || i != 0 || out.is_null() { return FALSE; }
    *out = STEREO;
    OK
}
unsafe extern "system" fn sample_size(_: This, size: i32) -> TResult { if size == SAMPLE_32 { OK } else { FALSE } }
unsafe extern "system" fn zero(_: This) -> u32 { 0 }
unsafe extern "system" fn setup(this: This, s: *mut ProcessSetup) -> TResult {
    let t = tone(from_processor(this));
    if s.is_null() || (*s).sample_rate <= 0.0 { return FALSE; }
    t.rate = (*s).sample_rate;
    OK
}

unsafe fn apply_changes(t: &mut Tone, changes: This) {
    if changes.is_null() { return; }
    let cv: &ChangesVtbl = vt(changes);
    for i in 0..(cv.get_parameter_count)(changes) {
        let q = (cv.get_parameter_data)(changes, i);
        if q.is_null() { continue; }
        let qv: &QueueVtbl = vt(q);
        let n = (qv.get_point_count)(q);
        let (mut at, mut v) = (0, 0.0);
        if n <= 0 || (qv.get_point)(q, n - 1, &mut at, &mut v) != OK { continue; }
        match (qv.get_parameter_id)(q) { LEVEL => t.values[0] = v.clamp(0.0, 1.0), SHAPE => t.values[1] = v.round().clamp(0.0, 1.0), _ => {} }
    }
}

unsafe fn apply_events(t: &mut Tone, list: This) {
    if list.is_null() { return; }
    let lv: &EventListVtbl = vt(list);
    for i in 0..(lv.get_event_count)(list) {
        let mut e: Event = std::mem::zeroed();
        if (lv.get_event)(list, i, &mut e) != OK { continue; }
        match e.kind {
            EVENT_NOTE_ON => { if let Some(v) = t.keys.iter().position(|k| *k < 0) { t.keys[v] = e.body.note_on.pitch; t.phase[v] = 0.0; } }
            EVENT_NOTE_OFF => { let p = e.body.note_off.pitch; for k in t.keys.iter_mut() { if *k == p { *k = -1; } } }
            _ => {}
        }
    }
}

unsafe extern "system" fn process(this: This, data: *mut ProcessData) -> TResult {
    let t = tone(from_processor(this));
    let d = &mut *data;
    apply_changes(t, d.input_parameter_changes);
    apply_events(t, d.input_events);
    if d.num_outputs < 1 || d.outputs.is_null() { return OK; }
    let out = &*d.outputs;
    let (level, square) = (t.values[0], t.values[1] >= 0.5);
    for i in 0..d.num_samples.max(0) as usize {
        let mut s = 0.0;
        for v in 0..VOICES {
            if t.keys[v] < 0 { continue; }
            let f = 440.0 * 2f64.powf((t.keys[v] as f64 - 69.0) / 12.0);
            t.phase[v] = (t.phase[v] + f / t.rate).fract();
            let x = (t.phase[v] * TAU).sin();
            s += if square { x.signum() } else { x };
        }
        let y = (s * 0.25 * level) as f32;
        for c in 0..out.num_channels.max(0) as usize { *(*out.buffers.add(c)).add(i) = y; }
    }
    OK
}

static PROCESSOR_VTBL: ProcessorVtbl = ProcessorVtbl {
    unknown: Unknown { query_interface: proc_query, add_ref: proc_add_ref, release: proc_release },
    set_bus_arrangements: arrangements, get_bus_arrangement: arrangement, can_process_sample_size: sample_size,
    get_latency_samples: zero, setup_processing: setup, set_processing: ok_u8, process, get_tail_samples: zero,
};

// ---- the controller: the parameter list, a class of its own ----

#[repr(C)]
struct Controller { vtbl: &'static ControllerVtbl, refs: AtomicU32, values: [f64; 2] }

unsafe fn ctl<'a>(this: This) -> &'a mut Controller { &mut *(this as *mut Controller) }
unsafe extern "system" fn ctl_query(this: This, iid: *const Tuid, obj: *mut *mut c_void) -> TResult {
    if obj.is_null() || iid.is_null() { return NO_INTERFACE; }
    if ![FUNKNOWN, IPLUGIN_BASE, IEDIT_CONTROLLER].contains(&*iid) { *obj = std::ptr::null_mut(); return NO_INTERFACE; }
    ctl(this).refs.fetch_add(1, Ordering::AcqRel);
    *obj = this;
    OK
}
unsafe extern "system" fn ctl_add_ref(this: This) -> u32 { ctl(this).refs.fetch_add(1, Ordering::AcqRel) + 1 }
unsafe extern "system" fn ctl_release(this: This) -> u32 {
    let left = ctl(this).refs.fetch_sub(1, Ordering::AcqRel) - 1;
    if left == 0 { drop(Box::from_raw(this as *mut Controller)); }
    left
}
unsafe extern "system" fn ctl_component_state(this: This, s: *mut c_void) -> TResult { read_values(s, &mut ctl(this).values) }
unsafe extern "system" fn param_count(_: This) -> i32 { 2 }
unsafe extern "system" fn param_info(_: This, i: i32, info: *mut ParameterInfo) -> TResult {
    let (name, steps) = match i { 0 => ("Level", 0), 1 => ("Shape", 1), _ => return FALSE };
    let p = &mut *info;
    p.id = i as u32;
    put_utf16(name, p.title.as_mut_ptr());
    put_utf16(name, p.short_title.as_mut_ptr());
    put_utf16("", p.units.as_mut_ptr());
    p.step_count = steps;
    p.default_normalized_value = DEFAULTS[i as usize];
    p.unit_id = 0;
    p.flags = PARAM_CAN_AUTOMATE;
    OK
}
unsafe extern "system" fn no_string(_: This, _: u32, _: f64, _: *mut u16) -> TResult { FALSE }
unsafe extern "system" fn no_value(_: This, _: u32, _: *mut u16, _: *mut f64) -> TResult { FALSE }
unsafe extern "system" fn same(_: This, _: u32, v: f64) -> f64 { v }
unsafe extern "system" fn get_normalized(this: This, id: u32) -> f64 { ctl(this).values.get(id as usize).copied().unwrap_or(0.0) }
unsafe extern "system" fn set_normalized(this: This, id: u32, v: f64) -> TResult {
    match ctl(this).values.get_mut(id as usize) { Some(x) if v.is_finite() => { *x = v.clamp(0.0, 1.0); OK } _ => FALSE }
}
unsafe extern "system" fn no_view(_: This, _: *const c_char) -> *mut c_void { std::ptr::null_mut() }

static CONTROLLER_VTBL: ControllerVtbl = ControllerVtbl {
    unknown: Unknown { query_interface: ctl_query, add_ref: ctl_add_ref, release: ctl_release },
    initialize: ok_ptr, terminate: ok, set_component_state: ctl_component_state, set_state: ok_ptr, get_state: ok_ptr,
    get_parameter_count: param_count, get_parameter_info: param_info, get_param_string_by_value: no_string,
    get_param_value_by_string: no_value, normalized_param_to_plain: same, plain_param_to_normalized: same,
    get_param_normalized: get_normalized, set_param_normalized: set_normalized, set_component_handler: ok_ptr, create_view: no_view,
};
