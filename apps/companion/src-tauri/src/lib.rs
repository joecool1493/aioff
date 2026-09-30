//! AI Off companion: a thin executor.
//!
//! All knowledge (which policy, which value, which file) lives in the tested TypeScript
//! package `@aioff/policies`. The UI sends plain actions; this side writes files, imports
//! registry data, journals the previous state so revert is exact, and verifies.
//!
//! STATUS: written without a Rust toolchain on the authoring machine. It has not been
//! compiled yet. See DECISIONS.md. Expect small fixes on first `cargo check`.

mod exec;
mod journal;

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    WriteFile { id: String, path: String, content: String, needs_admin: bool },
    ImportReg { id: String, content: String, revert: String, needs_admin: bool },
}

impl Action {
    pub fn id(&self) -> &str {
        match self {
            Action::WriteFile { id, .. } | Action::ImportReg { id, .. } => id,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ActionReport {
    pub id: String,
    pub ok: bool,
    pub applied: bool,
    pub detail: String,
}

#[derive(Debug, Serialize)]
pub struct HostInfo {
    pub platform: &'static str,
    pub os_version: String,
    pub browsers: Vec<&'static str>,
}

#[tauri::command]
fn host_info() -> HostInfo {
    HostInfo { platform: exec::platform(), os_version: exec::os_version(), browsers: exec::installed_browsers() }
}

#[tauri::command]
fn apply(app: tauri::AppHandle, actions: Vec<Action>) -> Result<Vec<ActionReport>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let j = journal::Journal::open(&dir)?;
    exec::apply(&j, &actions)?;
    Ok(exec::verify(&actions))
}

#[tauri::command]
fn revert(app: tauri::AppHandle, actions: Vec<Action>) -> Result<Vec<ActionReport>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let j = journal::Journal::open(&dir)?;
    exec::revert(&j, &actions)?;
    Ok(exec::verify(&actions))
}

#[tauri::command]
fn verify(actions: Vec<Action>) -> Vec<ActionReport> {
    exec::verify(&actions)
}

/// Writes the generated .mobileconfig to the Downloads folder and opens it, which hands it
/// to System Settings. macOS requires the user to approve it there; it cannot be silent.
#[tauri::command]
fn open_profile(app: tauri::AppHandle, content: String) -> Result<String, String> {
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let path = dir.join("AI-Off-apple-intelligence.mobileconfig");
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    exec::open_path(&path.to_string_lossy())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // Only schemes the checklist uses. Never a file path, never a shell string.
    let allowed = ["https://", "x-apple.systempreferences:", "ms-settings:"];
    if !allowed.iter().any(|p| url.starts_with(p)) {
        return Err("scheme not allowed".into());
    }
    exec::open_path(&url)
}

#[tauri::command]
fn run_windows_command(id: String, shell: String, command: String, needs_admin: bool) -> Result<String, String> {
    // Commands come from the bundled catalog, never from the network. The id is checked
    // against the known set so a compromised webview cannot run arbitrary shell.
    const KNOWN: [&str; 3] = ["copilot-app-uninstall", "recall-remove-feature", "copilot-key-settings"];
    if !KNOWN.contains(&id.as_str()) {
        return Err("unknown command".into());
    }
    exec::run_windows_command(&shell, &command, needs_admin)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![host_info, apply, revert, verify, open_profile, open_url, run_windows_command])
        .run(tauri::generate_context!())
        .expect("error while running AI Off");
}
