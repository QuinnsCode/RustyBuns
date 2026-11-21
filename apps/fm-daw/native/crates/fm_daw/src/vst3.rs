//! A player's own VST3 plugin, hosted in the desktop app (#5268) behind the same surface as the CLAP host
//! ([`crate::clap`]): a [`Bundle`] lists the plugins a `.vst3` holds, a [`Plugin`] takes notes and parameter
//! moves and adds its stereo sound into an interleaved buffer. [`crate::hosted`] puts the two formats behind one type.
//!
//! VST3 is C++ interfaces (COM-style vtables), written out here by hand from the SDK's `pluginterfaces` headers (MIT
//! since 3.8; only what a host needs), so the engine keeps no dependencies. A `.vst3` (a bundle folder, or on old
//! Windows installs a single file) is a library exporting `GetPluginFactory`; the factory makes a plugin's processor
//! (`IComponent` + `IAudioProcessor`) and, usually as a second class, its controller (`IEditController`), which owns
//! the parameter list. The host keeps the two in step: a slider moved here goes to both.
//!
//! Parameters: VST3 hands the host values in 0..1. A stepped one (`stepCount` > 0) is shown as 0..stepCount, so a
//! switch is 0 or 1 like a CLAP one; the rest stay 0..1. Editors (`IPlugView`) aren't opened yet (#5516).
//!
//! Threads, like the CLAP host: everything is called from the one thread that owns the handle. A plugin runs in this
//! process: one that crashes takes the app with it.
//!
//! [`tone`] is a VST3 of our own, exported from this library as `GetPluginFactory`, so the host can be tried (and
//! tested) without anyone's plugin installed.

use crate::clap::{dl, keep_change, take_changes, Descriptor, Param, MAX_EVENTS, MAX_FRAMES};
use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::Arc;

pub mod tone;

// ---- the VST3 ABI (pluginterfaces/base and pluginterfaces/vst, SDK 3.8) ----

pub type Tuid = [u8; 16];
pub type TResult = i32;
pub const OK: TResult = 0;
pub const FALSE: TResult = 1;
#[cfg(windows)]
pub const NO_INTERFACE: TResult = 0x8000_4002_u32 as i32;
#[cfg(not(windows))]
pub const NO_INTERFACE: TResult = -1;

/// An interface id from the four numbers the SDK writes it as (`INLINE_UID`): on Windows in COM's byte order.
pub const fn uid(a: u32, b: u32, c: u32, d: u32) -> Tuid {
    let (a, b, c, d) = (a.to_be_bytes(), b.to_be_bytes(), c.to_be_bytes(), d.to_be_bytes());
    if cfg!(windows) {
        [a[3], a[2], a[1], a[0], b[1], b[0], b[3], b[2], c[0], c[1], c[2], c[3], d[0], d[1], d[2], d[3]]
    } else {
        [a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3], c[0], c[1], c[2], c[3], d[0], d[1], d[2], d[3]]
    }
}

/// The four numbers back, as 32 hex digits: the same on every OS, so a groove names the plugin alike everywhere.
pub fn uid_text(t: &Tuid) -> String {
    let t = if cfg!(windows) { [t[3], t[2], t[1], t[0], t[5], t[4], t[7], t[6], t[8], t[9], t[10], t[11], t[12], t[13], t[14], t[15]] } else { *t };
    t.iter().map(|b| format!("{b:02X}")).collect()
}

pub const FUNKNOWN: Tuid = uid(0x00000000, 0x00000000, 0xC0000000, 0x00000046);
pub const IPLUGIN_BASE: Tuid = uid(0x22888DDB, 0x156E45AE, 0x8358B348, 0x08190625);
pub const IPLUGIN_FACTORY: Tuid = uid(0x7A4D811C, 0x52114A1F, 0xAED9D2EE, 0x0B43BF9F);
pub const IPLUGIN_FACTORY2: Tuid = uid(0x0007B650, 0xF24B4C0B, 0xA464EDB9, 0xF00B2ABB);
pub const ICOMPONENT: Tuid = uid(0xE831FF31, 0xF2D54301, 0x928EBBEE, 0x25697802);
pub const IAUDIO_PROCESSOR: Tuid = uid(0x42043F99, 0xB7DA453C, 0xA569E79D, 0x9AAEC33D);
pub const IEDIT_CONTROLLER: Tuid = uid(0xDCD7BBE3, 0x7742448D, 0xA874AACC, 0x979C759E);
pub const ICONNECTION_POINT: Tuid = uid(0x70A4156F, 0x6E6E4026, 0x989148BF, 0xAA60D8D1);
pub const IHOST_APPLICATION: Tuid = uid(0x58E595CC, 0xDB2D4969, 0x8B6AAF8C, 0x36A664E5);
pub const IEVENT_LIST: Tuid = uid(0x3A2C4214, 0x346349FE, 0xB2C4F397, 0xB9695A44);
pub const IPARAM_VALUE_QUEUE: Tuid = uid(0x01263A18, 0xED074F6F, 0x98C9D356, 0x4686F9BA);
pub const IPARAMETER_CHANGES: Tuid = uid(0xA4779663, 0x0BB64A56, 0xB44384A8, 0x466FEB9D);
pub const IBSTREAM: Tuid = uid(0xC3BF6EA2, 0x30994752, 0x9B6BF990, 0x1EE33E9B);

pub const AUDIO_MODULE_CLASS: &CStr = c"Audio Module Class";
pub const MEDIA_AUDIO: i32 = 0;
pub const MEDIA_EVENT: i32 = 1;
pub const DIR_INPUT: i32 = 0;
pub const DIR_OUTPUT: i32 = 1;
pub const SAMPLE_32: i32 = 0;
pub const REALTIME: i32 = 0;
pub const EVENT_NOTE_ON: u16 = 0;
pub const EVENT_NOTE_OFF: u16 = 1;
pub const PARAM_CAN_AUTOMATE: i32 = 1 << 0;
pub const PARAM_IS_READONLY: i32 = 1 << 1;
pub const PARAM_IS_HIDDEN: i32 = 1 << 4;
pub const BUS_DEFAULT_ACTIVE: u32 = 1 << 0;
pub const STEREO: u64 = 0b11;

type This = *mut c_void;

#[repr(C)]
pub struct Unknown {
    pub query_interface: unsafe extern "system" fn(This, *const Tuid, *mut *mut c_void) -> TResult,
    pub add_ref: unsafe extern "system" fn(This) -> u32,
    pub release: unsafe extern "system" fn(This) -> u32,
}

#[repr(C)]
pub struct FactoryInfo { pub vendor: [c_char; 64], pub url: [c_char; 256], pub email: [c_char; 128], pub flags: i32 }

