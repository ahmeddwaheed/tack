use crate::{MAIN_WINDOW, settings, vault};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, Webview, WebviewWindow, Window, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const CAPTURE_WINDOW: &str = "capture";
const SHOWN_EVENT: &str = "capture-shown";
const DISMISS_EVENT: &str = "capture-dismiss";
const QUIT_EVENT: &str = "capture-quit";

#[derive(Default)]
pub struct CaptureState {
    hotkey: Mutex<Option<Shortcut>>,
    unavailable: Mutex<Option<String>>,
}

#[derive(Debug, PartialEq)]
pub enum HotkeyAction {
    Show,
    Dismiss,
}

pub fn hotkey_action(panel_visible: bool) -> HotkeyAction {
    if panel_visible {
        HotkeyAction::Dismiss
    } else {
        HotkeyAction::Show
    }
}

#[derive(Debug, PartialEq)]
pub enum QuitAction {
    Destroy,
    SaveThenClose,
}

pub fn quit_action(panel_visible: bool) -> QuitAction {
    if panel_visible {
        QuitAction::SaveThenClose
    } else {
        QuitAction::Destroy
    }
}

pub trait Hotkeys {
    fn register(&self, shortcut: Shortcut) -> Result<(), String>;
    fn unregister(&self, shortcut: Shortcut) -> Result<(), String>;
}

pub fn swap_hotkey<H: Hotkeys>(
    hotkeys: &H,
    current: Option<Shortcut>,
    next: Shortcut,
    persist: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if current == Some(next) {
        return persist();
    }
    hotkeys.register(next)?;
    if let Err(e) = persist() {
        let _ = hotkeys.unregister(next);
        return Err(e);
    }
    if let Some(old) = current {
        let _ = hotkeys.unregister(old);
    }
    Ok(())
}

struct AppHotkeys<'a>(&'a AppHandle);

impl Hotkeys for AppHotkeys<'_> {
    fn register(&self, shortcut: Shortcut) -> Result<(), String> {
        self.0
            .global_shortcut()
            .on_shortcut(shortcut, |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    on_hotkey(app);
                }
            })
            .map_err(|e| e.to_string())
    }

    fn unregister(&self, shortcut: Shortcut) -> Result<(), String> {
        self.0
            .global_shortcut()
            .unregister(shortcut)
            .map_err(|e| e.to_string())
    }
}

fn panel(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(CAPTURE_WINDOW)
}

fn on_hotkey(app: &AppHandle) {
    let Some(panel) = panel(app) else { return };
    match hotkey_action(panel.is_visible().unwrap_or(false)) {
        HotkeyAction::Show => show(app, &panel),
        HotkeyAction::Dismiss => {
            let _ = app.emit_to(CAPTURE_WINDOW, DISMISS_EVENT, ());
        }
    }
}

fn show(app: &AppHandle, panel: &WebviewWindow) {
    let _ = panel.center();
    let _ = panel.show();
    let webview: &Webview = panel.as_ref();
    let _ = webview.set_focus();
    let _ = app.emit_to(CAPTURE_WINDOW, SHOWN_EVENT, ());
}

#[cfg(target_os = "macos")]
pub fn setup_panel(app: &AppHandle) {
    let Some(panel) = panel(app) else { return };
    if let Err(e) = crate::capture_panel::make_nonactivating(&panel) {
        eprintln!("quick capture panel stays a regular window: {e}");
    }
}

pub fn register_saved_hotkey(app: &AppHandle) {
    let accel = match vault::settings_dir(app) {
        Ok(dir) => settings::load(&dir).capture_hotkey,
        Err(_) => settings::Settings::default().capture_hotkey,
    };
    let registered = accel
        .parse::<Shortcut>()
        .map_err(|e| e.to_string())
        .and_then(|shortcut| AppHotkeys(app).register(shortcut).map(|()| shortcut));
    match registered {
        Ok(shortcut) => {
            if let Ok(mut current) = app.state::<CaptureState>().hotkey.lock() {
                *current = Some(shortcut);
            }
        }
        Err(e) => {
            eprintln!("quick capture hotkey {accel} not registered: {e}");
            if let Ok(mut unavailable) = app.state::<CaptureState>().unavailable.lock() {
                *unavailable = Some(accel);
            }
        }
    }
}

#[tauri::command]
pub fn unavailable_capture_hotkey(state: State<'_, CaptureState>) -> Option<String> {
    state.unavailable.lock().ok().and_then(|u| u.clone())
}

