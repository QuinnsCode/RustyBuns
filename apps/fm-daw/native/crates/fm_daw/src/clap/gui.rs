//! A hosted plugin's own editor, as a native window beside the webview (#5267).
//!
//! CLAP's `clap.gui` lets a plugin either open a window of its own (floating) or draw into a view the host gives it
//! (embedded). A plugin that floats is asked to; one that only embeds gets a plain window of ours, sized to it, with
//! its view inside (macOS for now: the desktop's page is a browser window, so there is no native parent to hang it
//! off). The host side (`clap.host.gui`, `clap.host.params`) records what the plugin asks for, and [`Plugin::pump`],
//! called on the main thread a few dozen times a second while an editor is open, acts on it and runs the window's
//! events. Knobs turned in the editor come back as the plugin's output events ([`Plugin::take_changes`]).

use super::*;

pub const EXT_GUI: &CStr = c"clap.gui";
pub const HOST_GUI: &CStr = c"clap.host.gui";
pub const HOST_PARAMS: &CStr = c"clap.host.params";

#[cfg(target_os = "macos")]
pub const API: &CStr = c"cocoa";
#[cfg(windows)]
pub const API: &CStr = c"win32";
#[cfg(not(any(target_os = "macos", windows)))]
pub const API: &CStr = c"x11";

/// A native window handle: an `NSView*`, an `HWND` or an X11 window, all pointer sized here.
#[repr(C)]
pub struct ClapWindow { pub api: *const c_char, pub handle: *mut c_void }

#[repr(C)]
pub struct ClapPluginGui {
    pub is_api_supported: unsafe extern "C" fn(p: *const ClapPlugin, api: *const c_char, is_floating: bool) -> bool,
    pub get_preferred_api: unsafe extern "C" fn(p: *const ClapPlugin, api: *mut *const c_char, is_floating: *mut bool) -> bool,
    pub create: unsafe extern "C" fn(p: *const ClapPlugin, api: *const c_char, is_floating: bool) -> bool,
    pub destroy: unsafe extern "C" fn(p: *const ClapPlugin),
    pub set_scale: unsafe extern "C" fn(p: *const ClapPlugin, scale: f64) -> bool,
    pub get_size: unsafe extern "C" fn(p: *const ClapPlugin, width: *mut u32, height: *mut u32) -> bool,
    pub can_resize: unsafe extern "C" fn(p: *const ClapPlugin) -> bool,
    pub get_resize_hints: unsafe extern "C" fn(p: *const ClapPlugin, hints: *mut c_void) -> bool,
    pub adjust_size: unsafe extern "C" fn(p: *const ClapPlugin, width: *mut u32, height: *mut u32) -> bool,
    pub set_size: unsafe extern "C" fn(p: *const ClapPlugin, width: u32, height: u32) -> bool,
    pub set_parent: unsafe extern "C" fn(p: *const ClapPlugin, window: *const ClapWindow) -> bool,
    pub set_transient: unsafe extern "C" fn(p: *const ClapPlugin, window: *const ClapWindow) -> bool,
    pub suggest_title: unsafe extern "C" fn(p: *const ClapPlugin, title: *const c_char),
    pub show: unsafe extern "C" fn(p: *const ClapPlugin) -> bool,
    pub hide: unsafe extern "C" fn(p: *const ClapPlugin) -> bool,
}

#[repr(C)]
pub struct ClapHostGui {
    pub resize_hints_changed: unsafe extern "C" fn(h: *const ClapHost),
    pub request_resize: unsafe extern "C" fn(h: *const ClapHost, width: u32, height: u32) -> bool,
    pub request_show: unsafe extern "C" fn(h: *const ClapHost) -> bool,
    pub request_hide: unsafe extern "C" fn(h: *const ClapHost) -> bool,
    pub closed: unsafe extern "C" fn(h: *const ClapHost, was_destroyed: bool),
}

#[repr(C)]
pub struct ClapHostParams {
    pub rescan: unsafe extern "C" fn(h: *const ClapHost, flags: u32),
    pub clear: unsafe extern "C" fn(h: *const ClapHost, id: u32, flags: u32),
    pub request_flush: unsafe extern "C" fn(h: *const ClapHost),
}

