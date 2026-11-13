use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

pub fn placeholder_target(file_name: &str) -> Option<String> {
    let inner = file_name.strip_prefix('.')?.strip_suffix(".icloud")?;
    if inner.ends_with(".md") && inner.len() > 3 {
        Some(inner.to_string())
    } else {
        None
    }
}

pub fn placeholder_path(path: &Path) -> Option<std::path::PathBuf> {
    let name = path.file_name()?.to_str()?;
    Some(path.with_file_name(format!(".{name}.icloud")))
}

pub fn ensure_downloaded(path: &Path, timeout: Duration) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let status = Command::new("brctl")
        .arg("download")
        .arg(path)
        .status()
        .map_err(|e| format!("brctl failed to start: {e}"))?;
    if !status.success() {
        return Err(format!("brctl download exited with {status}"));
    }
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if path.exists() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(format!("timed out downloading {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_target_maps_icloud_names() {
        assert_eq!(placeholder_target(".Foo.md.icloud"), Some("Foo.md".into()));
        assert_eq!(placeholder_target(".My Note.md.icloud"), Some("My Note.md".into()));
        assert_eq!(placeholder_target("Foo.md"), None);
        assert_eq!(placeholder_target(".Foo.png.icloud"), None);
        assert_eq!(placeholder_target(".md.icloud"), None);
        assert_eq!(placeholder_target(".hidden"), None);
    }
}