#[repr(C)]
pub struct ClassInfo { pub cid: Tuid, pub cardinality: i32, pub category: [c_char; 32], pub name: [c_char; 64] }

#[repr(C)]
pub struct ClassInfo2 {
    pub cid: Tuid,
    pub cardinality: i32,
    pub category: [c_char; 32],
    pub name: [c_char; 64],
    pub class_flags: u32,
    pub sub_categories: [c_char; 128],
    pub vendor: [c_char; 64],
    pub version: [c_char; 64],
    pub sdk_version: [c_char; 64],
}

#[repr(C)]
pub struct FactoryVtbl {
    pub unknown: Unknown,
    pub get_factory_info: unsafe extern "system" fn(This, *mut FactoryInfo) -> TResult,
    pub count_classes: unsafe extern "system" fn(This) -> i32,
    pub get_class_info: unsafe extern "system" fn(This, i32, *mut ClassInfo) -> TResult,
    pub create_instance: unsafe extern "system" fn(This, *const c_char, *const c_char, *mut *mut c_void) -> TResult,
    /// IPluginFactory2 only: ask for it before calling this.
    pub get_class_info2: unsafe extern "system" fn(This, i32, *mut ClassInfo2) -> TResult,
}

#[repr(C)]
pub struct BusInfo { pub media_type: i32, pub direction: i32, pub channel_count: i32, pub name: [u16; 128], pub bus_type: i32, pub flags: u32 }

#[repr(C)]
pub struct ComponentVtbl {
    pub unknown: Unknown,
    pub initialize: unsafe extern "system" fn(This, *mut c_void) -> TResult,
    pub terminate: unsafe extern "system" fn(This) -> TResult,
    pub get_controller_class_id: unsafe extern "system" fn(This, *mut Tuid) -> TResult,
    pub set_io_mode: unsafe extern "system" fn(This, i32) -> TResult,
    pub get_bus_count: unsafe extern "system" fn(This, i32, i32) -> i32,
    pub get_bus_info: unsafe extern "system" fn(This, i32, i32, i32, *mut BusInfo) -> TResult,
    pub get_routing_info: unsafe extern "system" fn(This, *mut c_void, *mut c_void) -> TResult,
    pub activate_bus: unsafe extern "system" fn(This, i32, i32, i32, u8) -> TResult,
    pub set_active: unsafe extern "system" fn(This, u8) -> TResult,
    pub set_state: unsafe extern "system" fn(This, *mut c_void) -> TResult,
    pub get_state: unsafe extern "system" fn(This, *mut c_void) -> TResult,
}

#[repr(C)]
pub struct ProcessSetup { pub process_mode: i32, pub symbolic_sample_size: i32, pub max_samples_per_block: i32, pub sample_rate: f64 }

#[repr(C)]
pub struct AudioBusBuffers { pub num_channels: i32, pub silence_flags: u64, pub buffers: *mut *mut f32 }

#[repr(C)]
pub struct ProcessData {
    pub process_mode: i32,
    pub symbolic_sample_size: i32,
    pub num_samples: i32,
    pub num_inputs: i32,
    pub num_outputs: i32,
    pub inputs: *mut AudioBusBuffers,
    pub outputs: *mut AudioBusBuffers,
    pub input_parameter_changes: *mut c_void,
    pub output_parameter_changes: *mut c_void,
    pub input_events: *mut c_void,
    pub output_events: *mut c_void,
    pub process_context: *mut c_void,
}

#[repr(C)]
pub struct ProcessorVtbl {
    pub unknown: Unknown,
    pub set_bus_arrangements: unsafe extern "system" fn(This, *mut u64, i32, *mut u64, i32) -> TResult,
    pub get_bus_arrangement: unsafe extern "system" fn(This, i32, i32, *mut u64) -> TResult,
    pub can_process_sample_size: unsafe extern "system" fn(This, i32) -> TResult,
    pub get_latency_samples: unsafe extern "system" fn(This) -> u32,
    pub setup_processing: unsafe extern "system" fn(This, *mut ProcessSetup) -> TResult,
    pub set_processing: unsafe extern "system" fn(This, u8) -> TResult,
    pub process: unsafe extern "system" fn(This, *mut ProcessData) -> TResult,
    pub get_tail_samples: unsafe extern "system" fn(This) -> u32,
}

#[repr(C)]
pub struct ParameterInfo {
    pub id: u32,
    pub title: [u16; 128],
    pub short_title: [u16; 128],
    pub units: [u16; 128],
    pub step_count: i32,
    pub default_normalized_value: f64,
    pub unit_id: i32,
    pub flags: i32,
}

#[repr(C)]
pub struct ControllerVtbl {
    pub unknown: Unknown,
    pub initialize: unsafe extern "system" fn(This, *mut c_void) -> TResult,
    pub terminate: unsafe extern "system" fn(This) -> TResult,
    pub set_component_state: unsafe extern "system" fn(This, *mut c_void) -> TResult,
    pub set_state: unsafe extern "system" fn(This, *mut c_void) -> TResult,
    pub get_state: unsafe extern "system" fn(This, *mut c_void) -> TResult,
    pub get_parameter_count: unsafe extern "system" fn(This) -> i32,
    pub get_parameter_info: unsafe extern "system" fn(This, i32, *mut ParameterInfo) -> TResult,
    pub get_param_string_by_value: unsafe extern "system" fn(This, u32, f64, *mut u16) -> TResult,
    pub get_param_value_by_string: unsafe extern "system" fn(This, u32, *mut u16, *mut f64) -> TResult,
    pub normalized_param_to_plain: unsafe extern "system" fn(This, u32, f64) -> f64,
    pub plain_param_to_normalized: unsafe extern "system" fn(This, u32, f64) -> f64,
    pub get_param_normalized: unsafe extern "system" fn(This, u32) -> f64,
    pub set_param_normalized: unsafe extern "system" fn(This, u32, f64) -> TResult,
    pub set_component_handler: unsafe extern "system" fn(This, *mut c_void) -> TResult,
    pub create_view: unsafe extern "system" fn(This, *const c_char) -> *mut c_void,
}

