import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

interface HotkeyDialogProps {
  current: string;
  onSave(accel: string): Promise<void>;
  onClose(): void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function HotkeyDialog({ current, onSave, onClose }: HotkeyDialogProps) {
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const accel = value.trim();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (accel === "" || saving) return;
    setSaving(true);
    try {
      await onSave(accel);
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <div className="tack-dialog-backdrop" onKeyDown={onKeyDown}>
      <form className="tack-dialog" role="dialog" aria-modal="true" aria-label="Change capture hotkey" onSubmit={submit}>
        <p>
          <label htmlFor="tack-hotkey">Quick capture hotkey, for example Alt+Space or Ctrl+Shift+Space</label>
        </p>
        <input
          id="tack-hotkey"
          ref={inputRef}
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setValue(event.currentTarget.value);
            setError(null);
          }}
        />
        {error && (
          <p className="tack-error" role="alert">
            {error}
          </p>
        )}
        <div className="tack-dialog-buttons">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={accel === "" || saving}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
