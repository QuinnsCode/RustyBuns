// ONNX Runtime's prebuilt macOS library (src/infer.rs, through ort) references CoreML's
// MLComputePlan, which only the macOS 14.4 SDK declares. The reference is weak (behind an
// availability check, and only for the CoreML execution provider, which we never register), so let
// it resolve at load time instead of failing the link on an older SDK. A newer SDK defines it anyway.
fn main() {
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("apple-darwin") {
        println!("cargo:rustc-cdylib-link-arg=-Wl,-U,_OBJC_CLASS_$_MLComputePlan");
    }
}
