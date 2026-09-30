//! Platform execution. Elevation is requested once per flip, only when an action needs it:
//!   macOS    osascript "with administrator privileges" runs one staged shell script
//!   Windows  PowerShell Start-Process -Verb RunAs runs one staged .cmd of `reg import` lines
//!   Linux    pkexec runs one staged shell script
//! Staged scripts are built from paths this code generates, never from webview strings.

use crate::journal::Journal;
use crate::{Action, ActionReport};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn output_of(cmd: &str, args: &[&str]) -> String {
    Command::new(cmd)
        .args(args)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

pub fn os_version() -> String {
    match platform() {
        "macos" => output_of("sw_vers", &["-productVersion"]),
        "windows" => output_of("cmd", &["/c", "ver"]),
        _ => output_of("uname", &["-r"]),
    }
}

pub fn installed_browsers() -> Vec<&'static str> {
    let mut found = Vec::new();
    let candidates: [(&str, &[&str]); 5] = match platform() {
        "macos" => [
            ("chrome", &["/Applications/Google Chrome.app"]),
            ("chromium", &["/Applications/Chromium.app"]),
            ("edge", &["/Applications/Microsoft Edge.app"]),
            ("brave", &["/Applications/Brave Browser.app"]),
            ("firefox", &["/Applications/Firefox.app"]),
        ],
        "windows" => [
            ("chrome", &["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]),
            ("chromium", &["C:\\Program Files\\Chromium\\Application\\chrome.exe"]),
            ("edge", &["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]),
            ("brave", &["C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"]),
            ("firefox", &["C:\\Program Files\\Mozilla Firefox\\firefox.exe", "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe"]),
        ],
        _ => [
            ("chrome", &["/usr/bin/google-chrome", "/opt/google/chrome/chrome"]),
            ("chromium", &["/usr/bin/chromium", "/usr/bin/chromium-browser"]),
            ("edge", &["/usr/bin/microsoft-edge"]),
            ("brave", &["/usr/bin/brave-browser"]),
            ("firefox", &["/usr/bin/firefox"]),
        ],
    };
    for (id, paths) in candidates {
        if paths.iter().any(|p| Path::new(p).exists()) {
            found.push(id);
        }
    }
    found
}

/// Only absolute paths under the locations policies live in. Anything else is refused.
fn target_allowed(path: &str) -> bool {
    const ROOTS: [&str; 7] = [
        "/Library/Managed Preferences/",
        "/Library/Preferences/org.mozilla.firefox.plist",
        "/etc/opt/chrome/policies/managed/",
        "/etc/chromium/policies/managed/",
        "/etc/brave/policies/managed/",
        "/etc/opt/edge/policies/managed/",
        "/etc/firefox/policies/",
    ];
    !path.contains("..") && ROOTS.iter().any(|r| path.starts_with(r))
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn stage_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join(format!("aioff-stage-{}", std::process::id()));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn run_elevated_unix(script: &Path) -> Result<(), String> {
    let status = if cfg!(target_os = "macos") {
        let apple = format!("do shell script \"/bin/sh \" & quoted form of \"{}\" with administrator privileges", script.to_string_lossy().replace('"', "\\\""));
        Command::new("osascript").args(["-e", &apple]).status()
    } else {
        Command::new("pkexec").arg("/bin/sh").arg(script).status()
    }
    .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("The change was not approved, so nothing was changed.".into())
    }
}

fn run_elevated_windows(cmd_file: &Path) -> Result<(), String> {
    let ps = format!("Start-Process -FilePath cmd.exe -ArgumentList '/c','\"{}\"' -Verb RunAs -Wait -WindowStyle Hidden", cmd_file.to_string_lossy());
    let status = Command::new("powershell").args(["-NoProfile", "-Command", &ps]).status().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("The change was not approved, so nothing was changed.".into())
    }
}

/// Registry files must be UTF-16LE with a BOM for `reg import` to accept every character.
fn write_reg(path: &Path, content: &str) -> Result<(), String> {
    let mut bytes: Vec<u8> = vec![0xFF, 0xFE];
    for unit in content.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    fs::write(path, bytes).map_err(|e| e.to_string())
}

pub fn apply(journal: &Journal, actions: &[Action]) -> Result<(), String> {
    let stage = stage_dir()?;
    let mut unix_lines: Vec<String> = vec!["set -eu".into()];
    let mut win_admin: Vec<String> = Vec::new();
    for (i, action) in actions.iter().enumerate() {
        match action {
            Action::WriteFile { id, path, content, .. } => {
                if !target_allowed(path) {
                    return Err(format!("refusing to write outside policy locations: {path}"));
                }
                journal.record_file(id, Path::new(path))?;
                let staged = stage.join(format!("{i}.staged"));
                fs::write(&staged, content).map_err(|e| e.to_string())?;
                let parent = Path::new(path).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
                unix_lines.push(format!("mkdir -p {}", sh_quote(&parent)));
                unix_lines.push(format!("chmod 755 {}", sh_quote(&parent)));
                unix_lines.push(format!("install -m 644 {} {}", sh_quote(&staged.to_string_lossy()), sh_quote(path)));
            }
            Action::ImportReg { id, content, revert, needs_admin } => {
                let reg = stage.join(format!("{i}.reg"));
                write_reg(&reg, content)?;
                write_reg(&journal.revert_reg_path(id), revert)?;
                if *needs_admin {
                    win_admin.push(format!("reg import \"{}\"", reg.to_string_lossy()));
                } else {
                    Command::new("reg").args(["import", &reg.to_string_lossy()]).status().map_err(|e| e.to_string())?;
                }
            }
        }
    }
    if cfg!(target_os = "windows") {
        if !win_admin.is_empty() {
            let cmd_file = stage.join("apply.cmd");
            fs::write(&cmd_file, win_admin.join("\r\n")).map_err(|e| e.to_string())?;
            run_elevated_windows(&cmd_file)?;
        }
    } else if unix_lines.len() > 1 {
        if cfg!(target_os = "macos") {
            unix_lines.push("killall cfprefsd 2>/dev/null || true".into());
        }
        let script = stage.join("apply.sh");
        fs::write(&script, unix_lines.join("\n")).map_err(|e| e.to_string())?;
        run_elevated_unix(&script)?;
    }
    let _ = fs::remove_dir_all(&stage);
    Ok(())
}

pub fn revert(journal: &Journal, actions: &[Action]) -> Result<(), String> {
    let stage = stage_dir()?;
    let mut unix_lines: Vec<String> = vec!["set -eu".into()];
    let mut win_admin: Vec<String> = Vec::new();
    for action in actions {
        match action {
            Action::WriteFile { id, path, .. } => {
                if !target_allowed(path) {
                    continue;
                }
                let bak = journal.backup_path(id);
                if bak.exists() {
                    unix_lines.push(format!("install -m 644 {} {}", sh_quote(&bak.to_string_lossy()), sh_quote(path)));
                } else {
                    unix_lines.push(format!("rm -f {}", sh_quote(path)));
                }
            }
            Action::ImportReg { id, revert, needs_admin, .. } => {
                let reg = journal.revert_reg_path(id);
                if !reg.exists() {
                    write_reg(&reg, revert)?;
                }
                if *needs_admin {
                    win_admin.push(format!("reg import \"{}\"", reg.to_string_lossy()));
                } else {
                    Command::new("reg").args(["import", &reg.to_string_lossy()]).status().map_err(|e| e.to_string())?;
                }
            }
        }
    }
    if cfg!(target_os = "windows") {
        if !win_admin.is_empty() {
            let cmd_file = stage.join("revert.cmd");
            fs::write(&cmd_file, win_admin.join("\r\n")).map_err(|e| e.to_string())?;
            run_elevated_windows(&cmd_file)?;
        }
    } else if unix_lines.len() > 1 {
        if cfg!(target_os = "macos") {
            unix_lines.push("killall cfprefsd 2>/dev/null || true".into());
        }
        let script = stage.join("revert.sh");
        fs::write(&script, unix_lines.join("\n")).map_err(|e| e.to_string())?;
        run_elevated_unix(&script)?;
    }
    for action in actions {
        journal.clear(action.id());
    }
    let _ = fs::remove_dir_all(&stage);
    Ok(())
}

/// Parses the subset of .reg syntax that @aioff/policies emits: [KEY] then "name"=dword:X or "name"="string".
fn reg_expectations(content: &str) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    let mut key = String::new();
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            key = line[1..line.len() - 1].to_string();
        } else if line.starts_with('"') {
            if let Some((name, value)) = line.split_once("\"=") {
                out.push((key.clone(), name.trim_start_matches('"').to_string(), value.to_string()));
            }
        }
    }
    out
}

