//! A player's own Audio Unit (macOS), the third format behind `hosted` (#5517), hand-written over AudioToolbox like
//! the CLAP and VST3 hosts. An AU isn't a file the host opens: the system keeps the list, so one is named by its
//! type, subtype and manufacturer codes, as `au:aumu:dls :appl`, and that name stands in for a path everywhere a
//! `.clap` or `.vst3` would go (the track menu, a groove, a friend's computer, which has the same codes for the same AU).
//! Instruments (`aumu`), effects (`aufx`) and MIDI-driven effects (`aumf`) are listed; an effect is fed silence, as a
//! CLAP effect is. Started with `AudioComponentInstanceNew`, set to 32-bit float non-interleaved stereo at the desk's
//! rate, played with `MusicDeviceMIDIEvent`, its parameters read through the parameter list and moved with
//! `AudioUnitSetParameter`, and pulled a block at a time with `AudioUnitRender`. Its editor doesn't open here yet.

/// What a path names when it's an AU rather than a file.
pub const SCHEME: &str = "au:";

/// The types listed: instruments, effects and MIDI-driven effects.
pub const TYPES: [u32; 3] = [code(b"aumu"), code(b"aufx"), code(b"aumf")];

pub const fn code(c: &[u8; 4]) -> u32 { u32::from_be_bytes(*c) }

/// A four-char code as text: its four characters when they're plain and colon-free, else `0x` and eight hex digits.
pub fn code_text(c: u32) -> String {
    let b = c.to_be_bytes();
    if b.iter().all(|x| (0x20..0x7f).contains(x) && *x != b':') { b.iter().map(|x| *x as char).collect() } else { format!("0x{c:08X}") }
}

fn parse_code(s: &str) -> Option<u32> {
    match s.len() {
        4 => Some(u32::from_be_bytes(s.as_bytes().try_into().ok()?)),
        10 if s.starts_with("0x") => u32::from_str_radix(&s[2..], 16).ok(),
        _ => None,
    }
}

/// The AU's own id, `type:subtype:manufacturer`: the same on every Mac that has it.
pub fn id_of(kind: u32, sub: u32, maker: u32) -> String { format!("{}:{}:{}", code_text(kind), code_text(sub), code_text(maker)) }

/// The three codes an `au:` name gives, or None when it isn't one.
pub fn parse(path: &str) -> Option<(u32, u32, u32)> {
    let mut it = path.strip_prefix(SCHEME)?.split(':');
    let r = (parse_code(it.next()?)?, parse_code(it.next()?)?, parse_code(it.next()?)?);
    it.next().is_none().then_some(r)
}

#[cfg(target_os = "macos")]
pub use host::*;

#[cfg(target_os = "macos")]
mod host {
    use super::*;
    use crate::clap::{take_changes, Descriptor, Param, MAX_FRAMES};
    use std::ffi::{c_char, c_void};
    use std::sync::Arc;

    type OSStatus = i32;
    type AudioComponent = *mut c_void;
    type AudioUnit = *mut c_void;
    type CFStringRef = *const c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct ComponentDesc { kind: u32, sub: u32, maker: u32, flags: u32, mask: u32 }

    #[repr(C)]
    struct StreamDesc { rate: f64, format: u32, flags: u32, bytes_per_packet: u32, frames_per_packet: u32, bytes_per_frame: u32, channels: u32, bits: u32, reserved: u32 }

    #[repr(C)]
    struct Smpte { subframes: i16, divisor: i16, counter: u32, kind: u32, flags: u32, hours: i16, minutes: i16, seconds: i16, frames: i16 }

    #[repr(C)]
    pub struct TimeStamp { sample_time: f64, host_time: u64, rate_scalar: f64, word_clock: u64, smpte: Smpte, flags: u32, reserved: u32 }

    #[repr(C)]
    pub struct Buffer { channels: u32, bytes: u32, data: *mut c_void }

    /// An AudioBufferList with room for two buffers (left, right).
    #[repr(C)]
    pub struct BufferList { count: u32, buffers: [Buffer; 2] }

