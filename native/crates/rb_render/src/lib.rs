//! rb_render: a react-dom app's op stream (packages/render), drawn by Blitz.
//!
//! Bun owns the loop. On its main thread it calls, in order:
//!   rb_render_new(w, h)          a document with `<div id="root">` as node 0
//!   rb_render_window(title)      optional: a winit window on that document
//!   then each tick:
//!     rb_render_frame(ops)       the frame's ops, one JSON array
//!     rb_render_pump(ms)         let the window handle its events and paint
//!     rb_render_poll(buf)        the clicks and typed text since the last poll
//!   rb_render_snapshot(png, w, h) paints the document to a PNG, window or not
//!
//! Every call returns a status instead of unwinding into Bun; `rb_render_error`
//! says what the last failure was. One document and one window per process
//! (winit allows one event loop), all on the thread that made them.

pub mod ops;

use anyrender::ImageRenderer;
use anyrender_vello::{VelloImageRenderer, VelloWindowRenderer};
use blitz_dom::{BaseDocument, DocGuard, DocGuardMut, Document, DocumentConfig, EventDriver, EventHandler};
use blitz_paint::paint_scene;
use blitz_shell::{BlitzApplication, BlitzShellProxy, EventLoop, WindowConfig};
use blitz_traits::events::{DomEvent, DomEventData, EventState, UiEvent};
use blitz_traits::shell::{ColorScheme, Viewport};
use blitz_traits::NodeId;
use ops::Ids;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::VecDeque;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::rc::Rc;
use std::time::Duration;
use winit::dpi::LogicalSize;
use winit::event_loop::pump_events::{EventLoopExtPumpEvents, PumpStatus};
use winit::window::WindowAttributes;

type Shared<T> = Rc<RefCell<T>>;

struct Page {
    doc: Shared<BaseDocument>,
    ids: Shared<Ids>,
    inputs: Shared<VecDeque<Value>>,
    size: (u32, u32),
    shell: Option<Shell>,
}

struct Shell {
    event_loop: EventLoop,
    app: BlitzApplication<VelloWindowRenderer>,
    open: bool,
}

thread_local! {
    static PAGE: RefCell<Option<Page>> = const { RefCell::new(None) };
    static ERROR: RefCell<String> = const { RefCell::new(String::new()) };
}

/// The window's view of the shared document: Blitz lays it out and paints it,
/// and the input it turns into DOM events is written down for Bun.
struct WindowDoc {
    doc: Shared<BaseDocument>,
    ids: Shared<Ids>,
    inputs: Shared<VecDeque<Value>>,
}

impl Document for WindowDoc {
    fn inner(&self) -> DocGuard<'_> {
        DocGuard::RefCell(self.doc.borrow())
    }
    fn inner_mut(&mut self) -> DocGuardMut<'_> {
        DocGuardMut::RefCell(self.doc.borrow_mut())
    }
    fn handle_ui_event(&mut self, event: UiEvent) {
        let mut doc = self.doc.borrow_mut();
        let recorder = Recorder { ids: &self.ids, inputs: &self.inputs };
        EventDriver::new(&mut *doc, recorder).handle_ui_event(event);
    }
}

/// Blitz still runs each event's default action (focus, caret, typing into a
/// field); this only reports what the page's handlers need to hear.
struct Recorder<'a> {
    ids: &'a Shared<Ids>,
    inputs: &'a Shared<VecDeque<Value>>,
}

impl EventHandler for Recorder<'_> {
    fn handle_event(&mut self, chain: &[NodeId], event: &mut DomEvent, _doc: &mut dyn Document, _state: &mut EventState) {
        let input = match &event.data {
            DomEventData::Click(_) => self.ids.borrow().page_id(chain).map(|id| json!(["click", id])),
            DomEventData::Input(typed) => {
                let id = self.ids.borrow().page_id(&[event.target]);
                id.map(|id| {
                    self.ids.borrow_mut().note_typed(id, &typed.value);
                    json!(["input", id, typed.value])
                })
            }
            _ => None,
        };
        if let Some(input) = input {
            self.inputs.borrow_mut().push_back(input);
        }
    }
}

