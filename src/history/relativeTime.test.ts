import { describe, expect, test } from "vitest";
import { relativeTime } from "./relativeTime";

const NOW = new Date(2026, 10, 20, 15, 30, 0).getTime();
const MIN = 60_000;

describe("relativeTime", () => {
  test("just now under a minute", () => {
    expect(relativeTime(NOW - 59_000, NOW)).toBe("just now");
    expect(relativeTime(NOW + 5_000, NOW)).toBe("just now");
  });

  test("minutes and hours", () => {
    expect(relativeTime(NOW - MIN, NOW)).toBe("1 min ago");
    expect(relativeTime(NOW - 59 * MIN, NOW)).toBe("59 min ago");
    expect(relativeTime(NOW - 60 * MIN, NOW)).toBe("1 h ago");
    expect(relativeTime(NOW - 23 * 60 * MIN, NOW)).toBe("23 h ago");
  });

  test("older than a day shows the date", () => {
    expect(relativeTime(new Date(2026, 10, 18, 9, 5).getTime(), NOW)).toBe("Nov 18, 09:05");
    expect(relativeTime(new Date(2026, 0, 3, 23, 59).getTime(), NOW)).toBe("Jan 3, 23:59");
  });
});
