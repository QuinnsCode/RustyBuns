//! The face models natively, for the desktop host: ONNX Runtime linked into this cdylib, the same
//! two models the page runs on onnxruntime-web. Only the inference is here; the letterbox, the
//! decode and the crop are src/faces/face.ts on both lanes, so the two can only differ in the
//! runtime's floats.
//!
//! A model is a heap handle: `pr_ort_open` it once, `pr_ort_run` it as often as you like from one
//! thread at a time, `pr_ort_close` it. Every output must be f32; `pr_ort_run` writes them one after
//! another into `out`, each one's length into `lens`, in the order `pr_ort_output_name` names them.
use ort::session::Session;
use ort::value::TensorRef;

pub struct Model {
    session: Session,
}

/// A model from its ONNX bytes, on `threads` intra-op threads (0: ONNX Runtime's choice). Null if
/// the bytes aren't a model this runtime can load.
#[no_mangle]
pub extern "C" fn pr_ort_open(bytes: *const u8, len: u32, threads: u32) -> *mut Model {
    let bytes = unsafe { std::slice::from_raw_parts(bytes, len as usize) };
    let session = Session::builder()
        .and_then(|b| b.with_intra_threads(threads as usize))
        .and_then(|b| b.commit_from_memory(bytes));
    match session {
        Ok(session) => Box::into_raw(Box::new(Model { session })),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "C" fn pr_ort_close(m: *mut Model) {
    if !m.is_null() {
        drop(unsafe { Box::from_raw(m) });
    }
}

/// How many outputs the model has.
#[no_mangle]
pub extern "C" fn pr_ort_outputs(m: *const Model) -> u32 {
    unsafe { (*m).session.outputs().len() as u32 }
}

/// Output `i`'s name into `buf` (up to `cap` bytes, UTF-8); returns its full length.
#[no_mangle]
pub extern "C" fn pr_ort_output_name(m: *const Model, i: u32, buf: *mut u8, cap: u32) -> u32 {
    let outputs = unsafe { (*m).session.outputs() };
    let Some(o) = outputs.get(i as usize) else { return 0 };
    let name = o.name().as_bytes();
    let n = name.len().min(cap as usize);
    unsafe { std::ptr::copy_nonoverlapping(name.as_ptr(), buf, n) };
    name.len() as u32
}

/// Runs the model on one `[1, c, h, w]` f32 input. Returns 0, or -1 when the run fails, -2 when an
/// output isn't f32, -3 when the outputs don't fit in `cap` floats.
#[no_mangle]
pub extern "C" fn pr_ort_run(m: *mut Model, input: *const f32, c: u32, h: u32, w: u32, out: *mut f32, cap: u32, lens: *mut u32) -> i32 {
    let model = unsafe { &mut *m };
    let data = unsafe { std::slice::from_raw_parts(input, (c * h * w) as usize) };
    let Ok(tensor) = TensorRef::from_array_view(([1usize, c as usize, h as usize, w as usize], data)) else { return -1 };
    let Ok(outputs) = model.session.run(ort::inputs![tensor]) else { return -1 };
    let mut at = 0usize;
    for (i, (_, value)) in outputs.iter().enumerate() {
        let Ok((_, floats)) = value.try_extract_tensor::<f32>() else { return -2 };
        if at + floats.len() > cap as usize {
            return -3;
        }
        unsafe {
            std::ptr::copy_nonoverlapping(floats.as_ptr(), out.add(at), floats.len());
            *lens.add(i) = floats.len() as u32;
        }
        at += floats.len();
    }
    0
}