unsafe extern "C" fn hints_changed(_: *const ClapHost) {}
unsafe extern "C" fn request_resize(h: *const ClapHost, w: u32, ht: u32) -> bool {
    let Some(s) = state(h) else { return false };
    if w == 0 || ht == 0 { return false; }
    s.resize.store(((w as u64) << 32) | ht as u64, Ordering::Release);
    true
}
unsafe extern "C" fn request_show_hide(_: *const ClapHost) -> bool { false }
unsafe extern "C" fn closed(h: *const ClapHost, _: bool) { if let Some(s) = state(h) { s.closed.store(true, Ordering::Release); } }
unsafe extern "C" fn rescan(_: *const ClapHost, _: u32) {}
unsafe extern "C" fn clear(_: *const ClapHost, _: u32, _: u32) {}
unsafe extern "C" fn request_flush(h: *const ClapHost) { if let Some(s) = state(h) { s.flush.store(true, Ordering::Release); } }

pub static HOST_GUI_EXT: ClapHostGui = ClapHostGui {
    resize_hints_changed: hints_changed, request_resize, request_show: request_show_hide, request_hide: request_show_hide, closed,
};
pub static HOST_PARAMS_EXT: ClapHostParams = ClapHostParams { rescan, clear, request_flush };

/// How a plugin's editor opens here.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// In a window of its own.
    Floating,
    /// Inside a window of ours.
    Window,
}

/// An open editor: the plugin's gui made, and our window when it embeds.
pub struct Editor {
    window: Option<window::Window>,
}

impl Plugin {
    /// How this plugin's editor would open here; None when it has none (or only one we can't hold yet).
    pub fn editor_kind(&self) -> Option<Kind> {
        if self.gui.is_null() { return None; }
        let g = unsafe { &*self.gui };
        unsafe {
            if (g.is_api_supported)(self.plugin, API.as_ptr(), true) { return Some(Kind::Floating); }
            if window::CAN && (g.is_api_supported)(self.plugin, API.as_ptr(), false) { return Some(Kind::Window); }
        }
        None
    }

    pub fn editor_open(&self) -> bool { self.editor.is_some() }

    /// Opens the editor titled `title` (or brings it forward if it's open); `Err` says why it won't.
    pub fn open_editor(&mut self, title: &str) -> Result<(), String> {
        if let Some(e) = &self.editor {
            if let Some(w) = &e.window { w.show(); }
            unsafe { ((*self.gui).show)(self.plugin); }
            return Ok(());
        }
        let Some(kind) = self.editor_kind() else {
            return Err(if self.gui.is_null() { format!("{} has no editor of its own", self.name) }
                       else { format!("{}'s editor only opens inside a host window, which FM DAW makes on macOS for now", self.name) });
        };
        if !window::on_main_thread() { return Err("an editor opens from the app's main thread".into()); }
        let g = unsafe { &*self.gui };
        let p = self.plugin;
        let ctitle = CString::new(title.replace('\0', "")).unwrap_or_default();
        self.host_state.closed.store(false, Ordering::Release);
        self.host_state.resize.store(0, Ordering::Release);
        unsafe {
            if !(g.create)(p, API.as_ptr(), kind == Kind::Floating) { return Err(format!("{}'s editor couldn't be made", self.name)); }
            let window = if kind == Kind::Window {
                let (mut w, mut h) = (0u32, 0u32);
                if !(g.get_size)(p, &mut w, &mut h) || w == 0 || h == 0 { (w, h) = (640, 400); }
                let Some(win) = window::Window::new(&ctitle, w.min(8192), h.min(8192), (g.can_resize)(p)) else {
                    (g.destroy)(p);
                    return Err("couldn't make a window for the editor".into());
                };
                let parent = ClapWindow { api: API.as_ptr(), handle: win.view() };
                if !(g.set_parent)(p, &parent) { (g.destroy)(p); return Err(format!("{}'s editor wouldn't go in its window", self.name)); }
                win.show();
                Some(win)
            } else {
                (g.suggest_title)(p, ctitle.as_ptr());
                None
            };
            if !(g.show)(p) { (g.destroy)(p); return Err(format!("{}'s editor wouldn't show", self.name)); }
            self.editor = Some(Editor { window });
        }
        Ok(())
    }

