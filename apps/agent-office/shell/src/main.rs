// A shell with no window and no webview. The compiled Bun binary is the app: it serves the page and opens
// Chrome with --app, as it does without us. This gives it what a bare binary lacks: a Dock icon, a menu bar,
// Cmd-Q that takes the binary down, and a Dock click that brings the Chrome window back.
//
// Dev: RB_BINARY=../dist/agent-office-darwin-arm64 cargo run
// Bundled: tauri's externalBin puts the binary next to this executable.
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, State};

struct Office(Mutex<Option<Child>>);

fn binary() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("RB_BINARY") {
        return p.into();
    }
    let exe = std::env::current_exe().expect("current_exe");
    exe.with_file_name("agent-office")
}

fn stop(office: &State<Office>) {
    if let Some(mut child) = office.0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn main() {
    let child = Command::new(binary()).spawn().expect("could not start the agent-office binary");
    tauri::Builder::default()
        .manage(Office(Mutex::new(Some(child))))
        .build(tauri::generate_context!())
        .expect("tauri build")
        .run(|app, event| match event {
            // Dock icon clicked with no windows of ours: bring Chrome (and its app window) forward.
            RunEvent::Reopen { .. } => {
                #[cfg(target_os = "macos")]
                let _ = Command::new("open").args(["-a", "Google Chrome"]).spawn();
            }
            // Cmd-Q or Quit: take the binary down with us. (A windowless app would otherwise quit never,
            // and a closed Chrome window must not quit us.)
            RunEvent::ExitRequested { .. } | RunEvent::Exit => stop(&app.state::<Office>()),
            _ => {}
        });
}
