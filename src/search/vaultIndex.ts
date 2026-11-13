import { listNotes, onVaultChanged, readNote, type NoteMeta } from "../lib/vault";
import { parseFrontmatter, splitFrontmatter } from "../markdown/frontmatter";
import { createSearchIndex, type IndexedNote, type SearchIndex } from "./index";

const titleOnly = (meta: NoteMeta): IndexedNote => ({
  path: meta.path,
  title: meta.title,
  folder: meta.folder,
  body: "",
  tags: [],
  people: [],
  modifiedMs: meta.modifiedMs,
});

async function loadNote(meta: NoteMeta): Promise<IndexedNote> {
  if (meta.placeholder) return titleOnly(meta);
  const { frontmatter, body } = splitFrontmatter(await readNote(meta.path));
  const fields = parseFrontmatter(frontmatter);
  return { ...titleOnly(meta), body, tags: fields.tags, people: fields.people };
}

export async function buildVaultIndex(): Promise<SearchIndex> {
  const metas = await listNotes();
  const settled = await Promise.allSettled(metas.map(loadNote));
  const notes = settled.map((result, i) =>
    result.status === "fulfilled" ? result.value : titleOnly(metas[i] as NoteMeta),
  );
  return createSearchIndex(notes);
}

export function watchVaultIndex(index: SearchIndex): Promise<() => void> {
  let updates = Promise.resolve();
  const refresh = async (paths: string[]) => {
    const metas = new Map((await listNotes()).map((meta) => [meta.path, meta]));
    for (const path of paths) {
      const meta = metas.get(path);
      if (!meta) index.remove(path);
      else index.upsert(await loadNote(meta).catch(() => titleOnly(meta)));
    }
  };
  return onVaultChanged((paths) => {
    updates = updates.then(() => refresh(paths)).catch(() => undefined);
  });
}

export const INDEX_RETRY_MS = 5000;

export function startVaultIndex(
  onReady: (index: SearchIndex) => void,
  onError: (error: unknown) => void,
  retryMs = INDEX_RETRY_MS,
): () => void {
  let stopped = false;
  let building = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopRetrying: (() => void) | undefined;
  let unwatch: (() => void) | undefined;

  const listenForRetry = async () => {
    if (stopRetrying) return;
    const stop = await onVaultChanged(() => void build()).catch(() => undefined);
    if (stopped) stop?.();
    else stopRetrying = stop;
  };

  const build = async (): Promise<void> => {
    if (stopped || building) return;
    building = true;
    clearTimeout(timer);
    try {
      const index = await buildVaultIndex();
      if (stopped) return;
      stopRetrying?.();
      stopRetrying = undefined;
      onReady(index);
      const stop = await watchVaultIndex(index);
      if (stopped) stop();
      else unwatch = stop;
    } catch (e) {
      if (stopped) return;
      onError(e);
      timer = setTimeout(() => void build(), retryMs);
      await listenForRetry();
    } finally {
      building = false;
    }
  };

  void build();
  return () => {
    stopped = true;
    clearTimeout(timer);
    stopRetrying?.();
    unwatch?.();
  };
}