    /// Closes the editor, if open: its gui destroyed, then our window.
    pub fn close_editor(&mut self) {
        let Some(e) = self.editor.take() else { return };
        unsafe {
            ((*self.gui).hide)(self.plugin);
            ((*self.gui).destroy)(self.plugin);
        }
        drop(e);
        self.host_state.closed.store(false, Ordering::Release);
    }

    /// Acts on what the plugin asked for and runs its window's events. Main thread only. True while the editor is open.
    pub fn pump(&mut self) -> bool {
        if self.editor.as_ref().is_some_and(|e| e.window.is_some()) { window::pump_events(); }
        unsafe {
            if self.host_state.callback.swap(false, Ordering::AcqRel) { ((*self.plugin).on_main_thread)(self.plugin); }
            if self.host_state.flush.swap(false, Ordering::AcqRel) && !self.processing && !self.params.is_null() {
                let none: Vec<Event> = Vec::new();
                let inp = ClapInputEvents { ctx: &none as *const Vec<Event> as *mut c_void, size: in_size, get: in_get };
                let out = ClapOutputEvents { ctx: &mut self.changes as *mut Vec<(u32, f64)> as *mut c_void, try_push: out_push };
                ((*self.params).flush)(self.plugin, &inp, &out);
            }
        }
        let Some(e) = &self.editor else { return false };
        // the plugin says its editor went (a floating window closed), or the player closed our window
        let gone = self.host_state.closed.load(Ordering::Acquire) || e.window.as_ref().is_some_and(|w| !w.visible());
        if gone { self.close_editor(); return false; }
        let Some(e) = &self.editor else { return false };
        let size = self.host_state.resize.swap(0, Ordering::AcqRel);
        if size != 0 {
            if let Some(w) = &e.window { w.set_size((size >> 32) as u32, size as u32); }
            unsafe { ((*self.gui).set_size)(self.plugin, (size >> 32) as u32, size as u32); }
        }
        true
    }

    /// The parameter moves the plugin made itself since the last call (last value per parameter), as
    /// `[{"id","value"}]`. Kept until they fit `cap` bytes, so a caller whose buffer was short asks again.
    pub fn take_changes(&mut self, cap: usize) -> String { take_changes(&mut self.changes, cap) }
}

/// Our window for an editor that embeds. Hand-written over the Objective-C runtime (the engine keeps no dependencies),
/// and AppKit is loaded only when the first window is made.
#[cfg(target_os = "macos")]
mod window {
    use std::ffi::{c_char, c_int, c_void, CStr};
    use std::sync::OnceLock;

    pub const CAN: bool = true;
    type Id = *mut c_void;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Size { w: f64, h: f64 }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect { x: f64, y: f64, size: Size }

    #[link(name = "objc")]
    extern "C" {
        fn objc_getClass(name: *const c_char) -> Id;
        fn sel_registerName(name: *const c_char) -> Id;
        fn objc_msgSend();
    }
    extern "C" { fn pthread_main_np() -> c_int; }

    /// (`cargo test` runs on worker threads, and its pretend editor makes no window.)
    pub fn on_main_thread() -> bool { cfg!(test) || unsafe { pthread_main_np() == 1 } }

    unsafe fn sel(n: &CStr) -> Id { sel_registerName(n.as_ptr()) }
    unsafe fn cls(n: &CStr) -> Id { objc_getClass(n.as_ptr()) }
    macro_rules! send {
        ($obj:expr, $sel:literal $(, $arg:expr => $ty:ty)* ; $ret:ty) => {{
            let f: unsafe extern "C" fn(Id, Id $(, $ty)*) -> $ret = std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
            f($obj, sel($sel) $(, $arg)*)
        }};
    }

    /// NSApplication, started once: AppKit loaded, an accessory app (no Dock icon) unless it's already a real one.
    fn app() -> Option<Id> {
        static APP: OnceLock<usize> = OnceLock::new();
        let a = *APP.get_or_init(|| unsafe {
            if super::super::dl::open(c"/System/Library/Frameworks/AppKit.framework/AppKit").is_null() { return 0; }
            let c = cls(c"NSApplication");
            if c.is_null() { return 0; }
            let app: Id = send!(c, c"sharedApplication"; Id);
            let policy: isize = send!(app, c"activationPolicy"; isize);
            if policy == 2 { let _: bool = send!(app, c"setActivationPolicy:", 1isize => isize; bool); }
            let _: () = send!(app, c"finishLaunching"; ());
            app as usize
        });
        (a != 0).then_some(a as Id)
    }

