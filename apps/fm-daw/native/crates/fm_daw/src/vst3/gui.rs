//! A hosted VST3's own editor (#5516), the way the CLAP host opens one (`clap/gui.rs`).
//!
//! A VST3 editor never floats: the controller makes an `IPlugView` (`createView("editor")`), and the host hands it a
//! native view to draw in (`attached`), here the content view of a window of ours (macOS for now, as for a CLAP that
//! only embeds). The plugin asks for a new size through our `IPlugFrame` (`resizeView`): the window takes it and the
//! view is told (`onSize`) before the call returns. Knobs turned in it come back through our `IComponentHandler`
//! (`beginEdit`/`performEdit`/`endEdit`), set on the controller when the plugin starts: each move goes to the processor
//! in the next block and to the desk's sliders ([`Plugin::take_changes`]). [`Plugin::pump`], on the main thread while
//! the editor is open, runs the window's events and closes the editor once the player closes its window.

use super::*;
use crate::clap::gui::{window, Kind};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

pub const IPLUG_VIEW: Tuid = uid(0x5BC32507, 0xD06049EA, 0xA6151B52, 0x2B755B29);
pub const IPLUG_FRAME: Tuid = uid(0x367FAF01, 0xAFA94693, 0x8D4DA2A0, 0xED0882A3);
pub const ICOMPONENT_HANDLER: Tuid = uid(0x93A0BEA3, 0x0BD045DB, 0x8E890B0C, 0xC1E46AC6);
pub const VIEW_EDITOR: &CStr = c"editor";

/// The native view type our window hands a plugin.
#[cfg(target_os = "macos")]
pub const PLATFORM: &CStr = c"NSView";
#[cfg(windows)]
pub const PLATFORM: &CStr = c"HWND";
#[cfg(not(any(target_os = "macos", windows)))]
pub const PLATFORM: &CStr = c"X11EmbedWindowID";

#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct ViewRect { pub left: i32, pub top: i32, pub right: i32, pub bottom: i32 }

impl ViewRect {
    fn size(&self) -> (u32, u32) { ((self.right - self.left).max(0) as u32, (self.bottom - self.top).max(0) as u32) }
}

#[repr(C)]
pub struct PlugViewVtbl {
    pub unknown: Unknown,
    pub is_platform_type_supported: unsafe extern "system" fn(This, *const c_char) -> TResult,
    pub attached: unsafe extern "system" fn(This, *mut c_void, *const c_char) -> TResult,
    pub removed: unsafe extern "system" fn(This) -> TResult,
    pub on_wheel: unsafe extern "system" fn(This, f32) -> TResult,
    pub on_key_down: unsafe extern "system" fn(This, u16, i16, i16) -> TResult,
    pub on_key_up: unsafe extern "system" fn(This, u16, i16, i16) -> TResult,
    pub get_size: unsafe extern "system" fn(This, *mut ViewRect) -> TResult,
    pub on_size: unsafe extern "system" fn(This, *mut ViewRect) -> TResult,
    pub on_focus: unsafe extern "system" fn(This, u8) -> TResult,
    pub set_frame: unsafe extern "system" fn(This, *mut c_void) -> TResult,
    pub can_resize: unsafe extern "system" fn(This) -> TResult,
    pub check_size_constraint: unsafe extern "system" fn(This, *mut ViewRect) -> TResult,
}

#[repr(C)]
pub struct PlugFrameVtbl {
    pub unknown: Unknown,
    pub resize_view: unsafe extern "system" fn(This, *mut c_void, *mut ViewRect) -> TResult,
}

#[repr(C)]
pub struct ComponentHandlerVtbl {
    pub unknown: Unknown,
    pub begin_edit: unsafe extern "system" fn(This, u32) -> TResult,
    pub perform_edit: unsafe extern "system" fn(This, u32, f64) -> TResult,
    pub end_edit: unsafe extern "system" fn(This, u32) -> TResult,
    pub restart_component: unsafe extern "system" fn(This, i32) -> TResult,
}

// ---- our IComponentHandler: the controller's own moves, kept for the next block ----

