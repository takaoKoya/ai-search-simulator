import { describe, expect, it } from "vitest";
import { buildApplyText, buildLineEntryUrl, jstDate, parseApplyText, resolveChannelType } from "./channel";
import { formatRate, summarize } from "./summary";

describe("resolveChannelType", () => {
  it("maps known sources case-insensitively and defaults to DIRECT", () => {
    expect(resolveChannelType("TikTok")).toBe("TIKTOK");
    expect(resolveChannelType("twitter")).toBe("X");
    expect(resolveChannelType("newsletter")).toBe("DIRECT");
    expect(resolveChannelType(null)).toBe("DIRECT");
  });
});

describe("apply text", () => {
  it("round-trips", () => {
    expect(parseApplyText(buildApplyText("cabc123", "TIKTOK"))).toEqual({ jobId: "cabc123", channel: "TIKTOK" });
  });
  it("falls back to DIRECT for missing/unknown channel and rejects other text", () => {
    expect(parseApplyText("応募:cabc123")).toEqual({ jobId: "cabc123", channel: "DIRECT" });
    expect(parseApplyText("応募:cabc123:NOPE")).toEqual({ jobId: "cabc123", channel: "DIRECT" });
    expect(parseApplyText("こんにちは")).toBeNull();
  });
});

describe("buildLineEntryUrl", () => {
  it("encodes the id and text", () => {
    expect(buildLineEntryUrl("123abc", "応募:j:LINE")).toBe(
      `https://line.me/R/oaMessage/${encodeURIComponent("@123abc")}/?${encodeURIComponent("応募:j:LINE")}`,
    );
  });
});

describe("jstDate", () => {
  it("rolls over at JST midnight", () => {
    expect(jstDate(new Date("2026-10-13T14:59:00Z")).toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(jstDate(new Date("2026-10-13T15:00:00Z")).toISOString()).toBe("2026-10-14T00:00:00.000Z");
  });
});

describe("summarize", () => {
  it("computes rates and totals, guarding division by zero", () => {
    const { channels, total } = summarize([
      { channel: "LINE", impressions: 100, applies: 10, interviews: 5 },
      { channel: "直接", impressions: 0, applies: 0, interviews: 0 },
    ]);
    expect(channels[0].applyRate).toBeCloseTo(0.1);
    expect(channels[0].interviewRate).toBeCloseTo(0.5);
    expect(channels[1].applyRate).toBeNull();
    expect(total).toMatchObject({ impressions: 100, applies: 10, interviews: 5 });
    expect(formatRate(channels[1].applyRate)).toBe("—");
    expect(formatRate(0.1234)).toBe("12.3%");
  });
});
