use objc2::runtime::{AnyClass, AnyObject, NSObject};
use objc2::{ClassType, MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::{
    NSFloatingWindowLevel, NSPanel, NSResponder, NSWindow, NSWindowCollectionBehavior,
    NSWindowStyleMask,
};
use tauri::WebviewWindow;

define_class!(
    #[unsafe(super(NSPanel, NSWindow, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "TackCapturePanel"]
    struct CapturePanel;

    impl CapturePanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            true
        }

        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main_window(&self) -> bool {
            false
        }
    }
);

const TAO_WINDOW_CLASS: &str = "TaoWindow";

fn inherits(class: &AnyClass, ancestor: &AnyClass) -> bool {
    let mut current = Some(class);
    while let Some(c) = current {
        if c == ancestor {
            return true;
        }
        current = c.superclass();
    }
    false
}

fn check_swap(current: &AnyClass, target: &AnyClass, expected: &str) -> Result<(), String> {
    let name = current.name().to_string_lossy();
    if name != expected || !inherits(current, NSWindow::class()) {
        return Err(format!("unexpected window class {name}"));
    }
    if target.instance_size() > current.instance_size() {
        return Err(format!("{name} is smaller than the panel class"));
    }
    Ok(())
}

// A regular window activates Tack, which unhides and raises the main window over the
// user's app. Swapping the existing tao window's class to a non-activating NSPanel keeps
// Tauri's webview and events while letting the panel take key focus on its own.
pub fn make_nonactivating(window: &WebviewWindow) -> Result<(), String> {
    MainThreadMarker::new().ok_or("the capture panel must be set up on the main thread")?;
    let raw = window.ns_window().map_err(|e| e.to_string())?;
    let object = unsafe { raw.cast::<AnyObject>().as_ref() }.ok_or("no native capture window")?;
    check_swap(object.class(), CapturePanel::class(), TAO_WINDOW_CLASS)?;
    unsafe { AnyObject::set_class(object, CapturePanel::class()) };
    let panel = unsafe { &*raw.cast::<NSPanel>() };

    panel.setStyleMask(panel.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    // setStyleMask: alone does not update WindowServer's activation tag after a class swap.
    let prevents_activation = sel!(_setPreventsActivation:);
    let responds: bool = unsafe { msg_send![panel, respondsToSelector: prevents_activation] };
    if responds {
        let _: () = unsafe { msg_send![panel, _setPreventsActivation: true] };
    }
    panel.setFloatingPanel(true);
    panel.setLevel(NSFloatingWindowLevel);
    panel.setHidesOnDeactivate(false);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    // Tao owns the native window and releases it itself when the panel is destroyed.
    unsafe { panel.setReleasedWhenClosed(false) };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swap_needs_the_expected_window_class() {
        assert!(check_swap(NSObject::class(), CapturePanel::class(), "NSObject").is_err());
        assert!(check_swap(NSWindow::class(), CapturePanel::class(), TAO_WINDOW_CLASS).is_err());
        assert!(check_swap(CapturePanel::class(), CapturePanel::class(), "TackCapturePanel").is_ok());
    }

    #[test]
    fn swap_needs_room_for_the_panel_class() {
        let bigger = CapturePanel::class();
        let smaller = NSWindow::class();
        if bigger.instance_size() > smaller.instance_size() {
            assert!(check_swap(smaller, bigger, "NSWindow").is_err());
        } else {
            assert!(check_swap(smaller, bigger, "NSWindow").is_ok());
        }
    }
}
