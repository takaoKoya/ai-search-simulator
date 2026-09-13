import { describe, expect, it } from "vitest";
import { SimulatedEmailConnector } from "@/lib/sales/emailConnector";

describe("SimulatedEmailConnector", () => {
  it("never claims to be a real connector", () => {
    const connector = new SimulatedEmailConnector();
    expect(connector.isReal).toBe(false);
  });

  it("createDraft is deterministic and does not send", async () => {
    const connector = new SimulatedEmailConnector();
    const draft = { to: "test@example.com", subject: "Hello", body: "Body" };
    const a = await connector.createDraft(draft);
    const b = await connector.createDraft(draft);
    expect(a.providerDraftId).toBe(b.providerDraftId);
    expect(a.provider).toBe("simulated_gmail");
  });

  it("send() produces a distinct provider message id per idempotency key", async () => {
    const connector = new SimulatedEmailConnector();
    const draft = { to: "test@example.com", subject: "Hello", body: "Body" };
    const first = await connector.send(draft, "key-1");
    const second = await connector.send(draft, "key-2");
    expect(first.providerMessageId).not.toBe(second.providerMessageId);
  });

  it("send() is deterministic for the same idempotency key (safe to retry the call itself)", async () => {
    const connector = new SimulatedEmailConnector();
    const draft = { to: "test@example.com", subject: "Hello", body: "Body" };
    const a = await connector.send(draft, "same-key");
    const b = await connector.send(draft, "same-key");
    expect(a.providerMessageId).toBe(b.providerMessageId);
  });
});
