// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("checklistStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("初期状態は空である", async () => {
    const { getChecklistSnapshot } = await import("./checklistStore");
    expect(getChecklistSnapshot()).toEqual({});
  });

  it("toggleChecklistItemでチェック状態が反転する", async () => {
    const { getChecklistSnapshot, toggleChecklistItem } = await import("./checklistStore");
    toggleChecklistItem("theme");
    expect(getChecklistSnapshot()).toEqual({ theme: true });
    toggleChecklistItem("theme");
    expect(getChecklistSnapshot()).toEqual({ theme: false });
  });

  it("localStorageに永続化され、モジュール再読み込み後も状態が復元される", async () => {
    const first = await import("./checklistStore");
    first.toggleChecklistItem("headings");

    vi.resetModules();
    const second = await import("./checklistStore");
    expect(second.getChecklistSnapshot()).toEqual({ headings: true });
  });

  it("購読中のリスナーはtoggle時にのみ呼び出される", async () => {
    const { subscribeChecklist, toggleChecklistItem } = await import("./checklistStore");
    const listener = vi.fn();
    const unsubscribe = subscribeChecklist(listener);

    toggleChecklistItem("body");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    toggleChecklistItem("body");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
