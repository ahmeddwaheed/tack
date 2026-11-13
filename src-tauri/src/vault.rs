use crate::icloud;
use crate::names;
use crate::settings::{self, Settings};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const FOLDERS: [&str; 6] = ["Inbox", "Meetings", "People", "Projects", "Knowledge", "Weekly"];

pub fn is_reserved_root_file(name: &str) -> bool {
    name.eq_ignore_ascii_case("CLAUDE.md")
}
const CLAUDE_MD: &str = include_str!("../templates/CLAUDE.md");
pub const CONFLICT_PREFIX: &str = "CONFLICT:";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize)]
pub struct VaultStatus {
    pub root: String,
    pub exists: bool,
    pub container_exists: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteMeta {
    pub path: String,
    pub title: String,
    pub folder: String,
    pub modified_ms: u64,
    pub placeholder: bool,
}

pub struct Vault {
    root: PathBuf,
}

impl Vault {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn default_root() -> Result<PathBuf, String> {
        let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
        Ok(PathBuf::from(home).join("Library/Mobile Documents/iCloud~md~obsidian/Documents/Tack"))
    }

    fn resolve(&self, rel: &str) -> Result<(PathBuf, Vec<String>), String> {
        let mut parts = Vec::new();
        for component in Path::new(rel).components() {
            match component {
                Component::Normal(part) => {
                    let part = part.to_string_lossy();
                    if part.starts_with('.') {
                        return Err(format!("hidden path segment: {rel}"));
                    }
                    parts.push(part.into_owned());
                }
                Component::CurDir => {}
                _ => return Err(format!("path escapes the vault: {rel}")),
            }
        }
        let mut out = self.root.clone();
        out.extend(&parts);
        Ok((out, parts))
    }

    fn resolve_folder(&self, rel: &str) -> Result<PathBuf, String> {
        let (abs, parts) = self.resolve(rel)?;
        match parts.first() {
            Some(first) if FOLDERS.contains(&first.as_str()) => Ok(abs),
            _ => Err(format!("path is not inside a vault folder: {rel}")),
        }
    }

    fn resolve_note(&self, rel: &str) -> Result<PathBuf, String> {
        let (abs, parts) = self.resolve(rel)?;
        let reserved = matches!(parts.as_slice(), [only] if is_reserved_root_file(only));
        let is_note = !parts.is_empty()
            && !reserved
            && abs.extension().is_some_and(|e| e == "md")
            && !abs.is_dir();
        if is_note {
            Ok(abs)
        } else {
            Err(format!("not a note path: {rel}"))
        }
    }

    fn relative(&self, abs: &Path) -> String {
        abs.strip_prefix(&self.root)
            .unwrap_or(abs)
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/")
    }

    fn meta_for(&self, abs: &Path, placeholder: bool) -> Result<NoteMeta, String> {
        let probe = if placeholder {
            icloud::placeholder_path(abs).ok_or("invalid note path")?
        } else {
            abs.to_path_buf()
        };
        let modified_ms = fs::metadata(&probe)
            .and_then(|m| m.modified())
            .map_err(|e| e.to_string())?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let rel = self.relative(abs);
        let folder = rel.rsplit_once('/').map(|(f, _)| f.to_string()).unwrap_or_default();
        let title = abs
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        Ok(NoteMeta { path: rel, title, folder, modified_ms, placeholder })
    }

    pub fn status(&self) -> VaultStatus {
        VaultStatus {
            root: self.root.to_string_lossy().into_owned(),
            exists: self.root.is_dir(),
            container_exists: self.container_exists(),
        }
    }

    fn container_exists(&self) -> bool {
        self.root.parent().is_some_and(Path::is_dir)
    }