fn reg_value_matches(key: &str, name: &str, expected: &str) -> bool {
    let short = key.replace("HKEY_LOCAL_MACHINE", "HKLM").replace("HKEY_CURRENT_USER", "HKCU");
    let out = output_of("reg", &["query", &short, "/v", name]);
    if out.is_empty() {
        return false;
    }
    if let Some(hex) = expected.strip_prefix("dword:") {
        let want = u32::from_str_radix(hex, 16).unwrap_or(u32::MAX);
        return out.split_whitespace().any(|tok| tok.strip_prefix("0x").and_then(|h| u32::from_str_radix(h, 16).ok()) == Some(want));
    }
    let want = expected.trim_matches('"').replace("\\\\", "\\").replace("\\\"", "\"");
    out.contains(&want)
}

pub fn verify(actions: &[Action]) -> Vec<ActionReport> {
    actions
        .iter()
        .map(|action| match action {
            Action::WriteFile { id, path, content, .. } => {
                let applied = fs::read_to_string(path).map(|on_disk| on_disk == *content).unwrap_or(false);
                let detail = if applied { "in place".to_string() } else if Path::new(path).exists() { "present but different".to_string() } else { "missing".to_string() };
                ActionReport { id: id.clone(), ok: true, applied, detail }
            }
            Action::ImportReg { id, content, .. } => {
                let expectations = reg_expectations(content);
                let missing: Vec<String> = expectations.iter().filter(|(k, n, v)| !reg_value_matches(k, n, v)).map(|(_, n, _)| n.clone()).collect();
                ActionReport { id: id.clone(), ok: true, applied: !expectations.is_empty() && missing.is_empty(), detail: if missing.is_empty() { "in place".into() } else { format!("not set: {}", missing.join(", ")) } }
            }
        })
        .collect()
}

pub fn open_path(target: &str) -> Result<(), String> {
    let status = match platform() {
        "macos" => Command::new("open").arg(target).status(),
        "windows" => Command::new("cmd").args(["/c", "start", "", target]).status(),
        _ => Command::new("xdg-open").arg(target).status(),
    }
    .map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err("could not open".into()) }
}

pub fn run_windows_command(shell: &str, command: &str, needs_admin: bool) -> Result<String, String> {
    if !cfg!(target_os = "windows") {
        return Err("Windows only".into());
    }
    if shell == "uri" {
        return open_path(command).map(|_| "opened".into());
    }
    let ps = if needs_admin {
        format!("Start-Process powershell -ArgumentList '-NoProfile','-Command',{} -Verb RunAs -Wait", format!("'{}'", command.replace('\'', "''")))
    } else {
        command.to_string()
    };
    let out = Command::new("powershell").args(["-NoProfile", "-Command", &ps]).output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
