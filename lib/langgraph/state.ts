import { Annotation } from "@langchain/langgraph";

/** "Last write wins" channel: a node that doesn't return this key leaves it untouched. */
export function lastValue<T>(defaultValue?: T) {
  return Annotation<T>({
    reducer: (_current: T, update: T) => update,
    default: () => defaultValue as T,
  });
}

export type GraphStatus = "running" | "waiting_human" | "completed" | "failed";