    pub fn init(&self) -> Result<(), String> {
        if !self.root.is_dir() && !self.container_exists() {
            return Err(format!(
                "{} does not exist yet. Create the vault in Obsidian first and wait for it to appear on this Mac.",
                self.root.parent().unwrap_or(&self.root).display()
            ));
        }
        for folder in FOLDERS {
            fs::create_dir_all(self.root.join(folder)).map_err(|e| e.to_string())?;
        }
        let claude = self.root.join("CLAUDE.md");
        let in_icloud = icloud::placeholder_path(&claude).is_some_and(|p| p.exists());
        if in_icloud {
            return Ok(());
        }
        match fs::OpenOptions::new().write(true).create_new(true).open(&claude) {
            Ok(mut file) => {
                use std::io::Write;
                file.write_all(CLAUDE_MD.as_bytes()).map_err(|e| e.to_string())
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn list(&self) -> Result<Vec<NoteMeta>, String> {
        let mut notes = Vec::new();
        if self.root.is_dir() {
            self.walk(&self.root, &mut notes)?;
        }
        Ok(notes)
    }

    fn walk(&self, dir: &Path, notes: &mut Vec<NoteMeta>) -> Result<(), String> {
        let at_root = dir == self.root;
        let listable = |name: &str| !(at_root && is_reserved_root_file(name));
        let mut real = Vec::new();
        let mut placeholders = Vec::new();
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let Ok(entry) = entry else { continue };
            let Ok(file_type) = entry.file_type() else { continue };
            let name = entry.file_name().to_string_lossy().into_owned();
            if file_type.is_dir() {
                if !name.starts_with('.') {
                    let _ = self.walk(&entry.path(), notes);
                }
            } else if let Some(target) = icloud::placeholder_target(&name) {
                if !target.starts_with('.') && listable(&target) {
                    placeholders.push(dir.join(target));
                }
            } else if !name.starts_with('.') && name.ends_with(".md") && listable(&name) {
                real.push(entry.path());
            }
        }
        notes.extend(real.iter().filter_map(|path| self.meta_for(path, false).ok()));
        notes.extend(
            placeholders
                .iter()
                .filter(|path| !real.contains(path))
                .filter_map(|path| self.meta_for(path, true).ok()),
        );
        Ok(())
    }

    pub fn read(&self, rel: &str) -> Result<String, String> {
        self.read_with_timeout(rel, DOWNLOAD_TIMEOUT)
    }

    pub fn read_with_timeout(&self, rel: &str, timeout: Duration) -> Result<String, String> {
        let abs = self.resolve_note(rel)?;
        if !abs.exists() {
            let is_placeholder = icloud::placeholder_path(&abs).is_some_and(|p| p.exists());
            if is_placeholder {
                icloud::ensure_downloaded(&abs, timeout)?;
            }
        }
        fs::read_to_string(&abs).map_err(|e| format!("{rel}: {e}"))
    }

    pub fn write(&self, rel: &str, content: &str) -> Result<NoteMeta, String> {
        self.write_expecting(rel, content, None)
    }

    pub fn write_expecting(
        &self,
        rel: &str,
        content: &str,
        expected: Option<&str>,
    ) -> Result<NoteMeta, String> {
        let abs = self.resolve_note(rel)?;
        if !abs.exists() && icloud::placeholder_path(&abs).is_some_and(|p| p.exists()) {
            return Err(format!("{rel} is not downloaded from iCloud yet"));
        }
        let dir = abs.parent().ok_or("invalid note path")?;
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let tmp = dir.join(format!(".tack-{}.tmp", std::process::id()));
        let tmp = unique_tmp(tmp);
        fs::write(&tmp, content).map_err(|e| e.to_string())?;
        // Checked as late as possible, right before the rename, to keep the race window with other devices small.
        if let Some(expected) = expected
            && let Ok(current) = fs::read(&abs)
            && current != expected.as_bytes()
        {
            let _ = fs::remove_file(&tmp);
            return Err(format!("{CONFLICT_PREFIX} {rel} changed on disk"));
        }
        if let Err(e) = fs::rename(&tmp, &abs) {
            let _ = fs::remove_file(&tmp);
            return Err(e.to_string());
        }
        self.meta_for(&abs, false)
    }

    pub fn create(&self, folder: &str, title: &str, content: &str) -> Result<NoteMeta, String> {
        let dir = self.resolve_folder(folder)?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let target = names::unique_path(&dir, &names::safe_title(title));
        let rel = self.relative(&target);
        self.write_new(&rel, content)
    }

    fn write_new(&self, rel: &str, content: &str) -> Result<NoteMeta, String> {
        let abs = self.resolve_note(rel)?;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&abs)
            .map_err(|e| e.to_string())?;
        self.write(rel, content)
    }

    pub fn rename(&self, rel: &str, new_title: &str) -> Result<NoteMeta, String> {
        let abs = self.resolve_note(rel)?;
        let safe = names::safe_title(new_title);
        let current = abs.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
        if current == safe {
            return self.meta_for(&abs, false);
        }
        let dir = abs.parent().ok_or("invalid note path")?;
        let target = names::unique_path(dir, &safe);
        self.resolve_note(&self.relative(&target))?;
        fs::rename(&abs, &target).map_err(|e| e.to_string())?;
        self.meta_for(&target, false)
    }

    pub fn move_to(&self, rel: &str, folder: &str) -> Result<NoteMeta, String> {
        let abs = self.resolve_note(rel)?;
        let dir = self.resolve_folder(folder)?;
        if abs.parent() == Some(dir.as_path()) {
            return self.meta_for(&abs, false);
        }
        let stem = abs.file_stem().and_then(|s| s.to_str()).ok_or("invalid note path")?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let target = names::unique_path(&dir, stem);
        fs::rename(&abs, &target).map_err(|e| e.to_string())?;
        self.meta_for(&target, false)
    }

    pub fn trash(&self, rel: &str) -> Result<(), String> {
        let abs = self.resolve_note(rel)?;
        trash::delete(&abs).map_err(|e| e.to_string())
    }
}

fn unique_tmp(base: PathBuf) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let name = base.file_name().and_then(|n| n.to_str()).unwrap_or(".tack.tmp").to_string();
    base.with_file_name(format!("{name}.{nanos}"))
}

pub(crate) fn settings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

pub(crate) fn open_vault(app: &AppHandle) -> Result<Vault, String> {
    let root = match settings::load(&settings_dir(app)?).vault_root {
        Some(root) => PathBuf::from(root),
        None => Vault::default_root()?,
    };
    Ok(Vault::new(root))
}

#[tauri::command(async)]
pub fn vault_status(app: AppHandle) -> Result<VaultStatus, String> {
    Ok(open_vault(&app)?.status())
}

#[tauri::command(async)]
pub fn vault_init(app: AppHandle) -> Result<(), String> {
    open_vault(&app)?.init()
}

#[tauri::command(async)]
pub fn list_notes(app: AppHandle) -> Result<Vec<NoteMeta>, String> {
    open_vault(&app)?.list()
}

#[tauri::command]
pub async fn read_note(app: AppHandle, path: String) -> Result<String, String> {
    // Reading a cloud-only note waits for brctl, which must not hold an async worker.
    tauri::async_runtime::spawn_blocking(move || open_vault(&app)?.read(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub fn write_note(
    app: AppHandle,
    path: String,
    content: String,
    expected: Option<String>,
) -> Result<NoteMeta, String> {
    open_vault(&app)?.write_expecting(&path, &content, expected.as_deref())
}

#[tauri::command(async)]
pub fn create_note(
    app: AppHandle,
    folder: String,
    title: String,
    content: String,
) -> Result<NoteMeta, String> {
    open_vault(&app)?.create(&folder, &title, &content)
}

#[tauri::command(async)]
pub fn rename_note(app: AppHandle, path: String, new_title: String) -> Result<NoteMeta, String> {
    open_vault(&app)?.rename(&path, &new_title)
}

#[tauri::command(async)]
pub fn move_note(app: AppHandle, path: String, folder: String) -> Result<NoteMeta, String> {
    open_vault(&app)?.move_to(&path, &folder)
}

#[tauri::command(async)]
pub fn trash_note(app: AppHandle, path: String) -> Result<(), String> {
    open_vault(&app)?.trash(&path)
}

#[tauri::command(async)]
pub fn get_settings(app: AppHandle) -> Result<Settings, String> {
    Ok(settings::load(&settings_dir(&app)?))
}

#[tauri::command(async)]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    settings::save(&settings_dir(&app)?, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn vault() -> (TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::new(dir.path().to_path_buf());
        (dir, v)
    }

    #[test]
    fn init_creates_folders_and_claude_md() {
        let (dir, v) = vault();
        v.init().unwrap();
        for f in FOLDERS {
            assert!(dir.path().join(f).is_dir(), "{f}");
        }
        assert!(dir.path().join("CLAUDE.md").is_file());
        fs::write(dir.path().join("CLAUDE.md"), "edited").unwrap();
        v.init().unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("CLAUDE.md")).unwrap(), "edited");
    }