    pub struct Window { win: Id }

    impl Window {
        pub fn new(title: &CStr, w: u32, h: u32, resizable: bool) -> Option<Window> {
            app()?;
            unsafe {
                let rect = Rect { x: 0.0, y: 0.0, size: Size { w: w as f64, h: h as f64 } };
                // titled | closable | miniaturizable, plus resizable
                let style: usize = 1 | 2 | 4 | if resizable { 8 } else { 0 };
                let alloc: Id = send!(cls(c"NSWindow"), c"alloc"; Id);
                let win: Id = send!(alloc, c"initWithContentRect:styleMask:backing:defer:", rect => Rect, style => usize, 2usize => usize, false => bool; Id);
                if win.is_null() { return None; }
                let _: () = send!(win, c"setReleasedWhenClosed:", false => bool; ());
                let s: Id = send!(cls(c"NSString"), c"alloc"; Id);
                let s: Id = send!(s, c"initWithUTF8String:", title.as_ptr() => *const c_char; Id);
                if !s.is_null() { let _: () = send!(win, c"setTitle:", s => Id; ()); let _: () = send!(s, c"release"; ()); }
                let _: () = send!(win, c"center"; ());
                Some(Window { win })
            }
        }
        pub fn view(&self) -> *mut c_void { unsafe { send!(self.win, c"contentView"; Id) } }
        pub fn show(&self) {
            unsafe {
                let _: () = send!(self.win, c"makeKeyAndOrderFront:", std::ptr::null_mut::<c_void>() => Id; ());
                if let Some(app) = app() { let _: () = send!(app, c"activateIgnoringOtherApps:", true => bool; ()); }
            }
        }
        pub fn visible(&self) -> bool { unsafe { send!(self.win, c"isVisible"; bool) } }
        pub fn set_size(&self, w: u32, h: u32) {
            unsafe { let _: () = send!(self.win, c"setContentSize:", Size { w: w as f64, h: h as f64 } => Size; ()); }
        }
    }

    impl Drop for Window {
        fn drop(&mut self) {
            unsafe {
                let _: () = send!(self.win, c"close"; ());
                let _: () = send!(self.win, c"release"; ());
            }
        }
    }

    /// AppKit's `NSDefaultRunLoopMode` string.
    fn default_mode() -> Option<Id> {
        static MODE: OnceLock<usize> = OnceLock::new();
        let m = *MODE.get_or_init(|| unsafe {
            let lib = super::super::dl::open(c"/System/Library/Frameworks/Foundation.framework/Foundation");
            let p = if lib.is_null() { std::ptr::null_mut() } else { super::super::dl::sym(lib, c"NSDefaultRunLoopMode") };
            if p.is_null() { 0 } else { *(p as *const usize) }
        });
        (m != 0).then_some(m as Id)
    }

    /// Hands the window events waiting now to AppKit (the app's own loop is Bun's, so nobody else does).
    pub fn pump_events() {
        let Some(app) = app() else { return };
        unsafe {
            let past: Id = send!(cls(c"NSDate"), c"distantPast"; Id);
            let Some(mode) = default_mode() else { return };
            for _ in 0..256 {
                let ev: Id = send!(app, c"nextEventMatchingMask:untilDate:inMode:dequeue:", u64::MAX => u64, past => Id, mode => Id, true => bool; Id);
                if ev.is_null() { break; }
                let _: () = send!(app, c"sendEvent:", ev => Id; ());
            }
            let _: () = send!(app, c"updateWindows"; ());
        }
    }
}

/// No window of ours here yet: only plugins that float open an editor.
#[cfg(not(target_os = "macos"))]
mod window {
    use std::ffi::{c_void, CStr};
    pub const CAN: bool = false;
    pub fn on_main_thread() -> bool { true }
    pub fn pump_events() {}
    pub struct Window;
    impl Window {
        pub fn new(_: &CStr, _: u32, _: u32, _: bool) -> Option<Window> { None }
        pub fn view(&self) -> *mut c_void { std::ptr::null_mut() }
        pub fn show(&self) {}
        pub fn visible(&self) -> bool { false }
        pub fn set_size(&self, _: u32, _: u32) {}
    }
}