    type RenderProc = unsafe extern "C" fn(*mut c_void, *mut u32, *const TimeStamp, u32, u32, *mut BufferList) -> OSStatus;
    #[repr(C)]
    struct RenderCallback { proc_: RenderProc, ctx: *mut c_void }

    #[repr(C)]
    struct ParamInfo {
        name: [c_char; 52], unit_name: CFStringRef, clump: u32, cf_name: CFStringRef, unit: u32,
        min: f32, max: f32, default: f32, flags: u32,
    }

    #[link(name = "AudioToolbox", kind = "framework")]
    extern "C" {
        fn AudioComponentFindNext(after: AudioComponent, desc: *const ComponentDesc) -> AudioComponent;
        fn AudioComponentGetDescription(c: AudioComponent, desc: *mut ComponentDesc) -> OSStatus;
        fn AudioComponentCopyName(c: AudioComponent, name: *mut CFStringRef) -> OSStatus;
        fn AudioComponentGetVersion(c: AudioComponent, version: *mut u32) -> OSStatus;
        fn AudioComponentInstanceNew(c: AudioComponent, out: *mut AudioUnit) -> OSStatus;
        fn AudioComponentInstanceDispose(u: AudioUnit) -> OSStatus;
        fn AudioUnitInitialize(u: AudioUnit) -> OSStatus;
        fn AudioUnitUninitialize(u: AudioUnit) -> OSStatus;
        fn AudioUnitGetPropertyInfo(u: AudioUnit, id: u32, scope: u32, elem: u32, size: *mut u32, writable: *mut u8) -> OSStatus;
        fn AudioUnitGetProperty(u: AudioUnit, id: u32, scope: u32, elem: u32, data: *mut c_void, size: *mut u32) -> OSStatus;
        fn AudioUnitSetProperty(u: AudioUnit, id: u32, scope: u32, elem: u32, data: *const c_void, size: u32) -> OSStatus;
        fn AudioUnitGetParameter(u: AudioUnit, id: u32, scope: u32, elem: u32, value: *mut f32) -> OSStatus;
        fn AudioUnitSetParameter(u: AudioUnit, id: u32, scope: u32, elem: u32, value: f32, offset: u32) -> OSStatus;
        fn AudioUnitRender(u: AudioUnit, flags: *mut u32, at: *const TimeStamp, bus: u32, frames: u32, data: *mut BufferList) -> OSStatus;
        fn MusicDeviceMIDIEvent(u: AudioUnit, status: u32, data1: u32, data2: u32, offset: u32) -> OSStatus;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringGetCString(s: CFStringRef, buf: *mut c_char, size: isize, encoding: u32) -> u8;
        fn CFRelease(o: *const c_void);
    }

    const UTF8: u32 = 0x0800_0100;
    const PROP_SAMPLE_RATE: u32 = 2;
    const PROP_PARAMETER_LIST: u32 = 3;
    const PROP_PARAMETER_INFO: u32 = 4;
    const PROP_STREAM_FORMAT: u32 = 8;
    const PROP_ELEMENT_COUNT: u32 = 11;
    const PROP_MAX_FRAMES: u32 = 14;
    const PROP_RENDER_CALLBACK: u32 = 23;
    const GLOBAL: u32 = 0;
    const INPUT: u32 = 1;
    const OUTPUT: u32 = 2;
    const LPCM: u32 = code(b"lpcm");
    const FLOAT: u32 = 1;
    const PACKED: u32 = 1 << 3;
    const NON_INTERLEAVED: u32 = 1 << 5;
    const SAMPLE_TIME_VALID: u32 = 1;
    const PARAM_CF_NAME_RELEASE: u32 = 1 << 4;
    const PARAM_HAS_CF_NAME: u32 = 1 << 27;
    const PARAM_WRITABLE: u32 = 1 << 31;
    const UNIT_INDEXED: u32 = 1;
    const UNIT_BOOLEAN: u32 = 2;

