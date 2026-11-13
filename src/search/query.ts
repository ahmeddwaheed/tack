export interface ParsedQuery {
  text: string;
  tags: string[];
  people: string[];
  folder?: string;
}

const VAULT_FOLDERS = ["Inbox", "Meetings", "People", "Projects", "Knowledge", "Weekly"];

const canonicalFolder = (name: string) =>
  VAULT_FOLDERS.find((folder) => folder.toLowerCase() === name.toLowerCase()) ?? name;

export function parseQuery(q: string): ParsedQuery {
  const parsed: ParsedQuery = { text: "", tags: [], people: [] };
  const words: string[] = [];
  for (const token of q.split(/\s+/).filter(Boolean)) {
    if (token.length > 1 && token.startsWith("#")) parsed.tags.push(token.slice(1));
    else if (token.length > 1 && token.startsWith("@")) parsed.people.push(token.slice(1));
    else if (token.length > 3 && token.toLowerCase().startsWith("in:")) parsed.folder = canonicalFolder(token.slice(3));
    else words.push(token);
  }
  parsed.text = words.join(" ");
  return parsed;
}
