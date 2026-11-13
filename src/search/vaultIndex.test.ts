import { beforeEach, describe, expect, test, vi } from "vitest";
import type { NoteMeta } from "../lib/vault";
import type { SearchIndex } from "./index";
import { buildVaultIndex, startVaultIndex, watchVaultIndex } from "./vaultIndex";

const mocks = vi.hoisted(() => ({
  notes: [] as NoteMeta[],
  files: new Map<string, string>(),
  listener: null as ((paths: string[]) => void) | null,
  reads: [] as string[],
  listFailures: 0,
}));

vi.mock("../lib/vault", () => ({
  listNotes: async () => {
    if (mocks.listFailures > 0) {
      mocks.listFailures -= 1;
      throw new Error("iCloud removed a file mid-walk");
    }
    return mocks.notes;
  },
  readNote: async (path: string) => {
    mocks.reads.push(path);
    return mocks.files.get(path) ?? "";
  },
  onVaultChanged: async (cb: (paths: string[]) => void) => {
    mocks.listener = cb;
    return () => (mocks.listener = null);
  },
}));

const meta = (path: string, placeholder = false): NoteMeta => ({
  path,
  title: path.split("/").pop()?.replace(/\.md$/, "") ?? "",
  folder: path.split("/").slice(0, -1).join("/"),
  modifiedMs: 1,
  placeholder,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mocks.notes = [meta("Knowledge/Deploy.md"), meta("Meetings/Cloud only.md", true)];
  mocks.files = new Map([
    ["Knowledge/Deploy.md", "---\ntags: [infra]\npeople: ['[[Sam]]']\n---\nkubectl rollout restart\n"],
  ]);
  mocks.reads = [];
  mocks.listener = null;
  mocks.listFailures = 0;
});

describe("buildVaultIndex", () => {
  test("indexes body and frontmatter, placeholders by title only without reading them", async () => {
    const index = await buildVaultIndex();
    expect(index.search("kubectl #infra @Sam").map((hit) => hit.path)).toEqual(["Knowledge/Deploy.md"]);
    expect(index.search("tags")).toEqual([]);
    expect(index.search("cloud").map((hit) => hit.path)).toEqual(["Meetings/Cloud only.md"]);
    expect(mocks.reads).toEqual(["Knowledge/Deploy.md"]);
  });
});

describe("watchVaultIndex", () => {
  test("re-reads changed notes and removes deleted ones", async () => {
    const index = await buildVaultIndex();
    const stop = await watchVaultIndex(index);
    mocks.files.set("Knowledge/Deploy.md", "helm upgrade\n");
    mocks.notes = [meta("Knowledge/Deploy.md")];
    mocks.listener?.(["Knowledge/Deploy.md", "Meetings/Cloud only.md"]);
    await flush();
    expect(index.search("helm").map((hit) => hit.path)).toEqual(["Knowledge/Deploy.md"]);
    expect(index.search("kubectl")).toEqual([]);
    expect(index.search("cloud")).toEqual([]);
    stop();
    expect(mocks.listener).toBeNull();
  });
});

describe("startVaultIndex", () => {
  test("a failed first build reports the error and retries on the next vault change", async () => {
    mocks.listFailures = 1;
    const ready: SearchIndex[] = [];
    const errors: string[] = [];
    const stop = startVaultIndex(
      (index) => ready.push(index),
      (e) => errors.push(String(e)),
      60_000,
    );
    await flush();
    expect(errors).toEqual(["Error: iCloud removed a file mid-walk"]);
    expect(ready).toEqual([]);
    mocks.listener?.(["Knowledge/Deploy.md"]);
    await flush();
    expect(ready).toHaveLength(1);
    expect(ready[0]?.search("kubectl").map((hit) => hit.path)).toEqual(["Knowledge/Deploy.md"]);
    mocks.files.set("Knowledge/Deploy.md", "helm upgrade\n");
    mocks.listener?.(["Knowledge/Deploy.md"]);
    await flush();
    expect(ready[0]?.search("helm").map((hit) => hit.path)).toEqual(["Knowledge/Deploy.md"]);
    stop();
    expect(mocks.listener).toBeNull();
  });

  test("a failed first build also retries after a delay", async () => {
    vi.useFakeTimers();
    try {
      mocks.listFailures = 1;
      const ready: SearchIndex[] = [];
      const stop = startVaultIndex((index) => ready.push(index), () => undefined, 5000);
      await vi.advanceTimersByTimeAsync(0);
      expect(ready).toEqual([]);
      await vi.advanceTimersByTimeAsync(5000);
      expect(ready).toHaveLength(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
