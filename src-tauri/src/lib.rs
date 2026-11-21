mod capture;
#[cfg(target_os = "macos")]
mod capture_panel;
mod history;
mod icloud;
mod names;
mod settings;
mod vault;
mod watcher;

use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewWindow, Wry};

pub(crate) const MAIN_WINDOW: &str = "main";
const QUIT_MENU_ID: &str = "quit";
const QUIT_REQUESTED_EVENT: &str = "quit-requested";

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, on: bool) -> Result<(), String> {
    window.set_always_on_top(on).map_err(|e| e.to_string())
}

fn is_quit_item(item: &MenuItemKind<Wry>) -> bool {
    matches!(item, MenuItemKind::Predefined(p) if p.text().is_ok_and(|t| t.starts_with("Quit")))
}

// The stock Quit item terminates the process without a close event, so unsaved edits would never be flushed.
fn app_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(app_submenu)) = menu.items()?.into_iter().next() {
        let items = app_submenu.items()?;
        if let Some(position) = items.iter().position(is_quit_item) {
            app_submenu.remove_at(position)?;
            let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Quit Tack", true, Some("CmdOrCtrl+Q"))?;
            app_submenu.insert(&quit, position)?;
        }
    }
    Ok(menu)
}

fn request_quit(app: &AppHandle) {
    match app.get_webview_window(MAIN_WINDOW) {
        Some(_) => {
            let _ = app.emit_to(MAIN_WINDOW, QUIT_REQUESTED_EVENT, ());
        }
        None => app.exit(0),
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(watcher::WatcherState::default())
        .manage(capture::CaptureState::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            capture::setup_panel(app.handle());
            capture::register_saved_hotkey(app.handle());
            Ok(())
        })
        .on_window_event(capture::on_window_event)
        .menu(app_menu)
        .on_menu_event(|app, event| {
            if event.id() == QUIT_MENU_ID {
                request_quit(app);
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_always_on_top,
            capture::hide_capture,
            capture::set_capture_hotkey,
            capture::unavailable_capture_hotkey,
            history::history_save,
            history::history_list,
            history::history_read,
            vault::vault_status,
            vault::vault_init,
            vault::list_notes,
            vault::read_note,
            vault::write_note,
            vault::create_note,
            vault::rename_note,
            vault::move_note,
            vault::trash_note,
            vault::get_settings,
            vault::set_settings,
            watcher::watch_vault
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn smoke() {
        assert_eq!(1 + 1, 2);
    }
}