fn fail(msg: impl Into<String>) -> i32 {
    ERROR.with(|e| *e.borrow_mut() = msg.into());
    -1
}

/// Runs `f` on the page, turning an error or a panic into -1 and a message.
fn with_page(f: impl FnOnce(&mut Page) -> Result<i32, String>) -> i32 {
    let out = catch_unwind(AssertUnwindSafe(|| {
        PAGE.with(|p| match p.borrow_mut().as_mut() {
            Some(page) => f(page),
            None => Err("rb_render_new hasn't run".into()),
        })
    }));
    match out {
        Ok(Ok(n)) => n,
        Ok(Err(msg)) => fail(msg),
        Err(panic) => fail(format!("panicked: {}", panic_text(&panic))),
    }
}

fn panic_text(p: &Box<dyn std::any::Any + Send>) -> String {
    p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_default()
}

/// # Safety
/// `ptr` must point to `len` readable bytes for the duration of the call.
unsafe fn bytes<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if ptr.is_null() || len == 0 { &[] } else { std::slice::from_raw_parts(ptr, len) }
}

/// A fresh document sized `width` x `height` CSS pixels. 1 on success.
#[no_mangle]
pub extern "C" fn rb_render_new(width: u32, height: u32) -> i32 {
    let made = catch_unwind(|| {
        let mut doc = BaseDocument::new(DocumentConfig {
            viewport: Some(Viewport::new(width, height, 1.0, ColorScheme::Light)),
            ..Default::default()
        });
        let mut ids = Ids::default();
        ops::mount(&mut doc, &mut ids);
        Page { doc: Rc::new(RefCell::new(doc)), ids: Rc::new(RefCell::new(ids)), inputs: Default::default(), size: (width, height), shell: None }
    });
    match made {
        Ok(page) => PAGE.with(|p| {
            if p.borrow().is_some() { return fail("one document per process"); }
            *p.borrow_mut() = Some(page);
            1
        }),
        Err(panic) => fail(format!("panicked: {}", panic_text(&panic))),
    }
}

/// Opens a window on the document, titled with `len` UTF-8 bytes at `title`. 1 on success.
///
/// # Safety
/// `title` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn rb_render_window(title: *const u8, len: usize) -> i32 {
    let title = String::from_utf8_lossy(bytes(title, len)).into_owned();
    with_page(|page| {
        if page.shell.is_some() { return Err("the window is already open".into()); }
        let event_loop = EventLoop::new().map_err(|e| format!("no event loop: {e}"))?;
        let (proxy, events) = BlitzShellProxy::new(event_loop.create_proxy());
        let mut app = BlitzApplication::new(proxy, events);
        let (w, h) = page.size;
        let attrs = WindowAttributes::default().with_title(title).with_surface_size(LogicalSize::new(w, h));
        let doc = WindowDoc { doc: page.doc.clone(), ids: page.ids.clone(), inputs: page.inputs.clone() };
        app.add_window(WindowConfig::with_attributes(Box::new(doc), VelloWindowRenderer::new(), attrs));
        page.shell = Some(Shell { event_loop, app, open: true });
        Ok(1)
    })
}

/// Applies one frame: `len` bytes of a JSON array of ops. The number of ops applied, or -1.
///
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn rb_render_frame(ptr: *const u8, len: usize) -> i32 {
    let json = bytes(ptr, len);
    with_page(|page| {
        let frame: Value = serde_json::from_slice(json).map_err(|e| format!("frame is not JSON: {e}"))?;
        let list = frame.as_array().ok_or("frame is not an array")?;
        let n = ops::apply(&mut page.doc.borrow_mut(), &mut page.ids.borrow_mut(), list)?;
        if let Some(shell) = &page.shell {
            for view in shell.app.windows.values() { view.request_redraw(); }
        }
        i32::try_from(n).map_err(|_| "too many ops in one frame".into())
    })
}

