import { FFIType } from "bun:ffi";
export const rbHelloSymbols = {
  rb_add:     { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  // buffer_length (Bun 1.4): pass a TypedArray and its length lands in `len`.
  rb_sum_f32: { args: [FFIType.ptr, FFIType.buffer_length], returns: FFIType.f32 },
} as const;