#[repr(C)]
pub struct ConnectionVtbl {
    pub unknown: Unknown,
    pub connect: unsafe extern "system" fn(This, *mut c_void) -> TResult,
    pub disconnect: unsafe extern "system" fn(This, *mut c_void) -> TResult,
    pub notify: unsafe extern "system" fn(This, *mut c_void) -> TResult,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct NoteOn { pub channel: i16, pub pitch: i16, pub tuning: f32, pub velocity: f32, pub length: i32, pub note_id: i32 }

#[repr(C)]
#[derive(Clone, Copy)]
pub struct NoteOff { pub channel: i16, pub pitch: i16, pub velocity: f32, pub note_id: i32, pub tuning: f32 }

/// The union's biggest member is a text event (three ints and a pointer): 24 bytes.
#[repr(C)]
#[derive(Clone, Copy)]
pub union EventBody { pub note_on: NoteOn, pub note_off: NoteOff, _size: [u64; 3] }

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Event { pub bus_index: i32, pub sample_offset: i32, pub ppq_position: f64, pub flags: u16, pub kind: u16, pub body: EventBody }

#[repr(C)]
pub struct EventListVtbl {
    pub unknown: Unknown,
    pub get_event_count: unsafe extern "system" fn(This) -> i32,
    pub get_event: unsafe extern "system" fn(This, i32, *mut Event) -> TResult,
    pub add_event: unsafe extern "system" fn(This, *mut Event) -> TResult,
}

#[repr(C)]
pub struct QueueVtbl {
    pub unknown: Unknown,
    pub get_parameter_id: unsafe extern "system" fn(This) -> u32,
    pub get_point_count: unsafe extern "system" fn(This) -> i32,
    pub get_point: unsafe extern "system" fn(This, i32, *mut i32, *mut f64) -> TResult,
    pub add_point: unsafe extern "system" fn(This, i32, f64, *mut i32) -> TResult,
}

#[repr(C)]
pub struct ChangesVtbl {
    pub unknown: Unknown,
    pub get_parameter_count: unsafe extern "system" fn(This) -> i32,
    pub get_parameter_data: unsafe extern "system" fn(This, i32) -> *mut c_void,
    pub add_parameter_data: unsafe extern "system" fn(This, *const u32, *mut i32) -> *mut c_void,
}

#[repr(C)]
pub struct StreamVtbl {
    pub unknown: Unknown,
    pub read: unsafe extern "system" fn(This, *mut c_void, i32, *mut i32) -> TResult,
    pub write: unsafe extern "system" fn(This, *mut c_void, i32, *mut i32) -> TResult,
    pub seek: unsafe extern "system" fn(This, i64, i32, *mut i64) -> TResult,
    pub tell: unsafe extern "system" fn(This, *mut i64) -> TResult,
}

#[repr(C)]
pub struct HostAppVtbl {
    pub unknown: Unknown,
    pub get_name: unsafe extern "system" fn(This, *mut u16) -> TResult,
    pub create_instance: unsafe extern "system" fn(This, *mut Tuid, *mut Tuid, *mut *mut c_void) -> TResult,
}

#[cfg(target_pointer_width = "64")]
const _: () = {
    use std::mem::size_of;
    assert!(size_of::<Event>() == 48);
    assert!(size_of::<BusInfo>() == 276);
    assert!(size_of::<ParameterInfo>() == 792);
    assert!(size_of::<ClassInfo>() == 116);
    assert!(size_of::<ClassInfo2>() == 440);
    assert!(size_of::<FactoryInfo>() == 452);
    assert!(size_of::<ProcessSetup>() == 24);
    assert!(size_of::<AudioBusBuffers>() == 24);
    assert!(size_of::<ProcessData>() == 80);
};

/// The vtable behind an interface pointer (an object whose first field points at its table).
/// # Safety
/// `obj` must be a live object implementing `V`.
pub unsafe fn vt<'a, V>(obj: *mut c_void) -> &'a V { &**(obj as *const *const V) }

/// One reference to a plugin's object, released on drop.
pub struct Com(*mut c_void);

impl Com {
    /// # Safety
    /// `p` must be an owned reference to a live object, or null (None).
    pub unsafe fn own(p: *mut c_void) -> Option<Com> { if p.is_null() { None } else { Some(Com(p)) } }
    pub fn ptr(&self) -> *mut c_void { self.0 }
    /// # Safety
    /// `V` must be an interface the object implements.
    pub unsafe fn v<V>(&self) -> &V { vt(self.0) }
    pub fn query(&self, iid: &Tuid) -> Option<Com> { unsafe { query(self.0, iid) } }
}

/// A new reference to `obj`'s `iid` side, if it has one.
/// # Safety
/// `obj` must be a live object.
pub unsafe fn query(obj: *mut c_void, iid: &Tuid) -> Option<Com> {
    let mut out = std::ptr::null_mut();
    if (vt::<Unknown>(obj).query_interface)(obj, iid, &mut out) != OK { return None; }
    Com::own(out)
}

impl Drop for Com {
    fn drop(&mut self) { unsafe { (vt::<Unknown>(self.0).release)(self.0); } }
}

// ---- the host side a plugin sees: our own small objects, owned by the Plugin (counts are for show) ----

unsafe extern "system" fn add_ref(_: This) -> u32 { 1 }
unsafe extern "system" fn release(_: This) -> u32 { 1 }

/// `queryInterface` for an object of ours that is only `FUnknown` and `iid`.
unsafe fn answer(this: This, asked: *const Tuid, iid: &Tuid, obj: *mut *mut c_void) -> TResult {
    if obj.is_null() { return NO_INTERFACE; }
    if !asked.is_null() && (*asked == FUNKNOWN || *asked == *iid) { *obj = this; return OK; }
    *obj = std::ptr::null_mut();
    NO_INTERFACE
}

/// Writes `s` into a String128 (UTF-16, cut to fit, ended with 0).
/// # Safety
/// `out` must point to 128 u16s, or be null.
pub unsafe fn put_utf16(s: &str, out: *mut u16) {
    if out.is_null() { return; }
    let mut n = 0;
    for u in s.encode_utf16().take(127) { *out.add(n) = u; n += 1; }
    *out.add(n) = 0;
}

pub fn utf16_text(s: &[u16]) -> String { String::from_utf16_lossy(&s[..s.iter().position(|c| *c == 0).unwrap_or(s.len())]) }

pub fn c_text(s: &[c_char]) -> String {
    let b: Vec<u8> = s.iter().take_while(|c| **c != 0).map(|c| *c as u8).collect();
    String::from_utf8_lossy(&b).into_owned()
}

#[repr(C)]
struct HostApp { vtbl: &'static HostAppVtbl }
unsafe extern "system" fn app_query(this: This, iid: *const Tuid, obj: *mut *mut c_void) -> TResult { answer(this, iid, &IHOST_APPLICATION, obj) }
unsafe extern "system" fn app_name(_: This, out: *mut u16) -> TResult { put_utf16("FM DAW", out); OK }
/// We make no objects for a plugin (messages between its halves go through `IConnectionPoint` without us).
unsafe extern "system" fn app_create(_: This, _: *mut Tuid, _: *mut Tuid, obj: *mut *mut c_void) -> TResult {
    if !obj.is_null() { *obj = std::ptr::null_mut(); }
    NO_INTERFACE
}
static HOST_APP_VTBL: HostAppVtbl = HostAppVtbl { unknown: Unknown { query_interface: app_query, add_ref, release }, get_name: app_name, create_instance: app_create };
static HOST_APP: HostApp = HostApp { vtbl: &HOST_APP_VTBL };
fn host_app() -> *mut c_void { &HOST_APP as *const HostApp as *mut c_void }

/// The notes for the next block, all at its start.
#[repr(C)]
struct EventList { vtbl: &'static EventListVtbl, events: Vec<Event> }
unsafe extern "system" fn events_query(this: This, iid: *const Tuid, obj: *mut *mut c_void) -> TResult { answer(this, iid, &IEVENT_LIST, obj) }
unsafe extern "system" fn events_count(this: This) -> i32 { (*(this as *const EventList)).events.len() as i32 }
unsafe extern "system" fn events_get(this: This, i: i32, out: *mut Event) -> TResult {
    let l = &*(this as *const EventList);
    match (usize::try_from(i).ok().and_then(|i| l.events.get(i)), out.is_null()) { (Some(e), false) => { *out = *e; OK } _ => FALSE }
}
/// A plugin's own events out (notes it plays) aren't used here.
unsafe extern "system" fn events_add(_: This, _: *mut Event) -> TResult { OK }
static EVENTS_VTBL: EventListVtbl = EventListVtbl {
    unknown: Unknown { query_interface: events_query, add_ref, release }, get_event_count: events_count, get_event: events_get, add_event: events_add,
};

/// One parameter's moves in a block.
#[repr(C)]
struct Queue { vtbl: &'static QueueVtbl, id: u32, points: Vec<(i32, f64)> }
unsafe extern "system" fn queue_query(this: This, iid: *const Tuid, obj: *mut *mut c_void) -> TResult { answer(this, iid, &IPARAM_VALUE_QUEUE, obj) }
unsafe extern "system" fn queue_id(this: This) -> u32 { (*(this as *const Queue)).id }
unsafe extern "system" fn queue_count(this: This) -> i32 { (*(this as *const Queue)).points.len() as i32 }
unsafe extern "system" fn queue_get(this: This, i: i32, offset: *mut i32, value: *mut f64) -> TResult {
    let q = &*(this as *const Queue);
    let Some(&(o, v)) = usize::try_from(i).ok().and_then(|i| q.points.get(i)) else { return FALSE };
    if !offset.is_null() { *offset = o; }
    if !value.is_null() { *value = v; }
    OK
}
unsafe extern "system" fn queue_add(this: This, offset: i32, value: f64, index: *mut i32) -> TResult {
    let q = &mut *(this as *mut Queue);
    if q.points.len() >= MAX_FRAMES || !value.is_finite() { return FALSE; }
    q.points.push((offset, value.clamp(0.0, 1.0)));
    if !index.is_null() { *index = q.points.len() as i32 - 1; }
    OK
}
static QUEUE_VTBL: QueueVtbl = QueueVtbl {
    unknown: Unknown { query_interface: queue_query, add_ref, release },
    get_parameter_id: queue_id, get_point_count: queue_count, get_point: queue_get, add_point: queue_add,
};

/// A block's parameter moves, one queue per parameter: what the host sends, or what the plugin says back.
/// Queues are boxed, so a pointer handed out stays put while the plugin adds more; `used` of them are this block's.
#[repr(C)]
#[allow(clippy::vec_box)]
struct Changes { vtbl: &'static ChangesVtbl, queues: Vec<Box<Queue>>, used: usize }
const MAX_QUEUES: usize = 1024;
impl Changes {
    fn new() -> Box<Changes> { Box::new(Changes { vtbl: &CHANGES_VTBL, queues: Vec::new(), used: 0 }) }
    fn queue(&mut self, id: u32) -> Option<(usize, &mut Queue)> {
        let i = match self.queues[..self.used].iter().position(|q| q.id == id) {
            Some(i) => i,
            None if self.used < MAX_QUEUES => {
                if self.used == self.queues.len() { self.queues.push(Box::new(Queue { vtbl: &QUEUE_VTBL, id, points: Vec::new() })); }
                let q = &mut self.queues[self.used];
                q.id = id;
                q.points.clear();
                self.used += 1;
                self.used - 1
            }
            None => return None,
        };
        Some((i, &mut self.queues[i]))
    }
    /// The host's move: one point at the block's start, the last value asked for.
    fn set(&mut self, id: u32, value: f64) {
        if let Some((_, q)) = self.queue(id) { q.points.clear(); q.points.push((0, value)); }
    }
    fn clear(&mut self) { self.used = 0; }
    fn ptr(&mut self) -> *mut c_void { self as *mut Changes as *mut c_void }
}
unsafe extern "system" fn changes_query(this: This, iid: *const Tuid, obj: *mut *mut c_void) -> TResult { answer(this, iid, &IPARAMETER_CHANGES, obj) }
unsafe extern "system" fn changes_count(this: This) -> i32 { (*(this as *const Changes)).used as i32 }
unsafe extern "system" fn changes_get(this: This, i: i32) -> *mut c_void {
    let c = &mut *(this as *mut Changes);
    match usize::try_from(i) { Ok(i) if i < c.used => &mut *c.queues[i] as *mut Queue as *mut c_void, _ => std::ptr::null_mut() }
}
unsafe extern "system" fn changes_add(this: This, id: *const u32, index: *mut i32) -> *mut c_void {
    if id.is_null() { return std::ptr::null_mut(); }
    let c = &mut *(this as *mut Changes);
    match c.queue(*id) {
        Some((i, q)) => { if !index.is_null() { *index = i as i32; } q as *mut Queue as *mut c_void }
        None => std::ptr::null_mut(),
    }
}
static CHANGES_VTBL: ChangesVtbl = ChangesVtbl {
    unknown: Unknown { query_interface: changes_query, add_ref, release },
    get_parameter_count: changes_count, get_parameter_data: changes_get, add_parameter_data: changes_add,
};

/// A stream in memory, for a plugin's saved state (the processor writes it, the controller reads it).
#[repr(C)]
pub struct Stream { vtbl: &'static StreamVtbl, pub data: Vec<u8>, pub pos: usize }
/// A state past this is refused (a plugin's settings, not a sample library).
const MAX_STATE: usize = 64 << 20;
impl Stream {
    pub fn new() -> Box<Stream> { Box::new(Stream { vtbl: &STREAM_VTBL, data: Vec::new(), pos: 0 }) }
    pub fn ptr(&mut self) -> *mut c_void { self as *mut Stream as *mut c_void }
}
unsafe extern "system" fn stream_query(this: This, iid: *const Tuid, obj: *mut *mut c_void) -> TResult { answer(this, iid, &IBSTREAM, obj) }
unsafe extern "system" fn stream_read(this: This, buf: *mut c_void, n: i32, got: *mut i32) -> TResult {
    let s = &mut *(this as *mut Stream);
    let n = (n.max(0) as usize).min(s.data.len().saturating_sub(s.pos));
    if n > 0 && !buf.is_null() { std::ptr::copy_nonoverlapping(s.data.as_ptr().add(s.pos), buf as *mut u8, n); }
    s.pos += n;
    if !got.is_null() { *got = n as i32; }
    OK
}
unsafe extern "system" fn stream_write(this: This, buf: *mut c_void, n: i32, put: *mut i32) -> TResult {
    let s = &mut *(this as *mut Stream);
    let n = n.max(0) as usize;
    if buf.is_null() || s.pos + n > MAX_STATE { return FALSE; }
    let end = s.pos + n;
    if s.data.len() < end { s.data.resize(end, 0); }
    std::ptr::copy_nonoverlapping(buf as *const u8, s.data.as_mut_ptr().add(s.pos), n);
    s.pos = end;
    if !put.is_null() { *put = n as i32; }
    OK
}
unsafe extern "system" fn stream_seek(this: This, pos: i64, mode: i32, result: *mut i64) -> TResult {
    let s = &mut *(this as *mut Stream);
    let base = match mode { 0 => 0, 1 => s.pos as i64, 2 => s.data.len() as i64, _ => return FALSE };
    let to = base.saturating_add(pos);
    if to < 0 || to as usize > MAX_STATE { return FALSE; }
    s.pos = to as usize;
    if !result.is_null() { *result = to; }
    OK
}
unsafe extern "system" fn stream_tell(this: This, pos: *mut i64) -> TResult {
    if !pos.is_null() { *pos = (*(this as *const Stream)).pos as i64; }
    OK
}
static STREAM_VTBL: StreamVtbl = StreamVtbl {
    unknown: Unknown { query_interface: stream_query, add_ref, release }, read: stream_read, write: stream_write, seek: stream_seek, tell: stream_tell,
};

// ---- opening a library ----

/// The library inside a `.vst3` bundle: `Contents/MacOS/<name>` on macOS, `Contents/<arch>-win/<name>.vst3` on
/// Windows, `Contents/<arch>-linux/<name>.so` on Linux; a `.vst3` that is a plain file is the library itself.
pub fn binary_of(path: &str) -> String {
    let p = std::path::Path::new(path);
    if !p.is_dir() { return path.to_string(); }
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let arch = std::env::consts::ARCH;
    let (dir, file) = if cfg!(target_os = "macos") { ("MacOS".to_string(), stem.to_string()) }
        else if cfg!(windows) { (format!("{}-win", if arch == "aarch64" { "arm64" } else { arch }), format!("{stem}.vst3")) }
        else { (format!("{arch}-linux"), format!("{stem}.so")) };
    let dir = p.join("Contents").join(dir);
    let inner = dir.join(file);
    if inner.exists() { return inner.to_string_lossy().into_owned(); }
    if let Ok(d) = std::fs::read_dir(&dir) { if let Some(f) = d.flatten().next() { return f.path().to_string_lossy().into_owned(); } }
    path.to_string()
}

/// The module's own start and stop calls, which each OS names differently (`bundleEntry`, `ModuleEntry`, `InitDll`).
/// A library without them (ours) starts as it is.
struct Module { lib: *mut c_void, exit: Option<unsafe extern "C" fn() -> bool>, cf_bundle: *mut c_void }

#[cfg(target_os = "macos")]
mod cf {
    use super::dl;
    use std::ffi::c_void;
    type CreateUrl = unsafe extern "C" fn(*const c_void, *const u8, isize, bool) -> *mut c_void;
    type CreateBundle = unsafe extern "C" fn(*const c_void, *mut c_void) -> *mut c_void;
    type Release = unsafe extern "C" fn(*mut c_void);
    unsafe fn lib() -> *mut c_void { dl::open(c"/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation") }
    /// A CFBundleRef for the `.vst3` folder, which macOS plugins expect in `bundleEntry`; null if it can't be made.
    pub unsafe fn bundle(path: &str) -> *mut c_void {
        let l = lib();
        if l.is_null() { return std::ptr::null_mut(); }
        let (u, b) = (dl::sym(l, c"CFURLCreateFromFileSystemRepresentation"), dl::sym(l, c"CFBundleCreate"));
        if u.is_null() || b.is_null() { return std::ptr::null_mut(); }
        let url = std::mem::transmute::<*mut c_void, CreateUrl>(u)(std::ptr::null(), path.as_ptr(), path.len() as isize, true);
        if url.is_null() { return std::ptr::null_mut(); }
        let bundle = std::mem::transmute::<*mut c_void, CreateBundle>(b)(std::ptr::null(), url);
        release(url);
        bundle
    }
    pub unsafe fn release(p: *mut c_void) {
        let l = lib();
        if p.is_null() || l.is_null() { return; }
        let r = dl::sym(l, c"CFRelease");
        if !r.is_null() { std::mem::transmute::<*mut c_void, Release>(r)(p); }
    }
}

impl Module {
    unsafe fn start(lib: *mut c_void, path: &str) -> Result<Module, String> {
        let sym = |n: &CStr| dl::sym(lib, n);
        #[allow(unused_mut)]
        let mut cf_bundle = std::ptr::null_mut();
        let (entry, exit) = if cfg!(target_os = "macos") { (sym(c"bundleEntry"), sym(c"bundleExit")) }
            else if cfg!(windows) { (sym(c"InitDll"), sym(c"ExitDll")) }
            else { (sym(c"ModuleEntry"), sym(c"ModuleExit")) };
        if !entry.is_null() {
            #[cfg(target_os = "macos")]
            { cf_bundle = cf::bundle(path); }
            let ok = if cfg!(windows) {
                std::mem::transmute::<*mut c_void, unsafe extern "C" fn() -> bool>(entry)()
            } else {
                // macOS hands over its CFBundleRef, Linux the library handle
                let arg = if cfg!(target_os = "macos") { cf_bundle } else { lib };
                std::mem::transmute::<*mut c_void, unsafe extern "C" fn(*mut c_void) -> bool>(entry)(arg)
            };
            if !ok {
                #[cfg(target_os = "macos")]
                cf::release(cf_bundle);
                return Err(format!("{path} refused to start"));
            }
        }
        let exit = if entry.is_null() || exit.is_null() { None } else { Some(std::mem::transmute::<*mut c_void, unsafe extern "C" fn() -> bool>(exit)) };
        Ok(Module { lib, exit, cf_bundle })
    }
}

impl Drop for Module {
    fn drop(&mut self) {
        unsafe {
            if let Some(exit) = self.exit { exit(); }
            #[cfg(target_os = "macos")]
            cf::release(self.cf_bundle);
            if !self.lib.is_null() { dl::close(self.lib); }
        }
    }
}

struct Class { cid: Tuid, desc: Descriptor }

/// An opened `.vst3`: its library stays loaded while any plugin made from it runs.
pub struct Bundle {
    factory: Option<Com>,
    classes: Vec<Class>,
    _module: Module,
}

// The factory is shared across threads by the VST3 spec; we only call it from the owner's thread anyway.
unsafe impl Send for Bundle {}
unsafe impl Sync for Bundle {}

type GetFactory = unsafe extern "system" fn() -> *mut c_void;

impl Bundle {
    /// Opens a `.vst3` bundle folder or file: `Err` says why not, for the track menu.
    pub fn open(path: &str) -> Result<Arc<Bundle>, String> {
        let bin = CString::new(binary_of(path)).map_err(|_| "a path with a NUL in it".to_string())?;
        unsafe {
            let lib = dl::open(&bin);
            if lib.is_null() { return Err(format!("couldn't load {path}")); }
            let get = dl::sym(lib, c"GetPluginFactory");
            if get.is_null() { dl::close(lib); return Err(format!("{path} isn't a VST3 plugin (no GetPluginFactory)")); }
            let module = Module::start(lib, path)?;
            Bundle::from_factory(std::mem::transmute::<*mut c_void, GetFactory>(get), path, module)
        }
    }

