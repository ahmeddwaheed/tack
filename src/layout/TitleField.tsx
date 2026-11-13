import { useRef, useState, type KeyboardEvent } from "react";

interface TitleFieldProps {
  title: string;
  onRename(newTitle: string): void;
}

export function TitleField({ title, onRename }: TitleFieldProps) {
  const [value, setValue] = useState(title);
  const [shownTitle, setShownTitle] = useState(title);
  const cancelled = useRef(false);
  if (shownTitle !== title) {
    setShownTitle(title);
    setValue(title);
  }

  const onBlur = () => {
    const next = value.trim();
    setValue(title);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (next !== "" && next !== title) onRename(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      cancelled.current = true;
      event.currentTarget.blur();
    }
  };

  return (
    <input
      className="tack-title"
      aria-label="Note title"
      value={value}
      onChange={(event) => setValue(event.currentTarget.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  );
}
