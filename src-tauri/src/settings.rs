use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub vault_root: Option<String>,
    pub capture_hotkey: String,
    pub grammar_enabled: bool,
    pub always_on_top: bool,
    pub pinned: Vec<String>,
    pub claude_path: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            vault_root: None,
            capture_hotkey: "Alt+Space".to_string(),
            grammar_enabled: true,
            always_on_top: false,
            pinned: Vec::new(),
            claude_path: None,
        }
    }
}

const FILE_NAME: &str = "settings.json";

pub fn load(dir: &Path) -> Settings {
    fs::read_to_string(dir.join(FILE_NAME))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, settings: &Settings) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let tmp = dir.join(format!(".{FILE_NAME}.{}.{nanos}.tmp", std::process::id()));
    fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(FILE_NAME)).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_defaults_and_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let defaults = load(dir.path());
        assert_eq!(defaults.vault_root, None);
        assert_eq!(defaults.capture_hotkey, "Alt+Space");
        assert!(defaults.grammar_enabled);
        assert!(!defaults.always_on_top);
        assert!(defaults.pinned.is_empty());
        assert_eq!(defaults.claude_path, None);

        let changed = Settings {
            vault_root: Some("/tmp/v".into()),
            capture_hotkey: "Alt+N".into(),
            grammar_enabled: false,
            always_on_top: true,
            pinned: vec!["Inbox/a.md".into()],
            claude_path: Some("/opt/homebrew/bin/claude".into()),
        };
        save(dir.path(), &changed).unwrap();
        assert_eq!(load(dir.path()), changed);
    }

    #[test]
    fn settings_without_claude_path_still_load() {
        let dir = tempfile::tempdir().unwrap();
        let old = r#"{"vault_root":"/v","capture_hotkey":"Alt+N","grammar_enabled":false,"always_on_top":true,"pinned":["a.md"]}"#;
        fs::write(dir.path().join(FILE_NAME), old).unwrap();
        let loaded = load(dir.path());
        assert_eq!(loaded.vault_root.as_deref(), Some("/v"));
        assert_eq!(loaded.capture_hotkey, "Alt+N");
        assert_eq!(loaded.claude_path, None);
    }

    #[test]
    fn save_replaces_the_file_through_a_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join(FILE_NAME);
        fs::write(&target, "{}").unwrap();
        let before = fs::metadata(&target).unwrap();
        save(dir.path(), &Settings::default()).unwrap();
        let after = fs::metadata(&target).unwrap();
        use std::os::unix::fs::MetadataExt;
        assert_ne!(before.ino(), after.ino(), "settings must be renamed into place, not rewritten");
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names, vec![FILE_NAME.to_string()]);
        assert_eq!(load(dir.path()), Settings::default());
    }
}
