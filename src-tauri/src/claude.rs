use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::process::{ExitStatus, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;

const ARGS: [&str; 10] = [
    "-p",
    "--safe-mode",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--tools",
    "",
    "--disallowedTools",
    "Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Read,Glob,Grep,Task",
];
const TIMEOUT: Duration = Duration::from_secs(120);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
const SHELL_LOOKUP_LIMIT: Duration = Duration::from_secs(5);
const PROGRESS_EVENT: &str = "claude-progress";
const MAX_PENDING_CANCELS: usize = 64;

const MISSING: &str = "CLAUDE_MISSING:";
const LOGIN: &str = "CLAUDE_LOGIN:";
const TIMED_OUT: &str = "CLAUDE_TIMEOUT:";
const CANCELLED: &str = "CLAUDE_CANCELLED:";
const FAILED: &str = "CLAUDE_FAILED:";

#[derive(Debug, Clone, PartialEq)]
pub enum StreamEvent {
    Text(String),
    Result { text: String, is_error: bool },
}

pub fn parse_stream_line(line: &str) -> Option<StreamEvent> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    match value.get("type")?.as_str()? {
        "assistant" => {
            let text: String = value
                .pointer("/message/content")?
                .as_array()?
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect();
            (!text.is_empty()).then_some(StreamEvent::Text(text))
        }
        "result" => Some(StreamEvent::Result {
            text: value.get("result").and_then(Value::as_str).unwrap_or_default().to_string(),
            is_error: value.get("is_error").and_then(Value::as_bool).unwrap_or(false),
        }),
        _ => None,
    }
}

pub fn classify_failure(stderr: &str, result_text: &str) -> &'static str {
    let haystack = format!("{stderr}\n{result_text}").to_lowercase();
    if ["login", "not logged in", "invalid api key"].iter().any(|word| haystack.contains(word)) {
        LOGIN
    } else {
        FAILED
    }
}

pub fn resolve_claude_path(settings_path: Option<&str>) -> Option<PathBuf> {
    settings_path
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(login_shell_claude)
        .or_else(|| fallback_paths().into_iter().find(|path| path.is_file()))
}

fn login_shell_claude() -> Option<PathBuf> {
    let mut child = std::process::Command::new("/bin/zsh")
        .args(["-lc", "command -v claude"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + SHELL_LOOKUP_LIMIT;
    while child.try_wait().ok()?.is_none() {
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let output = child.wait_with_output().ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .map(|line| PathBuf::from(line.trim()))
        .find(|path| path.is_absolute() && path.file_name().is_some_and(|name| name == "claude") && path.is_file())
}

fn fallback_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        paths.push(home.join(".claude/local/claude"));
        paths.push(home.join(".local/bin/claude"));
    }
    paths.push("/opt/homebrew/bin/claude".into());
    paths.push("/usr/local/bin/claude".into());
    paths
}

struct Running {
    cancel: Option<oneshot::Sender<()>>,
    group: Option<libc::pid_t>,
}

#[derive(Default)]
struct Inner {
    running: HashMap<String, Running>,
    pending_cancels: VecDeque<String>,
}

#[derive(Default)]
pub struct ClaudeState {
    inner: Mutex<Inner>,
}

pub struct Registration<'a> {
    state: &'a ClaudeState,
    id: String,
    cancelled: oneshot::Receiver<()>,
}

impl ClaudeState {
    fn inner(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn register(&self, id: &str) -> Registration<'_> {
        let (tx, rx) = oneshot::channel();
        let mut inner = self.inner();
        let cancel = match inner.pending_cancels.iter().position(|pending| pending == id) {
            Some(at) => {
                inner.pending_cancels.remove(at);
                let _ = tx.send(());
                None
            }
            None => Some(tx),
        };
        inner.running.insert(id.to_string(), Running { cancel, group: None });
        Registration { state: self, id: id.to_string(), cancelled: rx }
    }