/// What the controller moved itself (last value per parameter, 0..1). Locked: a plugin may call it off the main thread.
#[repr(C)]
pub struct Handler { vtbl: &'static ComponentHandlerVtbl, edits: Mutex<Vec<(u32, f64)>> }

impl Handler {
    pub fn new() -> Box<Handler> { Box::new(Handler { vtbl: &HANDLER_VTBL, edits: Mutex::new(Vec::new()) }) }
    pub fn ptr(&self) -> *mut c_void { self as *const Handler as *mut c_void }
    pub fn take(&self) -> Vec<(u32, f64)> { self.edits.lock().map(|mut e| std::mem::take(&mut *e)).unwrap_or_default() }
}

unsafe extern "system" fn handler_query(this: This, iid: *const Tuid, obj: *mut *mut c_void) -> TResult { answer(this, iid, &ICOMPONENT_HANDLER, obj) }
unsafe extern "system" fn edit_ok(_: This, _: u32) -> TResult { OK }
unsafe extern "system" fn perform_edit(this: This, id: u32, value: f64) -> TResult {
    if !value.is_finite() { return FALSE; }
    if let Ok(mut e) = (*(this as *const Handler)).edits.lock() { keep_change(&mut e, id, value.clamp(0.0, 1.0)); }
    OK
}
unsafe extern "system" fn restart(_: This, _: i32) -> TResult { OK }
static HANDLER_VTBL: ComponentHandlerVtbl = ComponentHandlerVtbl {
    unknown: Unknown { query_interface: handler_query, add_ref, release },
    begin_edit: edit_ok, perform_edit, end_edit: edit_ok, restart_component: restart,
};

// ---- our IPlugFrame: the plugin's resize, done on our window ----

#[repr(C)]
struct Frame { vtbl: &'static PlugFrameVtbl, window: *const window::Window, busy: AtomicBool }

unsafe extern "system" fn frame_query(this: This, iid: *const Tuid, obj: *mut *mut c_void) -> TResult { answer(this, iid, &IPLUG_FRAME, obj) }
unsafe extern "system" fn resize_view(this: This, view: *mut c_void, rect: *mut ViewRect) -> TResult {
    let f = &*(this as *const Frame);
    if view.is_null() || rect.is_null() { return FALSE; }
    let (w, h) = (*rect).size();
    if w == 0 || h == 0 { return FALSE; }
    // a view that answers onSize with another resizeView gets its size without going round again
    if f.busy.swap(true, Ordering::AcqRel) { return OK; }
    (*f.window).set_size(w.min(8192), h.min(8192));
    let mut r = ViewRect { left: 0, top: 0, right: w as i32, bottom: h as i32 };
    (vt::<PlugViewVtbl>(view).on_size)(view, &mut r);
    f.busy.store(false, Ordering::Release);
    OK
}
static FRAME_VTBL: PlugFrameVtbl = PlugFrameVtbl { unknown: Unknown { query_interface: frame_query, add_ref, release }, resize_view };

/// An open editor: the plugin's view inside our window, and the frame it resizes through.
pub struct Editor {
    view: Com,
    frame: Box<Frame>,
    window: Box<window::Window>,
}

impl Plugin {
    /// How this plugin's editor would open here: inside a window of ours, or None when it has none (or this OS can't
    /// hold one yet). Asking makes the view once to see (and lets it go), so the answer is kept.
    pub fn editor_kind(&self) -> Option<Kind> {
        if !window::CAN { return None; }
        let has = match self.has_view.get() {
            Some(h) => h,
            None => { let h = self.make_view().is_some(); self.has_view.set(Some(h)); h }
        };
        has.then_some(Kind::Window)
    }

    /// A new editor view that takes our native view type.
    fn make_view(&self) -> Option<Com> {
        let ctl = self.controller.as_ref()?;
        unsafe {
            let view = Com::own((ctl.v::<ControllerVtbl>().create_view)(ctl.ptr(), VIEW_EDITOR.as_ptr()))?;
            ((view.v::<PlugViewVtbl>().is_platform_type_supported)(view.ptr(), PLATFORM.as_ptr()) == OK).then_some(view)
        }
    }

    pub fn editor_open(&self) -> bool { self.editor.is_some() }

    /// Opens the editor in a window titled `title` (or brings it forward if it's open); `Err` says why it won't.
    pub fn open_editor(&mut self, title: &str) -> Result<(), String> {
        if let Some(e) = &self.editor { e.window.show(); return Ok(()); }
        if self.editor_kind().is_none() {
            return Err(if window::CAN { format!("{} has no editor of its own", self.name) }
                       else { format!("{}'s editor only opens inside a host window, which FM DAW makes on macOS for now", self.name) });
        }
        if !window::on_main_thread() { return Err("an editor opens from the app's main thread".into()); }
        let Some(view) = self.make_view() else { return Err(format!("{}'s editor couldn't be made", self.name)) };
        let ctitle = CString::new(title.replace('\0', "")).unwrap_or_default();
        unsafe {
            let v: &PlugViewVtbl = view.v();
            let mut r = ViewRect::default();
            let (mut w, mut h) = if (v.get_size)(view.ptr(), &mut r) == OK { r.size() } else { (0, 0) };
            if w == 0 || h == 0 { (w, h) = (640, 400); }
            let Some(win) = window::Window::new(&ctitle, w.min(8192), h.min(8192), (v.can_resize)(view.ptr()) == OK) else {
                return Err("couldn't make a window for the editor".into());
            };
            let window = Box::new(win);
            let frame = Box::new(Frame { vtbl: &FRAME_VTBL, window: &*window, busy: AtomicBool::new(false) });
            (v.set_frame)(view.ptr(), &*frame as *const Frame as *mut c_void);
            if (v.attached)(view.ptr(), window.view(), PLATFORM.as_ptr()) != OK {
                (v.set_frame)(view.ptr(), std::ptr::null_mut());
                return Err(format!("{}'s editor wouldn't go in its window", self.name));
            }
            window.show();
            self.editor = Some(Editor { view, frame, window });
        }
        Ok(())
    }