#[tauri::command(async)]
pub fn set_capture_hotkey(
    app: AppHandle,
    state: State<'_, CaptureState>,
    accel: String,
) -> Result<(), String> {
    let next = accel.parse::<Shortcut>().map_err(|e| e.to_string())?;
    let dir = vault::settings_dir(&app)?;
    let mut current = state.hotkey.lock().map_err(|e| e.to_string())?;
    swap_hotkey(&AppHotkeys(&app), *current, next, || {
        let mut saved = settings::load(&dir);
        saved.capture_hotkey = accel.clone();
        settings::save(&dir, &saved)
    })?;
    *current = Some(next);
    if let Ok(mut unavailable) = state.unavailable.lock() {
        *unavailable = None;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_capture(app: AppHandle) -> Result<(), String> {
    match panel(&app) {
        Some(panel) => panel.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    match (window.label(), event) {
        (CAPTURE_WINDOW, WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            let _ = window.emit_to(CAPTURE_WINDOW, DISMISS_EVENT, ());
        }
        (MAIN_WINDOW, WindowEvent::Destroyed) => close_for_quit(window.app_handle()),
        _ => {}
    }
}

fn close_for_quit(app: &AppHandle) {
    let Some(panel) = panel(app) else { return };
    match quit_action(panel.is_visible().unwrap_or(false)) {
        QuitAction::Destroy => {
            let _ = panel.destroy();
        }
        QuitAction::SaveThenClose => {
            let _ = app.emit_to(CAPTURE_WINDOW, QUIT_EVENT, ());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn key(accel: &str) -> Shortcut {
        accel.parse().unwrap()
    }

    #[derive(Default)]
    struct FakeHotkeys {
        taken: Vec<Shortcut>,
        log: RefCell<Vec<String>>,
    }

    impl Hotkeys for FakeHotkeys {
        fn register(&self, shortcut: Shortcut) -> Result<(), String> {
            if self.taken.contains(&shortcut) {
                return Err("taken".into());
            }
            self.log
                .borrow_mut()
                .push(format!("register {}", shortcut.into_string()));
            Ok(())
        }

        fn unregister(&self, shortcut: Shortcut) -> Result<(), String> {
            self.log
                .borrow_mut()
                .push(format!("unregister {}", shortcut.into_string()));
            Ok(())
        }
    }

    #[test]
    fn hotkey_shows_a_hidden_panel_and_dismisses_a_visible_one() {
        assert_eq!(hotkey_action(false), HotkeyAction::Show);
        assert_eq!(hotkey_action(true), HotkeyAction::Dismiss);
    }

    #[test]
    fn quitting_destroys_a_hidden_panel_and_asks_a_visible_one_to_save_first() {
        assert_eq!(quit_action(false), QuitAction::Destroy);
        assert_eq!(quit_action(true), QuitAction::SaveThenClose);
    }


    #[test]
    fn swap_registers_the_new_hotkey_saves_then_releases_the_old_one() {
        let hotkeys = FakeHotkeys::default();
        let saved = RefCell::new(false);
        swap_hotkey(&hotkeys, Some(key("Alt+Space")), key("Alt+KeyN"), || {
            *saved.borrow_mut() = true;
            Ok(())
        })
        .unwrap();
        assert!(*saved.borrow());
        assert_eq!(
            *hotkeys.log.borrow(),
            vec![
                format!("register {}", key("Alt+KeyN").into_string()),
                format!("unregister {}", key("Alt+Space").into_string()),
            ]
        );
    }

    #[test]
    fn swap_keeps_the_old_hotkey_when_the_new_one_cannot_be_registered() {
        let hotkeys = FakeHotkeys {
            taken: vec![key("Alt+KeyN")],
            ..Default::default()
        };
        let result = swap_hotkey(&hotkeys, Some(key("Alt+Space")), key("Alt+KeyN"), || {
            panic!("must not save")
        });
        assert_eq!(result, Err("taken".to_string()));
        assert!(hotkeys.log.borrow().is_empty());
    }

    #[test]
    fn swap_rolls_back_when_saving_fails() {
        let hotkeys = FakeHotkeys::default();
        let result = swap_hotkey(&hotkeys, Some(key("Alt+Space")), key("Alt+KeyN"), || {
            Err("disk full".into())
        });
        assert_eq!(result, Err("disk full".to_string()));
        assert_eq!(
            *hotkeys.log.borrow(),
            vec![
                format!("register {}", key("Alt+KeyN").into_string()),
                format!("unregister {}", key("Alt+KeyN").into_string()),
            ]
        );
    }

    #[test]
    fn swap_to_the_same_hotkey_only_saves() {
        let hotkeys = FakeHotkeys::default();
        let saved = RefCell::new(false);
        swap_hotkey(&hotkeys, Some(key("Alt+Space")), key("alt+space"), || {
            *saved.borrow_mut() = true;
            Ok(())
        })
        .unwrap();
        assert!(*saved.borrow());
        assert!(hotkeys.log.borrow().is_empty());
    }

    #[test]
    fn swap_without_a_current_hotkey_registers_and_saves() {
        let hotkeys = FakeHotkeys::default();
        swap_hotkey(&hotkeys, None, key("Alt+KeyN"), || Ok(())).unwrap();
        assert_eq!(
            *hotkeys.log.borrow(),
            vec![format!("register {}", key("Alt+KeyN").into_string())]
        );
    }
}