    /// The Test Tone this library exports, opened without loading anything.
    pub fn own() -> Result<Arc<Bundle>, String> {
        unsafe { Bundle::from_factory(tone::GetPluginFactory, "test-tone.vst3", Module { lib: std::ptr::null_mut(), exit: None, cf_bundle: std::ptr::null_mut() }) }
    }

    unsafe fn from_factory(get: GetFactory, path: &str, module: Module) -> Result<Arc<Bundle>, String> {
        let Some(factory) = Com::own(get()) else { return Err(format!("{path} makes no plugins")) };
        let f: &FactoryVtbl = factory.v();
        let mut info: FactoryInfo = std::mem::zeroed();
        let vendor = if (f.get_factory_info)(factory.ptr(), &mut info) == OK { c_text(&info.vendor) } else { String::new() };
        let two = factory.query(&IPLUGIN_FACTORY2);
        let mut classes = Vec::new();
        for i in 0..(f.count_classes)(factory.ptr()).clamp(0, 256) {
            let mut c2: ClassInfo2 = std::mem::zeroed();
            let class = if two.as_ref().is_some_and(|t| (t.v::<FactoryVtbl>().get_class_info2)(t.ptr(), i, &mut c2) == OK) {
                let v = c_text(&c2.vendor);
                (c2.cid, c_text(&c2.category), c_text(&c2.name), if v.is_empty() { vendor.clone() } else { v }, c_text(&c2.version), c_text(&c2.sub_categories))
            } else {
                let mut c: ClassInfo = std::mem::zeroed();
                if (f.get_class_info)(factory.ptr(), i, &mut c) != OK { continue; }
                (c.cid, c_text(&c.category), c_text(&c.name), vendor.clone(), String::new(), String::new())
            };
            let (cid, category, name, vendor, version, subs) = class;
            if category.as_bytes() != AUDIO_MODULE_CLASS.to_bytes() { continue; }
            let features = subs.split('|').filter(|s| !s.is_empty()).take(32).map(|s| s.to_lowercase()).collect();
            classes.push(Class { cid, desc: Descriptor { id: uid_text(&cid), name, vendor, version, features } });
        }
        drop(two);
        Ok(Arc::new(Bundle { factory: Some(factory), classes, _module: module }))
    }