#[cfg(test)]
mod tests {
    //! Test Tone with a pretend floating editor swapped in: it records what the host asked, turns a knob when told
    //! to (as a player would in a real editor), and closes itself, all without a screen.
    use super::*;
    use std::sync::atomic::AtomicU32;
    use std::sync::Mutex;

    static LOCK: Mutex<()> = Mutex::new(());
    static CALLS: Mutex<Vec<&'static str>> = Mutex::new(Vec::new());
    static HOST: AtomicU64 = AtomicU64::new(0);
    /// A knob turn waiting for the next block: (parameter id + 1) << 32 | value * 1000.
    static TURN: AtomicU64 = AtomicU64::new(0);
    static FLUSHES: AtomicU32 = AtomicU32::new(0);

    fn call(c: &'static str) { CALLS.lock().unwrap().push(c); }
    unsafe extern "C" fn supported(_: *const ClapPlugin, api: *const c_char, floating: bool) -> bool { floating && CStr::from_ptr(api) == API }
    unsafe extern "C" fn preferred(_: *const ClapPlugin, _: *mut *const c_char, _: *mut bool) -> bool { false }
    unsafe extern "C" fn create(_: *const ClapPlugin, _: *const c_char, floating: bool) -> bool { call(if floating { "create floating" } else { "create" }); true }
    unsafe extern "C" fn destroy(_: *const ClapPlugin) { call("destroy") }
    unsafe extern "C" fn scale(_: *const ClapPlugin, _: f64) -> bool { true }
    unsafe extern "C" fn size(_: *const ClapPlugin, w: *mut u32, h: *mut u32) -> bool { *w = 300; *h = 200; true }
    unsafe extern "C" fn no(_: *const ClapPlugin) -> bool { false }
    unsafe extern "C" fn hints(_: *const ClapPlugin, _: *mut c_void) -> bool { false }
    unsafe extern "C" fn adjust(_: *const ClapPlugin, _: *mut u32, _: *mut u32) -> bool { false }
    unsafe extern "C" fn set_size(_: *const ClapPlugin, _: u32, _: u32) -> bool { true }
    unsafe extern "C" fn window(_: *const ClapPlugin, _: *const ClapWindow) -> bool { true }
    unsafe extern "C" fn title(_: *const ClapPlugin, t: *const c_char) { assert_eq!(CStr::from_ptr(t), c"Test Tone, track 2"); call("title") }
    unsafe extern "C" fn show(_: *const ClapPlugin) -> bool { call("show"); true }
    unsafe extern "C" fn hide(_: *const ClapPlugin) -> bool { call("hide"); true }

    static GUI: ClapPluginGui = ClapPluginGui {
        is_api_supported: supported, get_preferred_api: preferred, create, destroy, set_scale: scale, get_size: size,
        can_resize: no, get_resize_hints: hints, adjust_size: adjust, set_size, set_parent: window, set_transient: window,
        suggest_title: title, show, hide,
    };

    /// The editor's knob turns go out with the block, as a real plugin's do.
    unsafe extern "C" fn process(_: *const ClapPlugin, pr: *const ClapProcess) -> i32 {
        let t = TURN.swap(0, Ordering::AcqRel);
        if t != 0 {
            let header = ClapEventHeader { size: std::mem::size_of::<ClapEventParamValue>() as u32, time: 0, space_id: 0, kind: EVENT_PARAM_VALUE, flags: 0 };
            let e = ClapEventParamValue { header, param_id: (t >> 32) as u32 - 1, cookie: std::ptr::null_mut(), note_id: -1, port_index: -1, channel: -1, key: -1, value: (t as u32) as f64 / 1000.0 };
            let out = (*pr).out_events;
            ((*out).try_push)(out, &e.header);
        }
        1
    }
    unsafe extern "C" fn flush(_: *const ClapPlugin, _: *const ClapInputEvents, _: *const ClapOutputEvents) { FLUSHES.fetch_add(1, Ordering::AcqRel); }
    unsafe extern "C" fn count(_: *const ClapPlugin) -> u32 { 0 }
    unsafe extern "C" fn info(_: *const ClapPlugin, _: u32, _: *mut ClapParamInfo) -> bool { false }
    unsafe extern "C" fn value(_: *const ClapPlugin, _: u32, _: *mut f64) -> bool { false }
    unsafe extern "C" fn to_text(_: *const ClapPlugin, _: u32, _: f64, _: *mut c_char, _: u32) -> bool { false }
    unsafe extern "C" fn from_text(_: *const ClapPlugin, _: u32, _: *const c_char, _: *mut f64) -> bool { false }
    static PARAMS: ClapPluginParams = ClapPluginParams { count, get_info: info, get_value: value, value_to_text: to_text, text_to_value: from_text, flush };

    fn pretend() -> Plugin {
        let b = unsafe { Bundle::from_entry(&tone::clap_entry, "test-tone", std::ptr::null_mut()).unwrap() };
        let mut p = Plugin::new(&b, 0, 48000.0).unwrap();
        assert_eq!(p.editor_kind(), None);
        let host = &*p._host as *const ClapHost;
        HOST.store(host as u64, Ordering::Release);
        // swap the pretend editor and knob into Test Tone's table
        unsafe { (*(p.plugin as *mut ClapPlugin)).process = process; }
        p.gui = &GUI;
        p.params = &PARAMS;
        p
    }
    fn host() -> *const ClapHost { HOST.load(Ordering::Acquire) as *const ClapHost }
    fn calls() -> Vec<&'static str> { std::mem::take(&mut *CALLS.lock().unwrap()) }

    #[test]
    fn a_floating_editor_opens_turns_a_knob_and_closes() {
        let _l = LOCK.lock().unwrap();
        let mut p = pretend();
        assert_eq!(p.editor_kind(), Some(Kind::Floating));
        p.open_editor("Test Tone, track 2").unwrap();
        assert_eq!(calls(), ["create floating", "title", "show"]);
        assert!(p.pump());

        // a knob turned in the editor reaches the host with the next block; the last value per parameter is kept
        TURN.store((1u64 << 32) | 250, Ordering::Release);
        assert!(p.render(&mut [0.0; 64], 32));
        TURN.store((1u64 << 32) | 500, Ordering::Release);
        assert!(p.render(&mut [0.0; 64], 32));
        TURN.store((2u64 << 32) | 1000, Ordering::Release);
        assert!(p.render(&mut [0.0; 64], 32));
        assert_eq!(p.take_changes(4), "[{\"id\":0,\"value\":0.5},{\"id\":1,\"value\":1}]"); // too short: kept
        assert_eq!(p.take_changes(4096), "[{\"id\":0,\"value\":0.5},{\"id\":1,\"value\":1}]");
        assert_eq!(p.take_changes(4096), "[]");

        // the player closes the plugin's window: the host destroys its gui on the next pump
        unsafe { ((*gui_host()).closed)(host(), false); }
        assert!(!p.pump());
        assert!(!p.editor_open());
        assert_eq!(calls(), ["hide", "destroy"]);
        assert!(!p.pump());
    }

    fn gui_host() -> *const ClapHostGui {
        unsafe { ((*host()).get_extension)(host(), HOST_GUI.as_ptr()) as *const ClapHostGui }
    }

    #[test]
    fn an_open_editor_is_shown_again_and_goes_with_the_plugin() {
        let _l = LOCK.lock().unwrap();
        let mut p = pretend();
        p.open_editor("Test Tone, track 2").unwrap();
        p.open_editor("Test Tone, track 2").unwrap();
        assert_eq!(calls(), ["create floating", "title", "show", "show"]);
        // a flush asked for before any block runs is made on the next pump
        let hp = unsafe { ((*host()).get_extension)(host(), HOST_PARAMS.as_ptr()) as *const ClapHostParams };
        let before = FLUSHES.load(Ordering::Acquire);
        unsafe { ((*hp).request_flush)(host()); }
        assert!(p.pump());
        assert_eq!(FLUSHES.load(Ordering::Acquire), before + 1);
        drop(p);
        assert_eq!(calls(), ["hide", "destroy"]);
    }

    #[test]
    fn test_tone_has_no_editor() {
        let b = unsafe { Bundle::from_entry(&tone::clap_entry, "test-tone", std::ptr::null_mut()).unwrap() };
        let mut p = Plugin::new(&b, 0, 48000.0).unwrap();
        assert_eq!(p.open_editor("x").unwrap_err(), "Test Tone has no editor of its own");
        assert!(!p.pump());
    }
}