    #[test]
    fn init_keeps_a_claude_md_that_is_still_in_icloud() {
        let (dir, v) = vault();
        fs::write(dir.path().join(".CLAUDE.md.icloud"), "stub").unwrap();
        v.init().unwrap();
        assert!(!dir.path().join("CLAUDE.md").exists());
        assert_eq!(fs::read_to_string(dir.path().join(".CLAUDE.md.icloud")).unwrap(), "stub");
    }

    #[test]
    fn init_refuses_to_create_the_icloud_container() {
        let (dir, _) = vault();
        let v = Vault::new(dir.path().join("iCloud~md~obsidian/Documents/Tack"));
        assert!(v.init().is_err());
        assert!(!dir.path().join("iCloud~md~obsidian").exists());
    }

    #[test]
    fn status_reports_whether_the_folder_around_the_vault_exists() {
        let (dir, _) = vault();
        let inside = Vault::new(dir.path().join("Tack"));
        assert!(!inside.status().exists);
        assert!(inside.status().container_exists);
        let missing = Vault::new(dir.path().join("iCloud~md~obsidian/Documents/Tack"));
        assert!(!missing.status().container_exists);
    }

    #[test]
    fn status_reports_existence() {
        let (dir, v) = vault();
        assert!(v.status().exists);
        let missing = Vault::new(dir.path().join("nope"));
        assert!(!missing.status().exists);
    }

