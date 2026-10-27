// A shell with no window and no webview. The compiled Bun binary is the app: it serves the page and opens
// Chrome with --app, as it does without us. This gives it what a bare binary lacks: a Dock icon, a menu bar,
// Cmd-Q that takes the binary down, and a Dock click that brings the Chrome window back.
//
// Dev: RB_BINARY=../dist/agent-office-darwin-arm64 cargo run
// Bundled: tauri's externalBin puts the binary next to this executable.
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent, State};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

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

fn show_office() {
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").args(["-a", "Google Chrome"]).spawn();
}

fn main() {
    let child = Command::new(binary()).spawn().expect("could not start the agent-office binary");
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(Office(Mutex::new(Some(child))))
        .setup(|app| {
            // Menu bar icon: open the office, toggle launch at login, quit.
            let launch = app.autolaunch();
            let open = MenuItem::with_id(app, "open", "Open Agent Office", true, None::<&str>)?;
            let login = CheckMenuItem::with_id(app, "login", "Launch at login", true, launch.is_enabled().unwrap_or(false), None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, Some("Cmd+Q"))?;
            let menu = Menu::with_items(app, &[&open, &login, &PredefinedMenuItem::separator(app)?, &quit])?;
            let mut tray = TrayIconBuilder::new().menu(&menu).on_menu_event(move |app, event| match event.id().as_ref() {
                "open" => show_office(),
                "login" => {
                    let l = app.autolaunch();
                    let _ = if l.is_enabled().unwrap_or(false) { l.disable() } else { l.enable() };
                    let _ = login.set_checked(l.is_enabled().unwrap_or(false));
                }
                "quit" => app.exit(0),
                _ => {}
            });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("tauri build")
        .run(|app, event| match event {
            // Dock icon clicked with no windows of ours: bring Chrome (and its app window) forward.
            RunEvent::Reopen { .. } => show_office(),
            // Cmd-Q or Quit: take the binary down with us. (A windowless app would otherwise quit never,
            // and a closed Chrome window must not quit us.)
            RunEvent::ExitRequested { .. } | RunEvent::Exit => stop(&app.state::<Office>()),
            _ => {}
        });
}
