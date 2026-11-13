use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub const DEBOUNCE: Duration = Duration::from_millis(300);

pub struct VaultWatcher {
    root: PathBuf,
    _watcher: RecommendedWatcher,
}

pub fn note_path(root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for component in rel.components() {
        let Component::Normal(part) = component else {
            return None;
        };
        let part = part.to_str()?;
        if part.starts_with('.') {
            return None;
        }
        parts.push(part);
    }
    let is_note = match parts.as_slice() {
        [] => false,
        [only] => only.ends_with(".md") && !crate::vault::is_reserved_root_file(only),
        [.., last] => last.ends_with(".md"),
    };
    is_note.then(|| parts.join("/"))
}

pub fn watch(
    root: &Path,
    on_change: impl Fn(Vec<String>) + Send + 'static,
) -> Result<VaultWatcher, String> {
    // FSEvents reports resolved paths (/private/var/...), so the prefix must be the canonical root.
    let root = root
        .canonicalize()
        .map_err(|e| format!("{}: {e}", root.display()))?;
    let (tx, rx) = mpsc::channel::<Event>();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        if let Ok(event) = result {
            let _ = tx.send(event);
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    let thread_root = root.clone();
    std::thread::spawn(move || {
        let collect = |event: Event, paths: &mut BTreeSet<String>| {
            if matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            paths.extend(
                event
                    .paths
                    .iter()
                    .filter_map(|p| note_path(&thread_root, p)),
            );
        };
        while let Ok(first) = rx.recv() {
            let mut paths = BTreeSet::new();
            collect(first, &mut paths);
            loop {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(event) => collect(event, &mut paths),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            if !paths.is_empty() {
                on_change(paths.into_iter().collect());
            }
        }
    });
    Ok(VaultWatcher {
        root,
        _watcher: watcher,
    })
}

#[derive(Default)]
pub struct WatcherState(Mutex<Option<VaultWatcher>>);

#[derive(Clone, serde::Serialize)]
struct VaultChanged {
    paths: Vec<String>,
}

#[tauri::command(async)]
pub fn watch_vault(app: AppHandle, state: State<'_, WatcherState>) -> Result<(), String> {
    let vault = crate::vault::open_vault(&app)?;
    let root = vault.root().canonicalize().map_err(|e| e.to_string())?;
    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    if current.as_ref().is_some_and(|w| w.root == root) {
        return Ok(());
    }
    let emitter = app.clone();
    let watcher = watch(vault.root(), move |paths| {
        let _ = emitter.emit("vault-changed", VaultChanged { paths });
    })?;
    *current = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc::{self, Receiver};
    use std::time::{Duration, Instant};
    use tempfile::TempDir;

    fn temp_vault() -> TempDir {
        let dir = TempDir::new().unwrap();
        for folder in ["Inbox", "People", ".obsidian"] {
            fs::create_dir_all(dir.path().join(folder)).unwrap();
        }
        dir
    }

    fn start(root: &Path) -> (VaultWatcher, Receiver<Vec<String>>) {
        let (tx, rx) = mpsc::channel();
        let watcher = watch(root, move |paths| {
            let _ = tx.send(paths);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        (watcher, rx)
    }

    fn batches_until(rx: &Receiver<Vec<String>>, wanted: &str) -> Vec<Vec<String>> {
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut batches = Vec::new();
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(batch) => {
                    let done = batch.iter().any(|p| p == wanted);
                    batches.push(batch);
                    if done {
                        return batches;
                    }
                }
                Err(_) => break,
            }
        }
        panic!("{wanted} was not reported within 2 s, got {batches:?}");
    }

    #[test]
    fn note_path_keeps_only_listable_notes() {
        let root = Path::new("/vault");
        assert_eq!(
            note_path(root, &root.join("Inbox/a.md")),
            Some("Inbox/a.md".into())
        );
        assert_eq!(
            note_path(root, &root.join("Inbox/Sub/b.md")),
            Some("Inbox/Sub/b.md".into())
        );
        assert_eq!(note_path(root, &root.join("Root.md")), Some("Root.md".into()));
        assert_eq!(
            note_path(root, &root.join("Clippings/c.md")),
            Some("Clippings/c.md".into())
        );
        assert_eq!(note_path(root, &root.join("CLAUDE.md")), None);
        assert_eq!(note_path(root, &root.join("claude.md")), None);
        assert_eq!(note_path(root, &root.join(".obsidian/x.md")), None);
        assert_eq!(note_path(root, &root.join("Inbox/.hidden/x.md")), None);
        assert_eq!(note_path(root, &root.join("Inbox/.a.md.icloud")), None);
        assert_eq!(note_path(root, &root.join("Inbox/.tack-42.tmp")), None);
        assert_eq!(note_path(root, &root.join("Inbox/notes.txt")), None);
        assert_eq!(note_path(root, &root.join("Inbox")), None);
        assert_eq!(note_path(root, Path::new("/elsewhere/Inbox/a.md")), None);
    }

    #[test]
    fn watcher_reports_relative_paths() {
        let vault = temp_vault();
        let (_watcher, rx) = start(vault.path());
        fs::write(vault.path().join("Inbox/a.md"), "hello").unwrap();
        let batches = batches_until(&rx, "Inbox/a.md");
        assert!(
            batches.iter().flatten().all(|p| p == "Inbox/a.md"),
            "{batches:?}"
        );
    }

    #[test]
    fn watcher_skips_hidden_folders_placeholders_and_temp_files() {
        let vault = temp_vault();
        let (_watcher, rx) = start(vault.path());
        fs::write(vault.path().join(".obsidian/workspace.md"), "x").unwrap();
        fs::write(vault.path().join("Inbox/.tack-1.tmp"), "x").unwrap();
        fs::write(vault.path().join("Inbox/.b.md.icloud"), "x").unwrap();
        fs::write(vault.path().join("CLAUDE.md"), "x").unwrap();
        std::thread::sleep(Duration::from_millis(50));
        fs::write(vault.path().join("People/c.md"), "x").unwrap();
        let batches = batches_until(&rx, "People/c.md");
        assert!(
            batches.iter().flatten().all(|p| p == "People/c.md"),
            "{batches:?}"
        );
    }

    #[test]
    fn watcher_reports_real_path_when_placeholder_is_downloaded() {
        let vault = temp_vault();
        let placeholder = vault.path().join("Inbox/.d.md.icloud");
        fs::write(&placeholder, "stub").unwrap();
        let (_watcher, rx) = start(vault.path());
        fs::write(vault.path().join("Inbox/d.md"), "real").unwrap();
        fs::remove_file(&placeholder).unwrap();
        let batches = batches_until(&rx, "Inbox/d.md");
        assert!(
            batches.iter().flatten().all(|p| p == "Inbox/d.md"),
            "{batches:?}"
        );
    }

    #[test]
    fn watcher_debounces_a_burst_into_one_batch() {
        let vault = temp_vault();
        let (_watcher, rx) = start(vault.path());
        for name in ["e1", "e2", "e3"] {
            fs::write(vault.path().join(format!("Inbox/{name}.md")), "x").unwrap();
            std::thread::sleep(Duration::from_millis(50));
        }
        let batch = rx.recv_timeout(Duration::from_secs(2)).expect("no batch");
        assert_eq!(batch, vec!["Inbox/e1.md", "Inbox/e2.md", "Inbox/e3.md"]);
    }
}
