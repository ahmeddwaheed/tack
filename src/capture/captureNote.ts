const TITLE_WORDS = 6;
const TITLE_MAX = 60;

const pad = (n: number) => String(n).padStart(2, "0");

const truncate = (text: string, max: number) => Array.from(text).slice(0, max).join("").trimEnd();

export function captureNote(text: string, now: Date): { title: string; content: string } | null {
  if (text.trim() === "") return null;
  const body = text.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
  const firstLine = body.split(/\r?\n/, 1)[0];
  const words = firstLine.trim().split(/\s+/).slice(0, TITLE_WORDS).join(" ");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  return {
    title: truncate(`${date} ${hours}${minutes} ${words}`, TITLE_MAX),
    content: `---\ntype: note\ncreated: ${date}T${hours}:${minutes}\n---\n\n${body}\n`,
  };
}