    pub fn plugins(&self) -> Vec<Descriptor> {
        self.classes.iter().map(|c| Descriptor { id: c.desc.id.clone(), name: c.desc.name.clone(), vendor: c.desc.vendor.clone(), version: c.desc.version.clone(), features: c.desc.features.clone() }).collect()
    }

    fn make(&self, cid: &Tuid, iid: &Tuid) -> Option<Com> {
        let f = self.factory.as_ref()?;
        let mut out = std::ptr::null_mut();
        unsafe {
            if (f.v::<FactoryVtbl>().create_instance)(f.ptr(), cid.as_ptr() as *const c_char, iid.as_ptr() as *const c_char, &mut out) != OK { return None; }
            Com::own(out)
        }
    }
}

impl Drop for Bundle {
    // the factory goes before the module's exit call and the library's unload (field order would do it; this says so)
    fn drop(&mut self) { self.factory = None; }
}

// ---- a running plugin ----

/// What the host knows of one parameter: its steps (0: continuous), to turn the slider's value into 0..1 and back.
struct Steps { id: u32, steps: i32 }

/// A running VST3 plugin: its processor, and its controller when it has one.
pub struct Plugin {
    name: String,
    component: Com,
    processor: Option<Com>,
    controller: Option<Com>,
    /// The controller is a second object (initialised and terminated here), not the component itself.
    separate: bool,
    connected: bool,
    initialized: bool,
    active: bool,
    processing: bool,
    broken: bool,
    steps: Vec<Steps>,
    events: Box<EventList>,
    input_changes: Box<Changes>,
    output_changes: Box<Changes>,
    changes: Vec<(u32, f64)>,
    inputs: Vec<Vec<Vec<f32>>>,
    outputs: Vec<Vec<Vec<f32>>>,
    _bundle: Arc<Bundle>,
}

fn buses(c: &Com, dir: i32) -> Vec<Vec<Vec<f32>>> {
    unsafe {
        let v: &ComponentVtbl = c.v();
        let n = (v.get_bus_count)(c.ptr(), MEDIA_AUDIO, dir).clamp(0, 16);
        (0..n).map(|i| {
            let mut info: BusInfo = std::mem::zeroed();
            let ch = if (v.get_bus_info)(c.ptr(), MEDIA_AUDIO, dir, i, &mut info) == OK { info.channel_count.clamp(1, 16) } else { 2 };
            (v.activate_bus)(c.ptr(), MEDIA_AUDIO, dir, i, 1);
            vec![vec![0.0; MAX_FRAMES]; ch as usize]
        }).collect()
    }
}

impl Plugin {
    /// Makes plugin `index` of `bundle` and starts it at `sample_rate`.
    pub fn new(bundle: &Arc<Bundle>, index: u32, sample_rate: f64) -> Result<Plugin, String> {
        let class = bundle.classes.get(index as usize).ok_or("no plugin at that index")?;
        let name = class.desc.name.clone();
        let component = bundle.make(&class.cid, &ICOMPONENT).ok_or_else(|| format!("{name} couldn't be made"))?;
        let mut p = Plugin {
            name, component, processor: None, controller: None, separate: false, connected: false, initialized: false,
            active: false, processing: false, broken: false, steps: Vec::new(),
            events: Box::new(EventList { vtbl: &EVENTS_VTBL, events: Vec::with_capacity(MAX_EVENTS) }),
            input_changes: Changes::new(), output_changes: Changes::new(), changes: Vec::new(),
            inputs: Vec::new(), outputs: Vec::new(), _bundle: bundle.clone(),
        };
        unsafe {
            let cp = p.component.ptr();
            let c: &ComponentVtbl = vt(cp);
            if (c.initialize)(cp, host_app()) != OK { return Err(format!("{} refused to start", p.name)); }
            p.initialized = true;
            p.processor = p.component.query(&IAUDIO_PROCESSOR);
            let Some(pp) = p.processor.as_ref().map(Com::ptr) else { return Err(format!("{} makes no sound (no audio processor)", p.name)) };
            let pv: &ProcessorVtbl = vt(pp);

            // the controller: a class of its own (the usual way), or the component itself
            let mut ccid: Tuid = [0; 16];
            if (c.get_controller_class_id)(cp, &mut ccid) == OK && ccid != [0; 16] {
                if let Some(ctl) = bundle.make(&ccid, &IEDIT_CONTROLLER) {
                    if (ctl.v::<ControllerVtbl>().initialize)(ctl.ptr(), host_app()) == OK { p.controller = Some(ctl); p.separate = true; }
                }
            }
            if p.controller.is_none() { p.controller = p.component.query(&IEDIT_CONTROLLER); }
            if let (true, Some(ctl)) = (p.separate, p.controller.as_ref().map(Com::ptr)) {
                let cv: &ControllerVtbl = vt(ctl);
                if let (Some(a), Some(b)) = (p.component.query(&ICONNECTION_POINT), query(ctl, &ICONNECTION_POINT)) {
                    (a.v::<ConnectionVtbl>().connect)(a.ptr(), b.ptr());
                    (b.v::<ConnectionVtbl>().connect)(b.ptr(), a.ptr());
                    p.connected = true;
                }
                // the controller starts from the processor's settings
                let mut st = Stream::new();
                if (c.get_state)(cp, st.ptr()) == OK { st.pos = 0; (cv.set_component_state)(ctl, st.ptr()); }
            }

            p.inputs = buses(&p.component, DIR_INPUT);
            p.outputs = buses(&p.component, DIR_OUTPUT);
            if p.outputs.is_empty() { return Err(format!("{} has no audio out", p.name)); }
            if (c.get_bus_count)(cp, MEDIA_EVENT, DIR_INPUT) > 0 { (c.activate_bus)(cp, MEDIA_EVENT, DIR_INPUT, 0, 1); }
            if (pv.can_process_sample_size)(pp, SAMPLE_32) != OK { return Err(format!("{} doesn't take 32-bit audio", p.name)); }
            let mut setup = ProcessSetup { process_mode: REALTIME, symbolic_sample_size: SAMPLE_32, max_samples_per_block: MAX_FRAMES as i32, sample_rate };
            if (pv.setup_processing)(pp, &mut setup) != OK || (c.set_active)(cp, 1) != OK { return Err(format!("{} won't run at {sample_rate} Hz", p.name)); }
            p.active = true;
        }
        p.steps = p.infos().into_iter().map(|i| Steps { id: i.id, steps: i.step_count.max(0) }).collect();
        Ok(p)
    }

