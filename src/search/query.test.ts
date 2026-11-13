import { describe, expect, test } from "vitest";
import { parseQuery } from "./query";

describe("parseQuery", () => {
  test("splits text, tags, people and folder", () => {
    expect(parseQuery("deploy #infra @Sam in:knowledge")).toEqual({
      text: "deploy",
      tags: ["infra"],
      people: ["Sam"],
      folder: "Knowledge",
    });
  });

  test("plain text has no filters", () => {
    expect(parseQuery("  kubectl  rollout ")).toEqual({ text: "kubectl rollout", tags: [], people: [] });
  });

  test("folder names are matched case-insensitively", () => {
    expect(parseQuery("in:MEETINGS standup").folder).toBe("Meetings");
  });

  test("bare markers are kept as text", () => {
    expect(parseQuery("# @ in:")).toEqual({ text: "# @ in:", tags: [], people: [] });
  });
});
