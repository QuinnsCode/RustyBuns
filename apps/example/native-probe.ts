import { loadNative } from "@rustybuns/native";
import { rbHelloSymbols } from "../../native/crates/rb_hello/rb_hello.symbols.ts";
const hello = await loadNative("rb_hello", rbHelloSymbols);
if (!hello) { console.log("rb_hello: not built for this platform, TS path"); process.exit(0); }
const buf = new Float32Array(new SharedArrayBuffer(4 * 1024));
buf.fill(0.5);
console.log("rb_add(2,3) =", hello.rb_add(2, 3));
console.log("rb_sum_f32(sab) =", hello.rb_sum_f32(buf, buf.length));
