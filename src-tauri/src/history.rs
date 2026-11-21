use crate::vault::{self, Vault};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const KEEP: usize = 50;
const MS_DIGITS: usize = 16;

static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HistoryEntry {
    pub id: String,
    pub created_ms: u64,
    pub reason: String,
    pub bytes: u64,
}

#[derive(Serialize, Deserialize)]
struct Meta {
    reason: String,
}

pub struct History {
    dir: PathBuf,
    vault: Vault,
}

const MAX_KEY_BYTES: usize = 200;
const HASHED_KEY_PREFIX: usize = 120;

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |hash, byte| (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3))
}

fn encode_key(rel: &str) -> String {
    let encoded = percent_encode(rel);
    if encoded.len() <= MAX_KEY_BYTES {
        return encoded;
    }
    let mut cut = HASHED_KEY_PREFIX;
    while !encoded.is_char_boundary(cut) {
        cut -= 1;
    }
    let cut = encoded[..cut].rfind('%').filter(|at| *at + 3 > cut).unwrap_or(cut);
    format!("{}~{:016x}", &encoded[..cut], fnv1a(rel.as_bytes()))
}

fn percent_encode(rel: &str) -> String {
    let mut out = String::new();
    for byte in rel.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn parse_id(id: &str) -> Option<(u64, u32)> {
    let (ms, counter) = id.split_once('-')?;
    if ms.len() != MS_DIGITS || counter.len() != 4 {
        return None;
    }
    Some((ms.parse().ok()?, counter.parse().ok()?))
}

fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let name = target.file_name().and_then(|n| n.to_str()).unwrap_or("snapshot");
    let tmp = target.with_file_name(format!(".{name}.{nanos}.tmp"));
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

impl History {
    pub fn new(dir: PathBuf, vault_root: PathBuf) -> Self {
        Self { dir, vault: Vault::new(vault_root) }
    }

    fn note_dir(&self, rel: &str) -> Result<PathBuf, String> {
        self.vault.validate_note_path(rel)?;
        Ok(self.dir.join(encode_key(rel)))
    }

    fn ids(dir: &Path) -> Vec<String> {
        let Ok(read) = fs::read_dir(dir) else { return Vec::new() };
        let mut ids: Vec<String> = read
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter_map(|name| name.strip_suffix(".md").map(str::to_string))
            .filter(|id| parse_id(id).is_some())
            .collect();
        ids.sort();
        ids
    }

    fn entry(dir: &Path, id: &str) -> Option<HistoryEntry> {
        let (created_ms, _) = parse_id(id)?;
        let bytes = fs::metadata(dir.join(format!("{id}.md"))).ok()?.len();
        let reason = fs::read_to_string(dir.join(format!("{id}.json")))
            .ok()
            .and_then(|raw| serde_json::from_str::<Meta>(&raw).ok())
            .map(|m| m.reason)
            .unwrap_or_default();
        Some(HistoryEntry { id: id.to_string(), created_ms, reason, bytes })
    }

    pub fn save(&self, rel: &str, content: &str, reason: &str) -> Result<HistoryEntry, String> {
        let dir = self.note_dir(rel)?;
        let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let now = now_ms();
        let (ms, counter) = match Self::ids(&dir).last().and_then(|id| parse_id(id)) {
            Some((last_ms, last_counter)) if last_ms >= now => (last_ms, last_counter + 1),
            _ => (now, 0),
        };
        if counter > 9999 {
            return Err("too many snapshots in one millisecond".to_string());
        }
        let id = format!("{ms:0width$}-{counter:04}", width = MS_DIGITS);
        let meta = serde_json::to_vec(&Meta { reason: reason.to_string() }).map_err(|e| e.to_string())?;
        write_atomic(&dir.join(format!("{id}.json")), &meta)?;
        write_atomic(&dir.join(format!("{id}.md")), content.as_bytes())?;
        Self::prune(&dir);
        Self::entry(&dir, &id).ok_or_else(|| "snapshot was not written".to_string())
    }

    fn prune(dir: &Path) {
        let all = Self::ids(dir);
        for stale in all.iter().take(all.len().saturating_sub(KEEP)) {
            let _ = fs::remove_file(dir.join(format!("{stale}.md")));
            let _ = fs::remove_file(dir.join(format!("{stale}.json")));
        }
    }

    fn free_id(dir: &Path, id: &str) -> Result<String, String> {
        let (ms, _) = parse_id(id).ok_or_else(|| format!("invalid snapshot id: {id}"))?;
        (0..=9999)
            .map(|counter| format!("{ms:0width$}-{counter:04}", width = MS_DIGITS))
            .find(|candidate| !dir.join(format!("{candidate}.md")).exists())
            .ok_or_else(|| "no free snapshot id".to_string())
    }

    pub fn list(&self, rel: &str) -> Result<Vec<HistoryEntry>, String> {
        let dir = self.note_dir(rel)?;
        let mut ids = Self::ids(&dir);
        ids.reverse();
        Ok(ids.iter().filter_map(|id| Self::entry(&dir, id)).collect())
    }

    pub fn read(&self, rel: &str, id: &str) -> Result<String, String> {
        let dir = self.note_dir(rel)?;
        parse_id(id).ok_or_else(|| format!("invalid snapshot id: {id}"))?;
        fs::read_to_string(dir.join(format!("{id}.md"))).map_err(|e| format!("snapshot not found: {e}"))
    }

    pub fn move_to(&self, from: &str, to: &str) -> Result<(), String> {
        let source = self.note_dir(from)?;
        let target = self.note_dir(to)?;
        if source == target || !source.exists() {
            return Ok(());
        }
        let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        if !target.exists() {
            return fs::rename(&source, &target).map_err(|e| e.to_string());
        }
        for id in Self::ids(&source) {
            let new_id = if target.join(format!("{id}.md")).exists() {
                Self::free_id(&target, &id)?
            } else {
                id.clone()
            };
            let meta = source.join(format!("{id}.json"));
            if meta.exists() {
                fs::rename(&meta, target.join(format!("{new_id}.json"))).map_err(|e| e.to_string())?;
            }
            fs::rename(source.join(format!("{id}.md")), target.join(format!("{new_id}.md")))
                .map_err(|e| e.to_string())?;
        }
        let _ = fs::remove_dir_all(&source);
        Self::prune(&target);
        Ok(())
    }
}

pub fn move_history(app_data: &Path, vault_root: &Path, from: &str, to: &str) -> Result<(), String> {
    History::new(app_data.join("history"), vault_root.to_path_buf()).move_to(from, to)
}

fn open(app: &AppHandle) -> Result<History, String> {
    let vault = vault::open_vault(app)?;
    let dir = vault::settings_dir(app)?.join("history");
    Ok(History::new(dir, vault.root().to_path_buf()))
}

#[tauri::command(async)]
pub fn history_save(
    app: AppHandle,
    path: String,
    content: String,
    reason: String,
) -> Result<HistoryEntry, String> {
    open(&app)?.save(&path, &content, &reason)
}

#[tauri::command(async)]
pub fn history_list(app: AppHandle, path: String) -> Result<Vec<HistoryEntry>, String> {
    open(&app)?.list(&path)
}

#[tauri::command(async)]
pub fn history_read(app: AppHandle, path: String, id: String) -> Result<String, String> {
    open(&app)?.read(&path, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, TempDir, History) {
        let data = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let history = History::new(data.path().join("history"), vault.path().to_path_buf());
        (data, vault, history)
    }

    #[test]
    fn save_then_list_newest_first() {
        let (_d, _v, h) = store();
        let a = h.save("Inbox/a.md", "one", "before claude").unwrap();
        let b = h.save("Inbox/a.md", "two", "before restore").unwrap();
        let list = h.list("Inbox/a.md").unwrap();
        assert_eq!(list.iter().map(|e| e.id.clone()).collect::<Vec<_>>(), vec![b.id, a.id]);
        assert_eq!(list[0].reason, "before restore");
        assert_eq!(list[0].bytes, 3);
        assert!(list[0].created_ms >= list[1].created_ms);
    }

    #[test]
    fn read_returns_exact_bytes() {
        let (_d, _v, h) = store();
        let content = "héllo 🎉\r\nline two\r\n";
        let e = h.save("Inbox/a.md", content, "r").unwrap();
        assert_eq!(h.read("Inbox/a.md", &e.id).unwrap(), content);
    }

    #[test]
    fn keeps_only_newest_50() {
        let (_d, _v, h) = store();
        let mut last = None;
        for i in 0..55 {
            last = Some(h.save("Inbox/a.md", &format!("v{i}"), "r").unwrap());
        }
        let list = h.list("Inbox/a.md").unwrap();
        assert_eq!(list.len(), 50);
        assert_eq!(list[0].id, last.unwrap().id);
        assert_eq!(h.read("Inbox/a.md", &list[49].id).unwrap(), "v5");
    }

    #[test]
    fn ids_unique_within_same_ms() {
        let (_d, _v, h) = store();
        let mut ids: Vec<String> =
            (0..20).map(|_| h.save("Inbox/a.md", "x", "r").unwrap().id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 20);
    }

    #[test]
    fn move_history_follows_rename() {
        let (d, v, h) = store();
        h.save("Inbox/a.md", "one", "r").unwrap();
        h.save("Inbox/a.md", "two", "r").unwrap();
        move_history(d.path(), v.path(), "Inbox/a.md", "Notes/b.md").unwrap();
        assert_eq!(h.list("Notes/b.md").unwrap().len(), 2);
        assert!(h.list("Inbox/a.md").unwrap().is_empty());
    }

    #[test]
    fn move_history_merges_into_existing_target() {
        let (d, v, h) = store();
        h.save("Inbox/a.md", "one", "r").unwrap();
        h.save("Notes/b.md", "two", "r").unwrap();
        move_history(d.path(), v.path(), "Inbox/a.md", "Notes/b.md").unwrap();
        assert_eq!(h.list("Notes/b.md").unwrap().len(), 2);
    }

    #[test]
    fn rejects_invalid_note_path() {
        let (_d, _v, h) = store();
        for bad in ["../x.md", ".obsidian/x.md", "Inbox"] {
            assert!(h.save(bad, "x", "r").is_err(), "{bad}");
            assert!(h.list(bad).is_err(), "{bad}");
            assert!(h.read(bad, "0000000000000001-0000").is_err(), "{bad}");
        }
    }

    #[test]
    fn read_unknown_id_is_err() {
        let (_d, _v, h) = store();
        h.save("Inbox/a.md", "x", "r").unwrap();
        assert!(h.read("Inbox/a.md", "0000000000000001-0000").is_err());
        assert!(h.read("Inbox/a.md", "../../etc/passwd").is_err());
    }

    fn plant(dir: &Path, key: &str, id: &str, content: &str, reason: &str) {
        let note_dir = dir.join("history").join(encode_key(key));
        fs::create_dir_all(&note_dir).unwrap();
        fs::write(note_dir.join(format!("{id}.md")), content).unwrap();
        fs::write(note_dir.join(format!("{id}.json")), format!("{{\"reason\":\"{reason}\"}}")).unwrap();
    }

    #[test]
    fn merge_keeps_both_snapshots_with_colliding_ids() {
        let (d, v, h) = store();
        let id = "0000000000000001-0000";
        plant(d.path(), "Inbox/a.md", id, "from a", "reason a");
        plant(d.path(), "Notes/b.md", id, "from b", "reason b");
        move_history(d.path(), v.path(), "Inbox/a.md", "Notes/b.md").unwrap();
        let list = h.list("Notes/b.md").unwrap();
        assert_eq!(list.len(), 2);
        let mut pairs: Vec<(String, String)> = list
            .iter()
            .map(|e| (h.read("Notes/b.md", &e.id).unwrap(), e.reason.clone()))
            .collect();
        pairs.sort();
        assert_eq!(
            pairs,
            vec![
                ("from a".to_string(), "reason a".to_string()),
                ("from b".to_string(), "reason b".to_string())
            ]
        );
    }

    #[test]
    fn merge_prunes_to_newest_50() {
        let (d, v, h) = store();
        for _ in 0..30 {
            h.save("Inbox/a.md", "a", "r").unwrap();
            h.save("Notes/b.md", "b", "r").unwrap();
        }
        move_history(d.path(), v.path(), "Inbox/a.md", "Notes/b.md").unwrap();
        assert_eq!(h.list("Notes/b.md").unwrap().len(), 50);
    }

    #[test]
    fn long_non_ascii_path_still_has_history() {
        let (_d, _v, h) = store();
        let long = format!("Inbox/{}.md", "é".repeat(300));
        let other = format!("Inbox/{}x.md", "é".repeat(300));
        assert!(encode_key(&long).len() <= MAX_KEY_BYTES + 20);
        assert_ne!(encode_key(&long), encode_key(&other));
        let e = h.save(&long, "body", "r").unwrap();
        assert_eq!(h.read(&long, &e.id).unwrap(), "body");
        assert_eq!(h.list(&long).unwrap().len(), 1);
        assert!(h.list(&other).unwrap().is_empty());
    }
}
