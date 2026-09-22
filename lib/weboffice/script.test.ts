import { describe, expect, it } from "vitest";
import { buildTimelineEvents, scriptEndMinute, DEFAULT_WEBOPS_INPUT, DAY_END_MINUTE, type WebOpsInput } from "@/lib/weboffice/script";

describe("buildTimelineEvents", () => {
  it("is deterministic — the same input always regenerates the identical day", () => {
    const input: WebOpsInput = { storeName: "カフェあおば", industry: "カフェ", topic: "秋限定ラテ" };
    const first = buildTimelineEvents(input);
    const second = buildTimelineEvents(input);
    expect(second).toEqual(first);
  });

  it("weaves the store name, industry, and topic into the generated copy", () => {
    const input: WebOpsInput = { storeName: "カフェあおば", industry: "カフェ", topic: "秋限定ラテ" };
    const events = buildTimelineEvents(input);
    const allText = events
      .flatMap((e) => [e.log, e.active?.task, e.approval?.body, e.approval?.title])
      .filter((v): v is string => typeof v === "string")
      .join("\n");
    expect(allText).toContain(input.storeName);
    expect(allText).toContain(input.industry);
    expect(allText).toContain(input.topic);
  });

  it("gives different inputs different generated counts", () => {
    const eventsA = buildTimelineEvents({ storeName: "店A", industry: "カフェ", topic: "お題A" });
    const eventsB = buildTimelineEvents({ storeName: "店B", industry: "美容室", topic: "お題B" });
    const dmCardA = eventsA.find((e) => e.id === "ev15")?.deskUpdates?.sales?.value;
    const dmCardB = eventsB.find((e) => e.id === "ev15")?.deskUpdates?.sales?.value;
    expect(dmCardA).not.toBe(dmCardB);
  });

  it("keeps the narrative structure fixed: 20 events in order, and the same hand-off/approval shape", () => {
    const events = buildTimelineEvents(DEFAULT_WEBOPS_INPUT);
    expect(events.map((e) => e.id)).toEqual(Array.from({ length: 20 }, (_, i) => `ev${i + 1}`));
    expect(events.every((e, i) => i === 0 || e.minute >= events[i - 1].minute)).toBe(true);
    expect(events.filter((e) => e.approval).map((e) => e.id)).toEqual(["ev5", "ev19"]);
    expect(events.filter((e) => e.handoff).map((e) => e.id)).toEqual(["ev3", "ev5", "ev6", "ev8", "ev13", "ev17", "ev19"]);
  });

  it("scriptEndMinute returns the last event's minute, and never past the day boundary", () => {
    const events = buildTimelineEvents(DEFAULT_WEBOPS_INPUT);
    const end = scriptEndMinute(events);
    expect(end).toBe(events[events.length - 1].minute);
    expect(end).toBeLessThanOrEqual(DAY_END_MINUTE);
  });

  it("scriptEndMinute falls back to the day boundary for an empty timeline", () => {
    expect(scriptEndMinute([])).toBe(DAY_END_MINUTE);
  });
});