    unsafe fn cf_text(s: CFStringRef) -> String {
        if s.is_null() { return String::new(); }
        let mut buf = [0 as c_char; 512];
        if CFStringGetCString(s, buf.as_mut_ptr(), buf.len() as isize, UTF8) == 0 { return String::new(); }
        std::ffi::CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned()
    }

    fn describe(c: AudioComponent) -> Option<Descriptor> {
        unsafe {
            let mut d = ComponentDesc::default();
            if AudioComponentGetDescription(c, &mut d) != 0 { return None; }
            let mut name: CFStringRef = std::ptr::null();
            let full = if AudioComponentCopyName(c, &mut name) == 0 && !name.is_null() { let t = cf_text(name); CFRelease(name); t } else { String::new() };
            // an AU's name is "Maker: Plugin"
            let (vendor, name) = match full.split_once(": ") { Some((v, n)) => (v.to_string(), n.to_string()), None => (String::new(), full) };
            let name = if name.is_empty() { code_text(d.sub) } else { name };
            let mut v = 0u32;
            let version = if AudioComponentGetVersion(c, &mut v) == 0 { format!("{}.{}.{}", v >> 16, (v >> 8) & 0xff, v & 0xff) } else { String::new() };
            let features = match d.kind { k if k == code(b"aumu") => vec!["instrument".into()], k if k == code(b"aumf") => vec!["audio-effect".into(), "note-effect".into()], _ => vec!["audio-effect".into()] };
            Some(Descriptor { id: id_of(d.kind, d.sub, d.maker), name, vendor, version, features })
        }
    }

    /// Every AU of the listed types the system knows, by its `au:` name, each once.
    pub fn names() -> Vec<String> {
        let mut out = Vec::new();
        for kind in TYPES {
            let want = ComponentDesc { kind, ..Default::default() };
            let mut c: AudioComponent = std::ptr::null_mut();
            for _ in 0..4096 {
                c = unsafe { AudioComponentFindNext(c, &want) };
                if c.is_null() { break; }
                let mut d = ComponentDesc::default();
                if unsafe { AudioComponentGetDescription(c, &mut d) } != 0 { continue; }
                let name = format!("{SCHEME}{}", id_of(d.kind, d.sub, d.maker));
                if !out.contains(&name) { out.push(name); }
            }
        }
        out
    }

    /// One AU, found by its codes. The system keeps the component; nothing to unload.
    pub struct Bundle { component: AudioComponent, kind: u32, desc: Descriptor }

    // An AudioComponent is a handle the system keeps for the life of the process.
    unsafe impl Send for Bundle {}
    unsafe impl Sync for Bundle {}

    impl Bundle {
        /// Finds the AU an `au:` name gives: `Err` says why not, for the track menu.
        pub fn open(path: &str) -> Result<Arc<Bundle>, String> {
            let (kind, sub, maker) = parse(path).ok_or_else(|| format!("{path} isn't an Audio Unit name (au:type:subtype:maker)"))?;
            let want = ComponentDesc { kind, sub, maker, flags: 0, mask: 0 };
            let component = unsafe { AudioComponentFindNext(std::ptr::null_mut(), &want) };
            if component.is_null() { return Err(format!("no Audio Unit {} on this Mac", id_of(kind, sub, maker))); }
            let desc = describe(component).ok_or_else(|| format!("{path} wouldn't say what it is"))?;
            Ok(Arc::new(Bundle { component, kind, desc }))
        }

        pub fn plugins(&self) -> Vec<Descriptor> {
            let d = &self.desc;
            vec![Descriptor { id: d.id.clone(), name: d.name.clone(), vendor: d.vendor.clone(), version: d.version.clone(), features: d.features.clone() }]
        }
    }

    /// What the host keeps of a parameter: its range, to clamp the slider's moves.
    struct Range { id: u32, min: f64, max: f64 }

    /// A running Audio Unit.
    pub struct Plugin {
        name: String,
        unit: AudioUnit,
        takes_notes: bool,
        initialized: bool,
        broken: bool,
        ranges: Vec<Range>,
        changes: Vec<(u32, f64)>,
        left: Vec<f32>,
        right: Vec<f32>,
        time: f64,
        _bundle: Arc<Bundle>,
    }

