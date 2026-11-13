import { describe, expect, test } from "vitest";
import { confirmSlot } from "./confirmSlot";

describe("confirmSlot", () => {
  test("a new question answers the one it replaces with no", async () => {
    const shown: (string | null)[] = [];
    let current: { message: string; resolve(ok: boolean): void } | null = null;
    const ask = confirmSlot<{ message: string }>((request) => {
      current = request;
      shown.push(request?.message ?? null);
    });
    const first = ask({ message: "Move to Trash?" });
    const second = ask({ message: "Discard changes?" });
    await expect(first).resolves.toBe(false);
    expect(shown[shown.length - 1]).toBe("Discard changes?");
    (current as { resolve(ok: boolean): void } | null)?.resolve(true);
    await expect(second).resolves.toBe(true);
    expect(shown[shown.length - 1]).toBeNull();
  });

  test("a late answer from a replaced dialog is ignored", async () => {
    const requests: { resolve(ok: boolean): void }[] = [];
    const ask = confirmSlot<{ message: string }>((request) => {
      if (request) requests.push(request);
    });
    const first = ask({ message: "a" });
    const second = ask({ message: "b" });
    requests[0]?.resolve(true);
    await expect(first).resolves.toBe(false);
    requests[1]?.resolve(true);
    await expect(second).resolves.toBe(true);
  });
});
