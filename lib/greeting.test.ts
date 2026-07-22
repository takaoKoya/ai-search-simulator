import { describe, it, expect } from "vitest";
import { getGreetingPeriod, getGreeting } from "./greeting";

describe("getGreetingPeriod", () => {
  it("returns morning for 5-10時台", () => {
    expect(getGreetingPeriod(5)).toBe("morning");
    expect(getGreetingPeriod(10)).toBe("morning");
  });

  it("returns afternoon for 11-16時台", () => {
    expect(getGreetingPeriod(11)).toBe("afternoon");
    expect(getGreetingPeriod(16)).toBe("afternoon");
  });

  it("returns evening for 17-21時台", () => {
    expect(getGreetingPeriod(17)).toBe("evening");
    expect(getGreetingPeriod(21)).toBe("evening");
  });

  it("returns night for late night/early morning hours", () => {
    expect(getGreetingPeriod(22)).toBe("night");
    expect(getGreetingPeriod(0)).toBe("night");
    expect(getGreetingPeriod(4)).toBe("night");
  });
});

describe("getGreeting", () => {
  it("朝の時間帯には☀️とおはようございますを返す", () => {
    const g = getGreeting(new Date(2026, 0, 1, 8, 0, 0));
    expect(g.icon).toBe("☀️");
    expect(g.text).toBe("おはようございます。");
  });

  it("深夜には🌙を返す", () => {
    const g = getGreeting(new Date(2026, 0, 1, 1, 0, 0));
    expect(g.icon).toBe("🌙");
  });
});