    /// An effect's input: silence, as a CLAP or VST3 effect on a plugin track gets.
    unsafe extern "C" fn silence(_: *mut c_void, flags: *mut u32, _: *const TimeStamp, _: u32, _: u32, data: *mut BufferList) -> OSStatus {
        if let Some(list) = data.as_mut() {
            let bufs = std::slice::from_raw_parts_mut(list.buffers.as_mut_ptr(), list.count as usize);
            for b in bufs { if !b.data.is_null() { std::ptr::write_bytes(b.data as *mut u8, 0, b.bytes as usize); } }
        }
        if let Some(f) = flags.as_mut() { *f |= 1 << 4; } // kAudioUnitRenderAction_OutputIsSilence
        0
    }

    fn stereo(rate: f64) -> StreamDesc {
        StreamDesc { rate, format: LPCM, flags: FLOAT | PACKED | NON_INTERLEAVED, bytes_per_packet: 4, frames_per_packet: 1, bytes_per_frame: 4, channels: 2, bits: 32, reserved: 0 }
    }

    impl Plugin {
        /// Starts the AU (`index` 0: an `au:` name holds one) at `sample_rate`.
        pub fn new(bundle: &Arc<Bundle>, index: u32, sample_rate: f64) -> Result<Plugin, String> {
            if index != 0 { return Err("no plugin at that index".into()); }
            let name = bundle.desc.name.clone();
            let mut unit: AudioUnit = std::ptr::null_mut();
            let s = unsafe { AudioComponentInstanceNew(bundle.component, &mut unit) };
            if s != 0 || unit.is_null() { return Err(format!("{name} couldn't be made (error {s})")); }
            let mut p = Plugin {
                name, unit, takes_notes: bundle.kind != code(b"aufx"), initialized: false, broken: false, ranges: Vec::new(),
                changes: Vec::new(), left: vec![0.0; MAX_FRAMES], right: vec![0.0; MAX_FRAMES], time: 0.0, _bundle: bundle.clone(),
            };
            unsafe {
                let fmt = stereo(sample_rate);
                let size = std::mem::size_of::<StreamDesc>() as u32;
                let s = AudioUnitSetProperty(unit, PROP_STREAM_FORMAT, OUTPUT, 0, &fmt as *const _ as *const c_void, size);
                if s != 0 { return Err(format!("{} won't play 32-bit stereo at {sample_rate} Hz (error {s})", p.name)); }
                AudioUnitSetProperty(unit, PROP_SAMPLE_RATE, OUTPUT, 0, &sample_rate as *const f64 as *const c_void, 8);
                let max = MAX_FRAMES as u32;
                AudioUnitSetProperty(unit, PROP_MAX_FRAMES, GLOBAL, 0, &max as *const u32 as *const c_void, 4);
                // an effect pulls its input: hand it silence at the same format
                let (mut inputs, mut n) = (0u32, 4u32);
                if AudioUnitGetProperty(unit, PROP_ELEMENT_COUNT, INPUT, 0, &mut inputs as *mut u32 as *mut c_void, &mut n) == 0 && inputs > 0 {
                    AudioUnitSetProperty(unit, PROP_STREAM_FORMAT, INPUT, 0, &fmt as *const _ as *const c_void, size);
                    let cb = RenderCallback { proc_: silence, ctx: std::ptr::null_mut() };
                    AudioUnitSetProperty(unit, PROP_RENDER_CALLBACK, INPUT, 0, &cb as *const _ as *const c_void, std::mem::size_of::<RenderCallback>() as u32);
                }
                let s = AudioUnitInitialize(unit);
                if s != 0 { return Err(format!("{} wouldn't start (error {s})", p.name)); }
                p.initialized = true;
            }
            p.ranges = p.infos().into_iter().map(|(id, i)| Range { id, min: i.min as f64, max: i.max as f64 }).collect();
            Ok(p)
        }