    #[test]
    fn list_skips_hidden_and_non_md() {
        let (dir, v) = vault();
        v.init().unwrap();
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        fs::write(dir.path().join(".obsidian/x.md"), "").unwrap();
        fs::write(dir.path().join("Inbox/a.txt"), "").unwrap();
        fs::write(dir.path().join("Inbox/a.md"), "hi").unwrap();
        let notes = v.list().unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].path, "Inbox/a.md");
        assert_eq!(notes[0].title, "a");
        assert_eq!(notes[0].folder, "Inbox");
        assert!(!notes[0].placeholder);
    }

    #[test]
    fn list_marks_placeholder() {
        let (dir, v) = vault();
        v.init().unwrap();
        fs::write(dir.path().join("Inbox/.Idea.md.icloud"), "").unwrap();
        let notes = v.list().unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].path, "Inbox/Idea.md");
        assert_eq!(notes[0].title, "Idea");
        assert!(notes[0].placeholder);
    }

    #[test]
    fn list_prefers_real_file_over_placeholder() {
        let (dir, v) = vault();
        v.init().unwrap();
        fs::write(dir.path().join("Inbox/.Idea.md.icloud"), "").unwrap();
        fs::write(dir.path().join("Inbox/Idea.md"), "x").unwrap();
        let notes = v.list().unwrap();
        assert_eq!(notes.len(), 1);
        assert!(!notes[0].placeholder);
    }

    #[test]
    fn read_placeholder_without_download_is_err() {
        let (dir, v) = vault();
        v.init().unwrap();
        fs::write(dir.path().join("Inbox/.Idea.md.icloud"), "").unwrap();
        assert!(v.read_with_timeout("Inbox/Idea.md", std::time::Duration::from_millis(200)).is_err());
    }

    #[test]
    fn write_refuses_placeholder_target() {
        let (dir, v) = vault();
        v.init().unwrap();
        fs::write(dir.path().join("Inbox/.Idea.md.icloud"), "").unwrap();
        assert!(v.write("Inbox/Idea.md", "").is_err());
    }

    #[test]
    fn write_with_stale_expected_is_refused_and_file_unchanged() {
        let (dir, v) = vault();
        v.init().unwrap();
        v.write("Inbox/a.md", "theirs from the phone\n").unwrap();
        let err = v
            .write_expecting("Inbox/a.md", "mine\n", Some("what Tack read\n"))
            .unwrap_err();
        assert!(err.starts_with(CONFLICT_PREFIX), "{err}");
        assert_eq!(
            fs::read_to_string(dir.path().join("Inbox/a.md")).unwrap(),
            "theirs from the phone\n"
        );
        let leftovers: Vec<_> = fs::read_dir(dir.path().join("Inbox")).unwrap().collect();
        assert_eq!(leftovers.len(), 1);
    }

    #[test]
    fn write_with_matching_expected_succeeds() {
        let (dir, v) = vault();
        v.init().unwrap();
        v.write("Inbox/a.md", "what Tack read\n").unwrap();
        v.write_expecting("Inbox/a.md", "mine\n", Some("what Tack read\n")).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("Inbox/a.md")).unwrap(), "mine\n");
    }

    #[test]
    fn write_without_expected_overwrites() {
        let (dir, v) = vault();
        v.init().unwrap();
        v.write("Inbox/a.md", "old\n").unwrap();
        v.write_expecting("Inbox/a.md", "new\n", None).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("Inbox/a.md")).unwrap(), "new\n");
    }

    #[test]
    fn write_then_read_is_byte_identical() {
        let (dir, v) = vault();
        v.init().unwrap();
        let content = "line one\r\nline two 🚀\r\n";
        let meta = v.write("Inbox/a.md", content).unwrap();
        assert_eq!(meta.path, "Inbox/a.md");
        assert_eq!(v.read("Inbox/a.md").unwrap(), content);
        assert_eq!(fs::read(dir.path().join("Inbox/a.md")).unwrap(), content.as_bytes());
        let leftovers: Vec<_> = fs::read_dir(dir.path().join("Inbox")).unwrap().collect();
        assert_eq!(leftovers.len(), 1);
    }

    #[test]
    fn rejects_path_escape() {
        let (_dir, v) = vault();
        assert!(v.read("../secret.md").is_err());
        assert!(v.read("/etc/passwd").is_err());
        assert!(v.write("Inbox/../../x.md", "").is_err());
        assert!(v.create("../out", "t", "").is_err());
        assert!(v.move_to("Inbox/a.md", "..").is_err());
        assert!(v.trash("../x.md").is_err());
    }

    #[test]
    fn rejects_non_note_targets() {
        let (dir, v) = vault();
        v.init().unwrap();
        fs::create_dir_all(dir.path().join("Other/folder.md")).unwrap();
        for bad in ["", ".", "Inbox", "Inbox/", ".obsidian/x.md", "Inbox/.h.md", "Other/.h.md", "x.txt", "Inbox/x.txt", "CLAUDE.md", "claude.md", "Other/folder.md", "Other/../x.md"] {
            assert!(v.write(bad, "z").is_err(), "write {bad:?}");
            assert!(v.read(bad).is_err(), "read {bad:?}");
            assert!(v.trash(bad).is_err(), "trash {bad:?}");
            assert!(v.rename(bad, "n").is_err(), "rename {bad:?}");
            assert!(v.move_to(bad, "Inbox").is_err(), "move {bad:?}");
        }
        assert!(dir.path().join("Inbox").is_dir());
        assert!(!dir.path().join(".obsidian").exists());
        assert!(!dir.path().join("x.txt").exists());
    }

    #[test]
    fn notes_outside_the_six_folders_can_be_opened_and_saved() {
        let (dir, v) = vault();
        v.init().unwrap();
        fs::create_dir_all(dir.path().join("Clippings")).unwrap();
        fs::write(dir.path().join("Clippings/web.md"), "clip").unwrap();
        fs::write(dir.path().join("Untitled.md"), "root").unwrap();
        assert_eq!(v.read("Clippings/web.md").unwrap(), "clip");
        assert_eq!(v.read("Untitled.md").unwrap(), "root");
        v.write_expecting("Untitled.md", "root 2", Some("root")).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("Untitled.md")).unwrap(), "root 2");
        let renamed = v.rename("Untitled.md", "Idea").unwrap();
        assert_eq!(renamed.path, "Idea.md");
        assert_eq!(renamed.folder, "");
        let moved = v.move_to("Idea.md", "Inbox").unwrap();
        assert_eq!(moved.path, "Inbox/Idea.md");
        assert!(v.resolve_note("Clippings/web.md").is_ok(), "trash uses the same note check");
    }

    #[test]
    fn a_root_note_cannot_be_renamed_onto_claude_md() {
        let (dir, v) = vault();
        fs::write(dir.path().join("Untitled.md"), "root").unwrap();
        assert!(v.rename("Untitled.md", "CLAUDE").is_err());
        assert!(dir.path().join("Untitled.md").exists());
        assert!(!dir.path().join("CLAUDE.md").exists());
    }

    #[test]
    fn list_includes_root_notes_and_other_folders_but_not_claude_md() {
        let (dir, v) = vault();
        v.init().unwrap();
        fs::create_dir_all(dir.path().join("Clippings")).unwrap();
        fs::write(dir.path().join("Clippings/web.md"), "").unwrap();
        fs::write(dir.path().join("Untitled.md"), "").unwrap();
        fs::write(dir.path().join(".Phone.md.icloud"), "").unwrap();
        fs::write(dir.path().join(".CLAUDE.md.icloud"), "").unwrap();
        let mut notes: Vec<(String, String, bool)> =
            v.list().unwrap().into_iter().map(|n| (n.path, n.folder, n.placeholder)).collect();
        notes.sort();
        assert_eq!(
            notes,
            vec![
                ("Clippings/web.md".into(), "Clippings".into(), false),
                ("Phone.md".into(), "".into(), true),
                ("Untitled.md".into(), "".into(), false),
            ]
        );
    }

    #[test]
    fn list_skips_entries_it_cannot_read() {
        let (dir, v) = vault();
        v.init().unwrap();
        fs::write(dir.path().join("Inbox/a.md"), "hi").unwrap();
        std::os::unix::fs::symlink(dir.path().join("gone.md"), dir.path().join("Inbox/broken.md")).unwrap();
        let notes = v.list().unwrap();
        assert_eq!(notes.iter().map(|n| n.path.as_str()).collect::<Vec<_>>(), vec!["Inbox/a.md"]);
    }

    #[test]
    fn create_and_move_require_vault_folder() {
        let (_dir, v) = vault();
        v.init().unwrap();
        for bad in ["", ".", "Other", ".obsidian", "..", "Inbox/../Other"] {
            assert!(v.create(bad, "t", "").is_err(), "create {bad:?}");
        }
        let a = v.create("Inbox", "a", "").unwrap();
        assert!(v.move_to(&a.path, "Other").is_err());
        assert!(v.move_to(&a.path, "").is_err());
        let sub = v.create("Meetings/2026", "m", "").unwrap();
        assert_eq!(sub.path, "Meetings/2026/m.md");
        assert_eq!(v.move_to(&a.path, "Meetings/2026").unwrap().path, "Meetings/2026/a.md");
    }

    #[test]
    fn create_sanitizes_and_dedupes() {
        let (_dir, v) = vault();
        v.init().unwrap();
        let a = v.create("Inbox", "a/b:c", "one").unwrap();
        assert_eq!(a.path, "Inbox/a-b-c.md");
        let b = v.create("Inbox", "a/b:c", "two").unwrap();
        assert_eq!(b.path, "Inbox/a-b-c 2.md");
        assert_eq!(v.read(&a.path).unwrap(), "one");
        assert_eq!(v.read(&b.path).unwrap(), "two");
        let c = v.create("Inbox", "  ", "").unwrap();
        assert_eq!(c.title, "Untitled");
    }

    #[test]
    fn rename_keeps_content_and_folder() {
        let (_dir, v) = vault();
        v.init().unwrap();
        let a = v.create("Meetings", "old", "body\r\n").unwrap();
        let r = v.rename(&a.path, "new: name").unwrap();
        assert_eq!(r.path, "Meetings/new- name.md");
        assert_eq!(r.folder, "Meetings");
        assert_eq!(v.read(&r.path).unwrap(), "body\r\n");
        assert!(v.read(&a.path).is_err());
        let same = v.rename(&r.path, "new: name").unwrap();
        assert_eq!(same.path, r.path);
    }

    #[test]
    fn move_keeps_title() {
        let (_dir, v) = vault();
        v.init().unwrap();
        let a = v.create("Inbox", "idea", "x").unwrap();
        v.create("Projects", "idea", "other").unwrap();
        let m = v.move_to(&a.path, "Projects").unwrap();
        assert_eq!(m.path, "Projects/idea 2.md");
        assert_eq!(m.title, "idea 2");
        assert_eq!(v.read(&m.path).unwrap(), "x");
        let m2 = v.move_to(&m.path, "Knowledge").unwrap();
        assert_eq!(m2.path, "Knowledge/idea 2.md");
    }
}
