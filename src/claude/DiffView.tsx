import type { DiffRow } from "./lineDiff";

export function DiffView({ rows, label }: { rows: DiffRow[]; label: string }) {
  return (
    <div className="tack-diff" aria-label={label}>
      {rows.map((row, i) =>
        row.kind === "skip" ? (
          <div key={i} className="tack-diff-skip">
            … {row.count} unchanged {row.count === 1 ? "line" : "lines"}
          </div>
        ) : (
          <div key={i} className={`tack-diff-line tack-diff-${row.kind}`}>
            <span className="tack-diff-sign" aria-hidden="true">
              {row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}
            </span>
            {row.text}
          </div>
        ),
      )}
    </div>
  );
}