        /// Every parameter it lists on the global scope, with what it says of each.
        fn infos(&self) -> Vec<(u32, ParamInfo)> {
            unsafe {
                let (mut size, mut w) = (0u32, 0u8);
                if AudioUnitGetPropertyInfo(self.unit, PROP_PARAMETER_LIST, GLOBAL, 0, &mut size, &mut w) != 0 || size == 0 { return vec![]; }
                let mut ids = vec![0u32; (size as usize / 4).min(4096)];
                let mut got = (ids.len() * 4) as u32;
                if AudioUnitGetProperty(self.unit, PROP_PARAMETER_LIST, GLOBAL, 0, ids.as_mut_ptr() as *mut c_void, &mut got) != 0 { return vec![]; }
                ids.truncate(got as usize / 4);
                ids.into_iter().filter_map(|id| {
                    let mut info: ParamInfo = std::mem::zeroed();
                    let mut n = std::mem::size_of::<ParamInfo>() as u32;
                    (AudioUnitGetProperty(self.unit, PROP_PARAMETER_INFO, GLOBAL, id, &mut info as *mut ParamInfo as *mut c_void, &mut n) == 0).then_some((id, info))
                }).collect()
            }
        }

        fn midi(&mut self, status: u32, key: u32, vel: u32) {
            if !self.takes_notes || self.broken { return; }
            unsafe { MusicDeviceMIDIEvent(self.unit, status, key.min(127), vel.min(127), 0); }
        }
        pub fn note_on(&mut self, key: u32, velocity: f64, channel: u32) {
            let v = (velocity.clamp(0.0, 1.0) * 127.0).round().max(1.0) as u32;
            self.midi(0x90 | (channel & 15), key, v)
        }
        pub fn note_off(&mut self, key: u32, channel: u32) { self.midi(0x80 | (channel & 15), key, 0) }

        /// Moves parameter `id` to `value`, in the parameter's own range (as `params` reports it).
        pub fn set_param(&mut self, id: u32, value: f64) {
            if !value.is_finite() { return; }
            let Some(r) = self.ranges.iter().find(|r| r.id == id) else { return };
            let v = if r.min <= r.max { value.clamp(r.min, r.max) } else { value };
            unsafe { AudioUnitSetParameter(self.unit, id, GLOBAL, 0, v as f32, 0); }
        }

        /// The parameters a player may move, with their values now.
        pub fn params(&self) -> Vec<Param> {
            self.infos().into_iter().filter(|(_, i)| i.flags & PARAM_WRITABLE != 0).map(|(id, i)| {
                let name = unsafe {
                    if i.flags & PARAM_HAS_CF_NAME != 0 && !i.cf_name.is_null() {
                        let t = cf_text(i.cf_name);
                        if i.flags & PARAM_CF_NAME_RELEASE != 0 { CFRelease(i.cf_name); }
                        t
                    } else { std::ffi::CStr::from_ptr(i.name.as_ptr()).to_string_lossy().into_owned() }
                };
                let mut v = i.default;
                unsafe { AudioUnitGetParameter(self.unit, id, GLOBAL, 0, &mut v); }
                let num = |x: f32| if x.is_finite() { x as f64 } else { 0.0 };
                Param {
                    id, name: if name.is_empty() { format!("Parameter {id}") } else { name }, module: String::new(),
                    min: num(i.min), max: num(i.max), default: num(i.default), value: num(v), stepped: i.unit == UNIT_INDEXED || i.unit == UNIT_BOOLEAN,
                }
            }).collect()
        }