    // A cancel can overtake its own request on the way in, so it is remembered until the request registers.
    pub fn cancel(&self, id: &str) {
        let mut inner = self.inner();
        match inner.running.get_mut(id) {
            Some(running) => {
                if let Some(tx) = running.cancel.take() {
                    let _ = tx.send(());
                }
            }
            None => {
                if inner.pending_cancels.len() >= MAX_PENDING_CANCELS {
                    inner.pending_cancels.pop_front();
                }
                inner.pending_cancels.push_back(id.to_string());
            }
        }
    }

    pub fn kill_all(&self) {
        for group in self.inner().running.values().filter_map(|running| running.group) {
            kill_group(group);
        }
    }

    fn set_group(&self, id: &str, group: Option<libc::pid_t>) {
        if let Some(running) = self.inner().running.get_mut(id) {
            running.group = group;
        }
    }
}

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        self.state.inner().running.remove(&self.id);
    }
}

fn kill_group(group: libc::pid_t) {
    unsafe {
        libc::killpg(group, libc::SIGKILL);
    }
}

pub struct RunOptions {
    pub program: PathBuf,
    pub timeout: Duration,
    pub env: Vec<(String, String)>,
}

enum Outcome {
    Finished(Result<String, String>),
    Cancelled,
    TimedOut,
}

pub async fn run_claude(
    registration: &mut Registration<'_>,
    prompt: &str,
    options: RunOptions,
    mut on_progress: impl FnMut(&str),
) -> Result<String, String> {
    if registration.cancelled.try_recv().is_ok() {
        return Err(format!("{CANCELLED} cancelled"));
    }
    let workdir = tempfile::Builder::new()
        .prefix("tack-claude-")
        .tempdir()
        .map_err(|e| format!("{FAILED} could not create a work folder: {e}"))?;
    let mut child = Command::new(&options.program)
        .args(ARGS)
        .envs(options.env)
        .current_dir(workdir.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied => {
                format!("{MISSING} could not start {}: {e}", options.program.display())
            }
            _ => format!("{FAILED} could not start Claude: {e}"),
        })?;
    let group = child.id().map(|pid| pid as libc::pid_t);
    registration.state.set_group(&registration.id, group);

    let outcome = tokio::select! {
        result = drive(&mut child, group, prompt, &mut on_progress) => Outcome::Finished(result),
        _ = &mut registration.cancelled => Outcome::Cancelled,
        _ = tokio::time::sleep(options.timeout) => Outcome::TimedOut,
    };
    registration.state.set_group(&registration.id, None);

    if !matches!(outcome, Outcome::Finished(_)) {
        // Claude spawns its own helpers; killing only the direct child would leave them running.
        // The group is only killed while its leader is unreaped, so the id cannot belong to someone else.
        if let Some(group) = group {
            kill_group(group);
        }
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
    drop(workdir);

    match outcome {
        Outcome::Finished(result) => result,
        Outcome::Cancelled => Err(format!("{CANCELLED} cancelled")),
        Outcome::TimedOut => Err(format!("{TIMED_OUT} Claude took longer than {} seconds", options.timeout.as_secs())),
    }
}

struct Throttle {
    last: Option<Instant>,
    pending: bool,
}

impl Throttle {
    fn offer(&mut self, text: &str, on_progress: &mut impl FnMut(&str)) {
        if self.last.is_none_or(|last| last.elapsed() >= PROGRESS_INTERVAL) {
            on_progress(text);
            self.last = Some(Instant::now());
            self.pending = false;
        } else {
            self.pending = true;
        }
    }

    fn flush(&mut self, text: &str, on_progress: &mut impl FnMut(&str)) {
        if self.pending {
            on_progress(text);
            self.pending = false;
        }
    }
}

