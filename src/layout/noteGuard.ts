import { NoteConflictError, type NoteSession } from "../editor/noteSession";

export interface OpenNote {
  readonly session: NoteSession;
  sync(): void;
  revealConflict(): void;
}

export type GuardOutcome = "done" | "blocked" | "unsaved";

export type WindowLeave = "close" | "quit";

export type WindowAction = "hide" | "destroy" | "stay";

export const windowAction = (kind: WindowLeave, outcome: GuardOutcome): WindowAction => {
  if (outcome !== "done") return "stay";
  return kind === "quit" ? "destroy" : "hide";
};

export type ConfirmDiscard = (title: string) => Promise<boolean>;

export const noteTitle = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

const blocked = (open: OpenNote): GuardOutcome => {
  open.revealConflict();
  return "blocked";
};

export async function releaseNote(open: OpenNote | null, confirmDiscard?: ConfirmDiscard): Promise<GuardOutcome> {
  if (!open) return "done";
  const { session } = open;
  open.sync();
  if (session.state !== "conflict") await session.flush();
  if (session.state === "conflict") return blocked(open);
  if (session.dirty && !(await confirmDiscard?.(noteTitle(session.path)))) return "unsaved";
  try {
    await session.close();
  } catch (e) {
    if (e instanceof NoteConflictError) return blocked(open);
    throw e;
  }
  return "done";
}

export async function handleCloseRequest(
  open: OpenNote | null,
  closeWindow: () => Promise<void>,
  confirmDiscard?: ConfirmDiscard,
): Promise<GuardOutcome> {
  const outcome = await releaseNote(open, confirmDiscard);
  if (outcome === "done") await closeWindow();
  return outcome;
}

export async function switchNote(
  open: OpenNote | null,
  target: string,
  openPath: (path: string) => void,
  confirmDiscard?: ConfirmDiscard,
): Promise<GuardOutcome> {
  if (open?.session.path === target) return "done";
  const outcome = await releaseNote(open, confirmDiscard);
  if (outcome === "done") openPath(target);
  return outcome;
}

export async function trashWithGuard(
  open: OpenNote | null,
  target: string,
  trash: (path: string) => Promise<void>,
  confirmDiscard?: ConfirmDiscard,
): Promise<GuardOutcome> {
  if (open?.session.path === target) {
    const outcome = await releaseNote(open, confirmDiscard);
    if (outcome !== "done") return outcome;
  }
  await trash(target);
  return "done";
}
