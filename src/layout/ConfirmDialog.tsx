import { useEffect, useRef, type KeyboardEvent } from "react";

interface ConfirmDialogProps {
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  focus?: "confirm" | "cancel";
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  focus = "confirm",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (focus === "confirm" ? confirmRef : cancelRef).current?.focus();
  }, [focus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };

  return (
    <div className="tack-dialog-backdrop" onKeyDown={onKeyDown}>
      <div className="tack-dialog" role="alertdialog" aria-modal="true" aria-label={message}>
        <p>{message}</p>
        <div className="tack-dialog-buttons">
          <button ref={cancelRef} type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" className="tack-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