    fn infos(&self) -> Vec<ParameterInfo> {
        let Some(ctl) = self.controller.as_ref() else { return vec![] };
        unsafe {
            let v: &ControllerVtbl = ctl.v();
            let n = (v.get_parameter_count)(ctl.ptr()).clamp(0, 4096);
            (0..n).filter_map(|i| {
                let mut info: ParameterInfo = std::mem::zeroed();
                ((v.get_parameter_info)(ctl.ptr(), i, &mut info) == OK).then_some(info)
            }).collect()
        }
    }

    fn scale(&self, id: u32) -> f64 { self.steps.iter().find(|s| s.id == id).map_or(1.0, |s| if s.steps > 0 { s.steps as f64 } else { 1.0 }) }

    fn note(&mut self, kind: u16, key: u32, velocity: f64, channel: u32) {
        if self.events.events.len() >= MAX_EVENTS { return; }
        let (channel, pitch, velocity) = ((channel & 15) as i16, key.min(127) as i16, velocity.clamp(0.0, 1.0) as f32);
        let body = if kind == EVENT_NOTE_ON { EventBody { note_on: NoteOn { channel, pitch, tuning: 0.0, velocity, length: 0, note_id: -1 } } }
            else { EventBody { note_off: NoteOff { channel, pitch, velocity, note_id: -1, tuning: 0.0 } } };
        self.events.events.push(Event { bus_index: 0, sample_offset: 0, ppq_position: 0.0, flags: 1, kind, body });
    }
    pub fn note_on(&mut self, key: u32, velocity: f64, channel: u32) { self.note(EVENT_NOTE_ON, key, velocity, channel) }
    pub fn note_off(&mut self, key: u32, channel: u32) { self.note(EVENT_NOTE_OFF, key, 0.0, channel) }

