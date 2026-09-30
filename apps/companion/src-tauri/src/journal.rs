//! The journal records what was on disk before AI Off touched it, so revert restores the
//! exact previous state instead of guessing.

use std::fs;
use std::path::{Path, PathBuf};

pub struct Journal {
    dir: PathBuf,
}

impl Journal {
    pub fn open(app_data: &Path) -> Result<Self, String> {
        let dir = app_data.join("journal");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(Self { dir })
    }

    fn safe(id: &str) -> String {
        id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect()
    }

    pub fn backup_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{}.bak", Self::safe(id)))
    }

    pub fn absent_marker(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{}.absent", Self::safe(id)))
    }

    pub fn revert_reg_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{}.revert.reg", Self::safe(id)))
    }

    /// Record the prior state of a file once. A second apply must not overwrite the first
    /// backup with AI Off's own output.
    pub fn record_file(&self, id: &str, target: &Path) -> Result<(), String> {
        let bak = self.backup_path(id);
        let absent = self.absent_marker(id);
        if bak.exists() || absent.exists() {
            return Ok(());
        }
        if target.exists() {
            fs::copy(target, &bak).map_err(|e| format!("backup {}: {e}", target.display()))?;
        } else {
            fs::write(&absent, b"").map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn clear(&self, id: &str) {
        let _ = fs::remove_file(self.backup_path(id));
        let _ = fs::remove_file(self.absent_marker(id));
        let _ = fs::remove_file(self.revert_reg_path(id));
    }
}