        /// Pulls `frames` from the AU and adds them into `out` (interleaved stereo). False once it has failed: it
        /// stays silent from then on.
        pub fn render(&mut self, out: &mut [f32], frames: usize) -> bool {
            let frames = frames.min(out.len() / 2);
            if self.broken { return false; }
            let mut done = 0;
            while done < frames {
                let n = (frames - done).min(MAX_FRAMES);
                self.left[..n].fill(0.0);
                self.right[..n].fill(0.0);
                let bytes = (n * 4) as u32;
                let mut list = BufferList { count: 2, buffers: [
                    Buffer { channels: 1, bytes, data: self.left.as_mut_ptr() as *mut c_void },
                    Buffer { channels: 1, bytes, data: self.right.as_mut_ptr() as *mut c_void },
                ] };
                let at = TimeStamp {
                    sample_time: self.time, host_time: 0, rate_scalar: 0.0, word_clock: 0,
                    smpte: Smpte { subframes: 0, divisor: 0, counter: 0, kind: 0, flags: 0, hours: 0, minutes: 0, seconds: 0, frames: 0 },
                    flags: SAMPLE_TIME_VALID, reserved: 0,
                };
                let mut flags = 0u32;
                let s = unsafe { AudioUnitRender(self.unit, &mut flags, &at, 0, n as u32, &mut list) };
                if s != 0 { self.broken = true; return false; }
                self.time += n as f64;
                // a unit may hand back its own buffers rather than fill ours
                let side = |b: &Buffer, own: &[f32]| -> *const f32 { if b.data.is_null() { own.as_ptr() } else { b.data as *const f32 } };
                let (l, r) = unsafe {
                    (std::slice::from_raw_parts(side(&list.buffers[0], &self.left), n), std::slice::from_raw_parts(side(&list.buffers[1], &self.right), n))
                };
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

        /// Parameter moves it made itself: none yet (they come from its editor, which doesn't open here yet).
        pub fn take_changes(&mut self, cap: usize) -> String { take_changes(&mut self.changes, cap) }

        pub fn name(&self) -> &str { &self.name }
    }

    impl Drop for Plugin {
        fn drop(&mut self) {
            unsafe {
                if self.initialized { AudioUnitUninitialize(self.unit); }
                AudioComponentInstanceDispose(self.unit);
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        const DLS: &str = "au:aumu:dls :appl";

        #[test]
        fn lists_apples_synth_and_plays_it() {
            assert!(names().iter().any(|n| n == DLS), "every Mac has Apple's DLS synth");
            let b = Bundle::open(DLS).unwrap();
            let d = &b.plugins()[0];
            assert_eq!((d.id.as_str(), d.vendor.as_str(), d.features.clone()), ("aumu:dls :appl", "Apple", vec!["instrument".to_string()]));
            let mut p = Plugin::new(&b, 0, 48000.0).unwrap();
            let peak = |p: &mut Plugin| { let mut out = vec![0f32; 2 * 9600]; assert!(p.render(&mut out, 9600)); out.iter().fold(0f32, |m, x| m.max(x.abs())) };
            assert_eq!(peak(&mut p), 0.0);
            p.note_on(60, 1.0, 0);
            assert!(peak(&mut p) > 0.01);
            let params = p.params();
            assert!(!params.is_empty());
            let q = &params[0];
            p.set_param(q.id, q.min);
            assert_eq!(p.params()[0].value, q.min);
            assert!(Plugin::new(&b, 1, 48000.0).is_err());
        }

        #[test]
        fn an_effect_is_fed_silence_and_renders() {
            let b = Bundle::open("au:aufx:dely:appl").unwrap();
            let mut p = Plugin::new(&b, 0, 44100.0).unwrap();
            let mut out = vec![0f32; 2 * 512];
            assert!(p.render(&mut out, 512));
            assert!(out.iter().all(|x| *x == 0.0));
        }

        #[test]
        fn one_not_on_this_mac_says_so() {
            assert!(Bundle::open("au:aumu:nope:nope").err().unwrap().contains("no Audio Unit aumu:nope:nope"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_read_back_as_their_codes() {
        let odd = u32::from_be_bytes([b'a', b':', 0, 200]);
        let name = format!("{SCHEME}{}", id_of(code(b"aumu"), code(b"dls "), odd));
        assert_eq!(name, "au:aumu:dls :0x613A00C8");
        assert_eq!(parse(&name), Some((code(b"aumu"), code(b"dls "), odd)));
        for bad in ["aumu:dls :appl", "au:aumu:dls", "au:aumu:dls :appl:x", "au:aumu:toolong:appl"] { assert_eq!(parse(bad), None, "{bad}"); }
    }
}
