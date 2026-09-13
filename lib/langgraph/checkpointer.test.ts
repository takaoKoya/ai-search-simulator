import { describe, expect, it } from "vitest";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import type { SupabaseServerClient } from "@/lib/server/tenant";

const CounterState = Annotation.Root({
  counter: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  log: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

function buildGraph(checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(CounterState)
    .addNode("step_one", (state) => ({ counter: state.counter + 1, log: ["step_one"] }))
    .addNode("step_two", (state) => ({ counter: state.counter + 10, log: ["step_two"] }))
    .addEdge(START, "step_one")
    .addEdge("step_one", "step_two")
    .addEdge("step_two", END)
    .compile({ checkpointer });
}

describe("SupabaseCheckpointSaver", () => {
  it("persists graph state so it can be read back after a fresh instance (reload/resume)", async () => {
    const fake = new FakeSupabase();
    const supabase = fake as unknown as SupabaseServerClient;

    const checkpointerA = new SupabaseCheckpointSaver(supabase, "tenant-1", "workflow-1");
    const graphA = buildGraph(checkpointerA);
    const config = { configurable: { thread_id: "thread-1" } };

    const result = await graphA.invoke({ counter: 0, log: [] }, config);
    expect(result.counter).toBe(11);
    expect(result.log).toEqual(["step_one", "step_two"]);

    // Simulate a fresh process: new checkpointer + new compiled graph instance,
    // same underlying storage.
    const checkpointerB = new SupabaseCheckpointSaver(supabase, "tenant-1", "workflow-1");
    const graphB = buildGraph(checkpointerB);

    const state = await graphB.getState(config);
    expect(state.values.counter).toBe(11);
    expect(state.values.log).toEqual(["step_one", "step_two"]);

    const history = await checkpointerB.getTuple(config);
    expect(history?.checkpoint.channel_values.counter).toBe(11);
  });

  it("keeps separate threads independent", async () => {
    const fake = new FakeSupabase();
    const supabase = fake as unknown as SupabaseServerClient;
    const checkpointer = new SupabaseCheckpointSaver(supabase, "tenant-1", "workflow-1");
    const graph = buildGraph(checkpointer);

    await graph.invoke({ counter: 0, log: [] }, { configurable: { thread_id: "thread-a" } });
    await graph.invoke({ counter: 100, log: [] }, { configurable: { thread_id: "thread-b" } });

    const stateA = await graph.getState({ configurable: { thread_id: "thread-a" } });
    const stateB = await graph.getState({ configurable: { thread_id: "thread-b" } });

    expect(stateA.values.counter).toBe(11);
    expect(stateB.values.counter).toBe(111);
  });
});