    /// Closes the editor, if open: the view taken out of our window and let go, then the window.
    pub fn close_editor(&mut self) {
        let Some(e) = self.editor.take() else { return };
        unsafe {
            let v: &PlugViewVtbl = e.view.v();
            (v.removed)(e.view.ptr());
            (v.set_frame)(e.view.ptr(), std::ptr::null_mut());
        }
        let Editor { view, frame, window } = e;
        drop(view);
        drop(window);
        drop(frame);
    }

    /// The controller's own moves (its editor's knobs) since last asked: to the processor's next block, and the desk.
    pub(super) fn take_edits(&mut self) {
        for (id, v) in self.handler.take() {
            self.input_changes.set(id, v);
            let k = self.scale(id);
            keep_change(&mut self.changes, id, v * k);
        }
    }

    /// Runs the editor window's events and picks up its knob turns. Main thread only. True while the editor is open.
    pub fn pump(&mut self) -> bool {
        if self.editor.is_some() { window::pump_events(); }
        self.take_edits();
        let Some(e) = &self.editor else { return false };
        if !e.window.visible() { self.close_editor(); return false; }
        true
    }
}

#[cfg(test)]
mod tests {
    //! Test Tone (VST3) with a pretend editor view swapped into its controller: it records what the host asked,
    //! resizes itself and turns a knob when told to (as a player would in a real editor), all without a screen.
    use super::*;
    use std::sync::atomic::AtomicPtr;

    static LOCK: Mutex<()> = Mutex::new(());
    static CALLS: Mutex<Vec<String>> = Mutex::new(Vec::new());
    static FRAME: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

    fn call(c: impl Into<String>) { CALLS.lock().unwrap().push(c.into()); }
    fn calls() -> Vec<String> { std::mem::take(&mut *CALLS.lock().unwrap()) }

    #[repr(C)]
    struct View { vtbl: &'static PlugViewVtbl }
    unsafe extern "system" fn view_query(this: This, iid: *const Tuid, obj: *mut *mut c_void) -> TResult { answer(this, iid, &IPLUG_VIEW, obj) }
    unsafe extern "system" fn supported(_: This, t: *const c_char) -> TResult { if CStr::from_ptr(t) == PLATFORM { OK } else { FALSE } }
    unsafe extern "system" fn attached(_: This, parent: *mut c_void, t: *const c_char) -> TResult {
        assert!(!parent.is_null());
        call(format!("attached {}", CStr::from_ptr(t).to_str().unwrap()));
        OK
    }
    unsafe extern "system" fn removed(_: This) -> TResult { call("removed"); OK }
    unsafe extern "system" fn wheel(_: This, _: f32) -> TResult { FALSE }
    unsafe extern "system" fn key(_: This, _: u16, _: i16, _: i16) -> TResult { FALSE }
    unsafe extern "system" fn get_size(_: This, r: *mut ViewRect) -> TResult { *r = ViewRect { left: 0, top: 0, right: 300, bottom: 200 }; OK }
    unsafe extern "system" fn on_size(_: This, r: *mut ViewRect) -> TResult { let (w, h) = (*r).size(); call(format!("size {w}x{h}")); OK }
    unsafe extern "system" fn focus(_: This, _: u8) -> TResult { OK }
    unsafe extern "system" fn set_frame(_: This, f: *mut c_void) -> TResult {
        FRAME.store(f, Ordering::Release);
        call(if f.is_null() { "frame gone" } else { "frame" });
        OK
    }
    unsafe extern "system" fn resizable(_: This) -> TResult { OK }
    unsafe extern "system" fn constraint(_: This, _: *mut ViewRect) -> TResult { OK }
    static VIEW_VTBL: PlugViewVtbl = PlugViewVtbl {
        unknown: Unknown { query_interface: view_query, add_ref, release },
        is_platform_type_supported: supported, attached, removed, on_wheel: wheel, on_key_down: key, on_key_up: key,
        get_size, on_size, on_focus: focus, set_frame, can_resize: resizable, check_size_constraint: constraint,
    };
    static VIEW: View = View { vtbl: &VIEW_VTBL };
    fn view() -> *mut c_void { &VIEW as *const View as *mut c_void }
    unsafe extern "system" fn create_view(_: This, name: *const c_char) -> *mut c_void {
        if CStr::from_ptr(name) == VIEW_EDITOR { view() } else { std::ptr::null_mut() }
    }