    /// Moves parameter `id` to `value` (0..1, or 0..steps for a stepped one): for the processor's next block, and
    /// the controller now, so what it reports back matches.
    pub fn set_param(&mut self, id: u32, value: f64) {
        if !value.is_finite() { return; }
        let n = (value / self.scale(id)).clamp(0.0, 1.0);
        self.input_changes.set(id, n);
        if let Some(ctl) = self.controller.as_ref() { unsafe { (ctl.v::<ControllerVtbl>().set_param_normalized)(ctl.ptr(), id, n); } }
    }

    /// The plugin's parameters a player may move, with their values now.
    pub fn params(&self) -> Vec<Param> {
        let Some(ctl) = self.controller.as_ref() else { return vec![] };
        self.infos().into_iter().filter(|i| i.flags & (PARAM_IS_READONLY | PARAM_IS_HIDDEN) == 0).map(|i| {
            let k = if i.step_count > 0 { i.step_count as f64 } else { 1.0 };
            let value = unsafe { (ctl.v::<ControllerVtbl>().get_param_normalized)(ctl.ptr(), i.id) };
            Param {
                id: i.id, name: utf16_text(&i.title), module: String::new(), min: 0.0, max: k,
                default: i.default_normalized_value.clamp(0.0, 1.0) * k, value: if value.is_finite() { value.clamp(0.0, 1.0) * k } else { 0.0 },
                stepped: i.step_count > 0,
            }
        }).collect()
    }

