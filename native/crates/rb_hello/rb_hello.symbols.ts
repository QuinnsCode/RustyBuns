import { FFIType } from "bun:ffi";
export const rbHelloSymbols = {
  rb_add:     { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  // `len` counts f32s, not bytes, so pass `view.length` as a u64.
  // (FFIType.buffer_length would hand Rust the byte length: 4x too many.)
  rb_sum_f32: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.f32 },
} as const;