    fn pretend() -> Plugin {
        let b = Bundle::own().unwrap();
        let p = Plugin::new(&b, 0, 48000.0).unwrap();
        // swap the pretend view into Test Tone's controller (a copy of its table with createView answering)
        let ctl = p.controller.as_ref().unwrap().ptr();
        unsafe {
            let mut table: ControllerVtbl = std::ptr::read(vt::<ControllerVtbl>(ctl));
            table.create_view = create_view;
            *(ctl as *mut &'static ControllerVtbl) = Box::leak(Box::new(table));
        }
        calls();
        p
    }

    fn peak(p: &mut Plugin) -> f32 {
        let mut out = vec![0f32; 2 * 4800];
        assert!(p.render(&mut out, 4800));
        out.iter().fold(0f32, |m, x| m.max(x.abs()))
    }

    #[test]
    fn an_editor_opens_in_our_window_resizes_turns_a_knob_and_closes() {
        let _l = LOCK.lock().unwrap();
        let mut p = pretend();
        assert_eq!(p.editor_kind(), Some(Kind::Window));
        p.open_editor("Test Tone, track 2").unwrap();
        assert_eq!(calls(), ["frame", &format!("attached {}", PLATFORM.to_str().unwrap())]);
        let w = &p.editor.as_ref().unwrap().window;
        assert_eq!((w.size.get(), w.resizable, w.visible()), ((300, 200), true, true));
        assert!(p.pump());

        // the plugin grows its view: our window takes the size and the view is told before the call returns
        let mut r = ViewRect { left: 0, top: 0, right: 480, bottom: 320 };
        let f = FRAME.load(Ordering::Acquire);
        assert_eq!(unsafe { (vt::<PlugFrameVtbl>(f).resize_view)(f, view(), &mut r) }, OK);
        assert_eq!(p.editor.as_ref().unwrap().window.size.get(), (480, 320));
        assert_eq!(calls(), ["size 480x320"]);

        // knobs turned in the editor: the processor plays them in the next block, and the desk hears of them
        p.note_on(69, 1.0, 0);
        assert!(peak(&mut p) > 0.1);
        let h = p.handler.ptr();
        let hv: &ComponentHandlerVtbl = unsafe { vt(h) };
        unsafe {
            (hv.begin_edit)(h, 0);
            (hv.perform_edit)(h, 0, 0.3);
            (hv.perform_edit)(h, 0, 0.0);
            (hv.end_edit)(h, 0);
            (hv.perform_edit)(h, 1, 1.0);
        }
        assert_eq!(peak(&mut p), 0.0);
        assert_eq!(p.take_changes(4096), "[{\"id\":0,\"value\":0},{\"id\":1,\"value\":1}]");
        unsafe { (hv.perform_edit)(h, 0, 1.0); }
        assert!(p.pump()); // a turn picked up while no block runs still reaches the desk
        assert_eq!(p.take_changes(4096), "[{\"id\":0,\"value\":1}]");
        assert!((peak(&mut p) - 0.25).abs() < 1e-5); // one square voice at full level

        // asked again, the open editor comes forward; the player closes its window and it goes on the next pump
        p.open_editor("Test Tone, track 2").unwrap();
        assert!(calls().is_empty());
        p.editor.as_ref().unwrap().window.shown.set(false);
        assert!(!p.pump());
        assert!(!p.editor_open());
        assert_eq!(calls(), ["removed", "frame gone"]);
        assert!(!p.pump());
    }

    #[test]
    fn an_open_editor_goes_with_the_plugin() {
        let _l = LOCK.lock().unwrap();
        let mut p = pretend();
        p.open_editor("Test Tone, track 2").unwrap();
        calls();
        drop(p);
        assert_eq!(calls(), ["removed", "frame gone"]);
    }

    #[test]
    fn test_tone_has_no_editor() {
        let b = Bundle::own().unwrap();
        let mut p = Plugin::new(&b, 0, 48000.0).unwrap();
        assert_eq!(p.editor_kind(), None);
        assert_eq!(p.open_editor("x").unwrap_err(), "Test Tone (VST3) has no editor of its own");
        assert!(!p.pump());
    }
}