    /// Runs the plugin for `frames` and adds its first output into `out` (interleaved stereo; a mono bus goes to
    /// both sides). False once the plugin has failed: it stays silent from then on.
    pub fn render(&mut self, out: &mut [f32], frames: usize) -> bool {
        let frames = frames.min(out.len() / 2);
        if self.broken { return false; }
        if !self.processing {
            // setProcessing may answer "not implemented"; only a plain refusal stops it
            let Some(proc_) = self.processor.as_ref() else { self.broken = true; return false };
            let r = unsafe { (proc_.v::<ProcessorVtbl>().set_processing)(proc_.ptr(), 1) };
            if r == FALSE { self.broken = true; return false; }
            self.processing = true;
        }
        let mut done = 0;
        while done < frames {
            let n = (frames - done).min(MAX_FRAMES);
            if !self.block(n) { self.broken = true; return false; }
            let bus = &self.outputs[0];
            let (l, r) = (&bus[0], &bus[if bus.len() > 1 { 1 } else { 0 }]);
            for i in 0..n {
                let (a, b) = (l[i], r[i]);
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
        let Some(proc_) = self.processor.as_ref() else { return false };
        for bus in self.inputs.iter_mut().chain(self.outputs.iter_mut()) { for ch in bus.iter_mut() { ch[..n].fill(0.0); } }
        let mut in_ptrs: Vec<Vec<*mut f32>> = self.inputs.iter_mut().map(|b| b.iter_mut().map(|c| c.as_mut_ptr()).collect()).collect();
        let mut out_ptrs: Vec<Vec<*mut f32>> = self.outputs.iter_mut().map(|b| b.iter_mut().map(|c| c.as_mut_ptr()).collect()).collect();
        let buf = |p: &mut Vec<*mut f32>| AudioBusBuffers { num_channels: p.len() as i32, silence_flags: 0, buffers: p.as_mut_ptr() };
        let mut ins: Vec<AudioBusBuffers> = in_ptrs.iter_mut().map(buf).collect();
        let mut outs: Vec<AudioBusBuffers> = out_ptrs.iter_mut().map(buf).collect();
        self.output_changes.clear();
        let mut data = ProcessData {
            process_mode: REALTIME, symbolic_sample_size: SAMPLE_32, num_samples: n as i32,
            num_inputs: ins.len() as i32, num_outputs: outs.len() as i32, inputs: ins.as_mut_ptr(), outputs: outs.as_mut_ptr(),
            input_parameter_changes: self.input_changes.ptr(), output_parameter_changes: self.output_changes.ptr(),
            input_events: &mut *self.events as *mut EventList as *mut c_void, output_events: std::ptr::null_mut(),
            process_context: std::ptr::null_mut(),
        };
        let status = unsafe { (proc_.v::<ProcessorVtbl>().process)(proc_.ptr(), &mut data) };
        self.events.events.clear();
        self.input_changes.clear();
        // what the plugin moved itself: told to its controller, kept for the desk's sliders
        for q in &self.output_changes.queues[..self.output_changes.used] {
            let Some(&(_, v)) = q.points.last() else { continue };
            if let Some(ctl) = self.controller.as_ref() { unsafe { (ctl.v::<ControllerVtbl>().set_param_normalized)(ctl.ptr(), q.id, v); } }
            let k = self.steps.iter().find(|s| s.id == q.id).map_or(1.0, |s| if s.steps > 0 { s.steps as f64 } else { 1.0 });
            keep_change(&mut self.changes, q.id, v * k);
        }
        status == OK
    }

    /// Parameter moves the plugin made itself since last asked (`clap::take_changes`'s JSON).
    pub fn take_changes(&mut self, cap: usize) -> String { take_changes(&mut self.changes, cap) }

    pub fn name(&self) -> &str { &self.name }
}

impl Drop for Plugin {
    fn drop(&mut self) {
        unsafe {
            if let (true, Some(p)) = (self.processing, self.processor.as_ref()) { (p.v::<ProcessorVtbl>().set_processing)(p.ptr(), 0); }
            if self.active { (self.component.v::<ComponentVtbl>().set_active)(self.component.ptr(), 0); }
            if let Some(ctl) = self.controller.take() {
                if self.connected {
                    if let (Some(a), Some(b)) = (self.component.query(&ICONNECTION_POINT), ctl.query(&ICONNECTION_POINT)) {
                        (a.v::<ConnectionVtbl>().disconnect)(a.ptr(), b.ptr());
                        (b.v::<ConnectionVtbl>().disconnect)(b.ptr(), a.ptr());
                    }
                }
                if self.separate { (ctl.v::<ControllerVtbl>().terminate)(ctl.ptr()); }
            }
            self.processor = None;
            if self.initialized { (self.component.v::<ComponentVtbl>().terminate)(self.component.ptr()); }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clap::{describe_json, params_json};

    #[test]
    fn lists_the_tone_and_plays_it() {
        let b = Bundle::own().unwrap();
        assert!(describe_json(&b.plugins()).contains("\"name\":\"Test Tone (VST3)\",\"vendor\":\"RustyBuns\",\"version\":\"0.0.1\",\"features\":[\"instrument\",\"synth\"]"));
        let mut p = Plugin::new(&b, 0, 48000.0).unwrap();
        assert!(params_json(&p.params()).starts_with("[{\"id\":0,\"name\":\"Level\""));
        let peak = |p: &mut Plugin| { let mut out = vec![0f32; 2 * 6000]; assert!(p.render(&mut out, 6000)); out.iter().fold(0f32, |m, x| m.max(x.abs())) };
        assert_eq!(peak(&mut p), 0.0);
        p.note_on(69, 1.0, 0);
        assert!(peak(&mut p) > 0.1);
        p.set_param(0, 0.0);
        assert_eq!(peak(&mut p), 0.0);
        p.set_param(0, 1.0);
        p.set_param(1, 1.0);
        assert!((peak(&mut p) - 0.25).abs() < 1e-5);
        assert_eq!(p.params().iter().map(|q| q.value).collect::<Vec<_>>(), [1.0, 1.0]);
        p.note_off(69, 0);
        assert_eq!(peak(&mut p), 0.0);
    }

    #[test]
    fn ids_read_the_same_on_every_os() {
        assert_eq!(uid_text(&FUNKNOWN), "00000000000000000000C00000000046");
        assert_eq!(uid_text(&IEDIT_CONTROLLER), "DCD7BBE37742448DA874AACC979C759E");
    }

    #[test]
    fn a_missing_file_says_so() {
        assert!(Bundle::open("/nowhere/at-all.vst3").err().unwrap().contains("couldn't load"));
    }
}