/// Lets the window take its events and repaint, waiting up to `ms` for one.
/// 1 while the window is open, 0 once the user has closed it, -1 with no window.
#[no_mangle]
pub extern "C" fn rb_render_pump(ms: u32) -> i32 {
    with_page(|page| {
        let shell = page.shell.as_mut().ok_or("no window: rb_render_window hasn't run")?;
        if !shell.open { return Ok(0); }
        if let PumpStatus::Exit(_) = shell.event_loop.pump_app_events(Some(Duration::from_millis(ms.into())), &mut shell.app) {
            shell.open = false;
        }
        Ok(i32::from(shell.open))
    })
}

/// Writes the input since the last poll into `out` as a JSON array
/// (`[["click", id], ["input", id, value]]`) and returns its length in bytes.
/// Input that doesn't fit stays queued for the next poll.
///
/// # Safety
/// `out` must point to `cap` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn rb_render_poll(out: *mut u8, cap: usize) -> i32 {
    if out.is_null() { return fail("no buffer"); }
    let buf = std::slice::from_raw_parts_mut(out, cap);
    with_page(|page| {
        let mut queue = page.inputs.borrow_mut();
        let mut text = String::from("[");
        while let Some(next) = queue.front() {
            let item = next.to_string();
            let sep = usize::from(text.len() > 1);
            if text.len() + sep + item.len() + 1 > cap { break; }
            if sep == 1 { text.push(','); }
            text.push_str(&item);
            queue.pop_front();
        }
        text.push(']');
        if text.len() > cap { return Err("poll buffer is under 2 bytes".into()); }
        buf[..text.len()].copy_from_slice(text.as_bytes());
        Ok(text.len() as i32)
    })
}

/// Lays out and paints the document at `width` x `height` with Blitz's own
/// painter (on the GPU, no window needed) and writes a PNG to the UTF-8 path
/// at `path`. 1 on success.
///
/// # Safety
/// `path` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn rb_render_snapshot(path: *const u8, len: usize, width: u32, height: u32) -> i32 {
    let path = String::from_utf8_lossy(bytes(path, len)).into_owned();
    with_page(|page| {
        let mut doc = page.doc.borrow_mut();
        let window_view = doc.viewport().clone();
        doc.set_viewport(Viewport::new(width, height, 1.0, ColorScheme::Light));
        doc.resolve(0.0);
        let mut renderer = VelloImageRenderer::new(width, height);
        let mut rgba = Vec::new();
        renderer.render_to_vec(|scene| paint_scene(scene, &mut *doc, 1.0, width, height, 0, 0), &mut rgba);
        doc.set_viewport(window_view);
        drop(doc);
        write_png(&path, width, height, &rgba)?;
        Ok(1)
    })
}

fn write_png(path: &str, width: u32, height: u32, rgba: &[u8]) -> Result<(), String> {
    let file = std::fs::File::create(path).map_err(|e| format!("{path}: {e}"))?;
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), width, height);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let mut w = enc.write_header().map_err(|e| e.to_string())?;
    w.write_image_data(rgba).map_err(|e| e.to_string())
}

/// Copies the last failure's message into `out`; its length in bytes (cut at `cap`).
///
/// # Safety
/// `out` must point to `cap` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn rb_render_error(out: *mut u8, cap: usize) -> i32 {
    if out.is_null() { return 0; }
    ERROR.with(|e| {
        let e = e.borrow();
        let mut n = e.len().min(cap);
        while !e.is_char_boundary(n) { n -= 1; }
        std::ptr::copy_nonoverlapping(e.as_ptr(), out, n);
        n as i32
    })
}
