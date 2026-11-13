use std::path::{Path, PathBuf};

pub fn safe_title(input: &str) -> String {
    let mapped: String = input
        .chars()
        .filter_map(|c| match c {
            '/' | '\\' | ':' => Some('-'),
            '?' | '*' | '"' | '<' | '>' | '|' | '#' | '^' | '[' | ']' => None,
            c if c.is_control() => None,
            c => Some(c),
        })
        .collect();
    let collapsed = mapped.split_whitespace().collect::<Vec<_>>().join(" ");
    let collapsed = collapsed.trim_start_matches('.').trim_start().to_string();
    if collapsed.is_empty() {
        "Untitled".to_string()
    } else {
        collapsed
    }
}

pub fn unique_path(dir: &Path, title: &str) -> PathBuf {
    let first = dir.join(format!("{title}.md"));
    if !exists_or_placeholder(&first) {
        return first;
    }
    let mut counter = 2;
    loop {
        let candidate = dir.join(format!("{title} {counter}.md"));
        if !exists_or_placeholder(&candidate) {
            return candidate;
        }
        counter += 1;
    }
}

fn exists_or_placeholder(path: &Path) -> bool {
    if path.exists() {
        return true;
    }
    match (path.parent(), path.file_name().and_then(|n| n.to_str())) {
        (Some(dir), Some(name)) => dir.join(format!(".{name}.icloud")).exists(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn safe_title_replaces_unsafe_chars() {
        assert_eq!(safe_title("a/b:c?*\"<>|  d "), "a-b-c d");
        assert_eq!(safe_title(""), "Untitled");
        assert_eq!(safe_title(".idea"), "idea");
        assert_eq!(safe_title("..."), "Untitled");
        assert_eq!(safe_title("  \t "), "Untitled");
        assert_eq!(safe_title("Ship it 🚀"), "Ship it 🚀");
    }

    #[test]
    fn safe_title_drops_characters_that_break_wikilinks() {
        let title = safe_title("#idea [x] ^a");
        assert_eq!(title, "idea x a");
        assert!(!title.contains(['#', '^', '[', ']', '|']));
        assert_eq!(safe_title("[[Ann]] | 1:1"), "Ann 1-1");
    }

    #[test]
    fn unique_path_appends_counter() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(unique_path(dir.path(), "x"), dir.path().join("x.md"));
        fs::write(dir.path().join("x.md"), "").unwrap();
        assert_eq!(unique_path(dir.path(), "x"), dir.path().join("x 2.md"));
        fs::write(dir.path().join("x 2.md"), "").unwrap();
        assert_eq!(unique_path(dir.path(), "x"), dir.path().join("x 3.md"));
    }

    #[test]
    fn unique_path_treats_placeholder_as_taken() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".x.md.icloud"), "").unwrap();
        assert_eq!(unique_path(dir.path(), "x"), dir.path().join("x 2.md"));
    }
}