async fn drive(
    child: &mut Child,
    group: Option<libc::pid_t>,
    prompt: &str, on_progress: &mut impl FnMut(&str),
) -> Result<String, String> {
    let (Some(mut stdin), Some(stdout), Some(mut stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        return Err(format!("{FAILED} Claude pipes are unavailable"));
    };
    let write = async move {
        let _ = stdin.write_all(prompt.as_bytes()).await;
        let _ = stdin.shutdown().await;
    };
    let read_stderr = async {
        let mut raw = Vec::new();
        let _ = stderr.read_to_end(&mut raw).await;
        String::from_utf8_lossy(&raw).into_owned()
    };
    let read_stdout = async {
        let mut reader = BufReader::new(stdout);
        let mut raw = Vec::new();
        let mut text = String::new();
        let mut result = None;
        let mut throttle = Throttle { last: None, pending: false };
        while reader.read_until(b'\n', &mut raw).await.is_ok_and(|read| read > 0) {
            match parse_stream_line(&String::from_utf8_lossy(&raw)) {
                Some(StreamEvent::Text(chunk)) => {
                    text.push_str(&chunk);
                    throttle.offer(&text, on_progress);
                }
                Some(StreamEvent::Result { text, is_error }) => result = Some((text, is_error)),
                None => {}
            }
            raw.clear();
        }
        throttle.flush(&text, on_progress);
        result
    };
    let ((), stderr, result) = tokio::join!(write, read_stderr, read_stdout);
    // The leader is still unreaped here, so its group id cannot have been reused.
    if let Some(group) = group {
        kill_group(group);
    }
    let status = child.wait().await.map_err(|e| format!("{FAILED} {e}"))?;
    finish(status, &stderr, result)
}

fn finish(status: ExitStatus, stderr: &str, result: Option<(String, bool)>) -> Result<String, String> {
    match result {
        Some((text, false)) => Ok(text),
        Some((text, true)) => Err(format!("{} {}", classify_failure(stderr, &text), text.trim())),
        None if status.success() => Err(format!("{FAILED} Claude returned no result")),
        None => {
            let detail = stderr.trim();
            let detail = if detail.is_empty() { format!("Claude exited with {status}") } else { detail.to_string() };
            Err(format!("{} {detail}", classify_failure(stderr, "")))
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    request_id: &'a str,
    text: &'a str,
}

#[tauri::command]
pub async fn ask_claude(
    app: AppHandle,
    state: State<'_, ClaudeState>,
    request_id: String,
    prompt: String,
) -> Result<String, String> {
    let mut registration = state.register(&request_id);
    let settings_path = crate::settings::load(&crate::vault::settings_dir(&app)?).claude_path;
    let lookup = tauri::async_runtime::spawn_blocking(move || resolve_claude_path(settings_path.as_deref()));
    let program = tokio::select! {
        found = lookup => found.ok().flatten(),
        _ = &mut registration.cancelled => return Err(format!("{CANCELLED} cancelled")),
    }
    .ok_or_else(|| format!("{MISSING} the claude command was not found"))?;
    let options = RunOptions { program, timeout: TIMEOUT, env: Vec::new() };
    run_claude(&mut registration, &prompt, options, |text| {
        let _ = app.emit_to("main", PROGRESS_EVENT, Progress { request_id: &request_id, text });
    })
    .await
}

#[tauri::command]
pub fn cancel_claude(state: State<'_, ClaudeState>, request_id: String) {
    state.cancel(&request_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::time::Instant;

    fn fake() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-claude.sh")
    }

    fn options(mode: &str, timeout: Duration) -> RunOptions {
        RunOptions {
            program: resolve_claude_path(Some(fake().to_str().unwrap())).unwrap(),
            timeout,
            env: vec![("FAKE_CLAUDE_MODE".into(), mode.into())],
        }
    }

    fn alive(pid: i32) -> bool {
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[test]
    fn parses_assistant_text() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hel"},{"type":"tool_use","id":"t"},{"type":"text","text":"lo"}]}}"#;
        assert_eq!(parse_stream_line(line), Some(StreamEvent::Text("Hello".into())));
    }

    #[test]
    fn parses_result_lines() {
        let ok = r#"{"type":"result","subtype":"success","is_error":false,"result":"Done"}"#;
        assert_eq!(parse_stream_line(ok), Some(StreamEvent::Result { text: "Done".into(), is_error: false }));
        let failed = r#"{"type":"result","subtype":"success","is_error":true,"result":"Invalid API key"}"#;
        assert_eq!(
            parse_stream_line(failed),
            Some(StreamEvent::Result { text: "Invalid API key".into(), is_error: true })
        );
    }

    #[test]
    fn ignores_other_lines() {
        assert_eq!(parse_stream_line("not json"), None);
        assert_eq!(parse_stream_line(""), None);
        assert_eq!(parse_stream_line(r#"{"type":"system","subtype":"init"}"#), None);
        assert_eq!(parse_stream_line(r#"{"type":"assistant","message":{"content":[{"type":"tool_use"}]}}"#), None);
    }

    #[test]
    fn classifies_login_failures() {
        assert_eq!(classify_failure("", "Invalid API key · Please run /login"), "CLAUDE_LOGIN:");
        assert_eq!(classify_failure("You are not logged in", ""), "CLAUDE_LOGIN:");
        assert_eq!(classify_failure("Please LOGIN again", ""), "CLAUDE_LOGIN:");
        assert_eq!(classify_failure("segfault", "overloaded"), "CLAUDE_FAILED:");
    }

    #[test]
    fn resolve_prefers_an_existing_settings_path() {
        assert_eq!(resolve_claude_path(Some(fake().to_str().unwrap())), Some(fake()));
    }

    #[test]
    fn resolve_ignores_a_missing_settings_path() {
        let missing = "/nonexistent/claude";
        assert_ne!(resolve_claude_path(Some(missing)), Some(PathBuf::from(missing)));
    }

    #[tokio::test]
    async fn success_returns_the_result_and_reports_progress() {
        let state = ClaudeState::default();
        let mut progress = Vec::new();
        let result = run_claude(&mut state.register("a"), "my note", options("success", Duration::from_secs(10)), |t| {
            progress.push(t.to_string())
        })
        .await;
        assert_eq!(result, Ok("Rewritten: my note".into()));
        assert_eq!(progress.last().map(String::as_str), Some("Hello"));
    }

    #[tokio::test]
    async fn login_error_maps_to_claude_login() {
        let state = ClaudeState::default();
        let result = run_claude(&mut state.register("a"), "x", options("login", Duration::from_secs(10)), |_| {}).await;
        assert!(result.as_ref().unwrap_err().starts_with("CLAUDE_LOGIN:"), "{result:?}");
    }

    #[tokio::test]
    async fn crash_maps_to_claude_failed_with_stderr() {
        let state = ClaudeState::default();
        let result = run_claude(&mut state.register("a"), "x", options("crash", Duration::from_secs(10)), |_| {}).await;
        let err = result.unwrap_err();
        assert!(err.starts_with("CLAUDE_FAILED:") && err.contains("boom"), "{err}");
    }

    #[tokio::test]
    async fn missing_program_maps_to_claude_missing() {
        let state = ClaudeState::default();
        let opts = RunOptions { program: "/nonexistent/claude".into(), timeout: Duration::from_secs(1), env: vec![] };
        let result = run_claude(&mut state.register("a"), "x", opts, |_| {}).await;
        assert!(result.unwrap_err().starts_with("CLAUDE_MISSING:"));
    }

    #[tokio::test]
    async fn runs_in_a_fresh_empty_temp_dir_that_is_removed() {
        let state = ClaudeState::default();
        let out = run_claude(&mut state.register("a"), "x", options("cwd", Duration::from_secs(10)), |_| {})
            .await
            .unwrap();
        let (dir, count) = out.rsplit_once(' ').unwrap();
        assert_eq!(count, "0");
        assert!(!Path::new(dir).exists(), "{dir} should be removed");
    }

    #[tokio::test]
    async fn progress_is_throttled_and_ends_with_all_text() {
        let state = ClaudeState::default();
        let mut progress = Vec::new();
        run_claude(&mut state.register("a"), "x", options("burst", Duration::from_secs(10)), |t| {
            progress.push(t.to_string())
        })
        .await
        .unwrap();
        assert!(progress.len() <= 10, "{} progress events", progress.len());
        assert_eq!(progress.last().unwrap(), &"x".repeat(40));
    }

    async fn wait_for_pid(file: &Path) -> i32 {
        loop {
            if let Ok(raw) = std::fs::read_to_string(file)
                && let Ok(pid) = raw.trim().parse()
            {
                return pid;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    async fn assert_gone(pid: i32) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while alive(pid) && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(!alive(pid), "process {pid} is still running");
    }

    #[tokio::test]
    async fn a_normal_finish_kills_leftover_helpers() {
        let dir = tempfile::tempdir().unwrap();
        let pidfile = dir.path().join("pid");
        let state = ClaudeState::default();
        let mut opts = options("helper", Duration::from_secs(10));
        opts.env.push(("FAKE_CLAUDE_PIDFILE".into(), pidfile.to_string_lossy().into()));
        let result = run_claude(&mut state.register("a"), "x", opts, |_| {}).await;
        assert_eq!(result, Ok("done".into()));
        assert_gone(wait_for_pid(&pidfile).await).await;
    }

    #[test]
    fn tools_are_disabled_with_an_empty_tools_list() {
        let at = ARGS.iter().position(|arg| *arg == "--tools").unwrap();
        assert_eq!(ARGS[at + 1], "");
    }

    #[tokio::test]
    async fn cancel_kills_the_whole_process_group() {
        let dir = tempfile::tempdir().unwrap();
        let pidfile = dir.path().join("pid");
        let state = ClaudeState::default();
        let mut opts = options("sleep", Duration::from_secs(30));
        opts.env.push(("FAKE_CLAUDE_PIDFILE".into(), pidfile.to_string_lossy().into()));
        let mut registration = state.register("a");
        let run = run_claude(&mut registration, "x", opts, |_| {});
        let cancel = async {
            let pid = wait_for_pid(&pidfile).await;
            state.cancel("a");
            pid
        };
        let (result, pid) = tokio::join!(run, cancel);
        assert!(result.unwrap_err().starts_with("CLAUDE_CANCELLED:"));
        assert_gone(pid).await;
    }

    #[tokio::test]
    async fn timeout_kills_the_child() {
        let dir = tempfile::tempdir().unwrap();
        let pidfile = dir.path().join("pid");
        let state = ClaudeState::default();
        let mut opts = options("sleep", Duration::from_secs(1));
        opts.env.push(("FAKE_CLAUDE_PIDFILE".into(), pidfile.to_string_lossy().into()));
        let result = run_claude(&mut state.register("a"), "x", opts, |_| {}).await;
        assert!(result.unwrap_err().starts_with("CLAUDE_TIMEOUT:"));
        assert_gone(wait_for_pid(&pidfile).await).await;
    }

    #[test]
    fn cancel_while_running_is_received_and_the_entry_is_removed_on_drop() {
        let state = ClaudeState::default();
        let mut registration = state.register("a");
        state.cancel("a");
        assert!(registration.cancelled.try_recv().is_ok());
        drop(registration);
        assert!(state.inner().running.is_empty());
    }

    #[tokio::test]
    async fn cancel_that_arrives_before_register_is_not_lost() {
        let state = ClaudeState::default();
        state.cancel("a");
        let result = run_claude(&mut state.register("a"), "x", options("success", Duration::from_secs(10)), |_| {}).await;
        assert!(result.unwrap_err().starts_with("CLAUDE_CANCELLED:"));
        let again = run_claude(&mut state.register("a"), "x", options("success", Duration::from_secs(10)), |_| {}).await;
        assert_eq!(again, Ok("Rewritten: x".into()));
    }

    #[test]
    fn early_cancels_are_bounded() {
        let state = ClaudeState::default();
        for i in 0..1000 {
            state.cancel(&i.to_string());
        }
        assert!(state.inner().pending_cancels.len() <= 64);
    }

    #[tokio::test]
    async fn kill_all_stops_every_running_process_group() {
        let dir = tempfile::tempdir().unwrap();
        let pidfile = dir.path().join("pid");
        let state = ClaudeState::default();
        let mut opts = options("sleep", Duration::from_secs(30));
        opts.env.push(("FAKE_CLAUDE_PIDFILE".into(), pidfile.to_string_lossy().into()));
        let mut registration = state.register("a");
        let run = run_claude(&mut registration, "x", opts, |_| {});
        let kill = async {
            let pid = wait_for_pid(&pidfile).await;
            state.kill_all();
            pid
        };
        let (result, pid) = tokio::join!(run, kill);
        assert!(result.is_err());
        assert_gone(pid).await;
    }
}
