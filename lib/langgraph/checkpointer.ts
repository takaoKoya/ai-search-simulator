import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  copyCheckpoint,
  getCheckpointId,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type ChannelVersions,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { SupabaseServerClient } from "@/lib/server/tenant";

interface StoredBlob {
  type: string;
  data: string; // base64-encoded bytes from SerializerProtocol.dumpsTyped
}

function encodeBlob([type, bytes]: [string, Uint8Array]): StoredBlob {
  return { type, data: Buffer.from(bytes).toString("base64") };
}

function blobBytes(blob: StoredBlob): Uint8Array {
  return new Uint8Array(Buffer.from(blob.data, "base64"));
}

/**
 * LangGraph.js `BaseCheckpointSaver` backed by the `workflow_checkpoints` /
 * `workflow_checkpoint_writes` tables instead of process memory, so a graph
 * run survives server restarts and can resume after a human approval that
 * may arrive minutes or days later. The read/write algorithm mirrors the
 * official `MemorySaver` (see @langchain/langgraph-checkpoint/memory.js) —
 * same key shape (thread_id, checkpoint_ns, checkpoint_id), same "first
 * regular write wins, special (negative-index) writes overwrite" semantics —
 * just persisted through the tenant-scoped Supabase client instead of an
 * in-memory object, so RLS still applies to every read/write.
 *
 * Simplification vs. MemorySaver: `list()` does not attach `pendingWrites`
 * to each tuple. Phase 1 graphs never pause mid-superstep (via LangGraph's
 * `interrupt()`); every human-approval boundary is a clean graph return, so
 * nothing ever needs to replay pending writes from `list()` — only
 * `getTuple()` (used to resume) does, and it fetches them.
 */
export class SupabaseCheckpointSaver extends BaseCheckpointSaver {
  constructor(
    private readonly supabase: SupabaseServerClient,
    private readonly tenantId: string,
    private readonly workflowRunId: string
  ) {
    super();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = getCheckpointId(config);
    if (threadId === undefined) return undefined;

    let row: Record<string, unknown> | null;
    if (checkpointId) {
      const { data, error } = await this.supabase
        .from("workflow_checkpoints")
        .select("*")
        .eq("thread_id", threadId)
        .eq("checkpoint_ns", checkpointNs)
        .eq("checkpoint_id", checkpointId)
        .maybeSingle();
      if (error) throw error;
      row = data;
    } else {
      const { data, error } = await this.supabase
        .from("workflow_checkpoints")
        .select("*")
        .eq("thread_id", threadId)
        .eq("checkpoint_ns", checkpointNs)
        .order("checkpoint_id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      row = data;
    }
    if (!row) return undefined;

    const checkpointBlob = row.checkpoint as StoredBlob;
    const metadataBlob = row.metadata as StoredBlob;
    const checkpoint = (await this.serde.loadsTyped(
      checkpointBlob.type,
      blobBytes(checkpointBlob)
    )) as Checkpoint;
    const metadata = (await this.serde.loadsTyped(
      metadataBlob.type,
      blobBytes(metadataBlob)
    )) as CheckpointMetadata;

    const resolvedCheckpointId = row.checkpoint_id as string;
    const { data: writeRows, error: writesError } = await this.supabase
      .from("workflow_checkpoint_writes")
      .select("*")
      .eq("thread_id", threadId)
      .eq("checkpoint_ns", checkpointNs)
      .eq("checkpoint_id", resolvedCheckpointId)
      .order("idx", { ascending: true });
    if (writesError) throw writesError;

    const pendingWrites = await Promise.all(
      (writeRows ?? []).map(async (w) => {
        const blob = w.value as StoredBlob;
        const value = await this.serde.loadsTyped(blob.type, blobBytes(blob));
        return [w.task_id as string, w.channel as string, value] as [string, string, unknown];
      })
    );

    const tuple: CheckpointTuple = {
      config: {
        configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: resolvedCheckpointId },
      },
      checkpoint,
      metadata,
      pendingWrites,
    };
    const parentCheckpointId = row.parent_checkpoint_id as string | null;
    if (parentCheckpointId) {
      tuple.parentConfig = {
        configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: parentCheckpointId },
      };
    }
    return tuple;
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = config.configurable?.checkpoint_ns as string | undefined;
    const configCheckpointId = config.configurable?.checkpoint_id as string | undefined;

    let query = this.supabase
      .from("workflow_checkpoints")
      .select("*")
      .order("checkpoint_id", { ascending: false });
    if (threadId !== undefined) query = query.eq("thread_id", threadId);
    if (checkpointNs !== undefined) query = query.eq("checkpoint_ns", checkpointNs);
    if (configCheckpointId) query = query.eq("checkpoint_id", configCheckpointId);
    const beforeId = options?.before?.configurable?.checkpoint_id as string | undefined;
    if (beforeId) query = query.lt("checkpoint_id", beforeId);
    if (options?.limit !== undefined) query = query.limit(options.limit);

    const { data, error } = await query;
    if (error) throw error;

    for (const row of data ?? []) {
      const checkpointBlob = row.checkpoint as StoredBlob;
      const metadataBlob = row.metadata as StoredBlob;
      const checkpoint = (await this.serde.loadsTyped(checkpointBlob.type, blobBytes(checkpointBlob))) as Checkpoint;
      const metadata = (await this.serde.loadsTyped(metadataBlob.type, blobBytes(metadataBlob))) as CheckpointMetadata;

      if (
        options?.filter &&
        !Object.entries(options.filter).every(([key, value]) => (metadata as Record<string, unknown>)[key] === value)
      ) {
        continue;
      }

      const tuple: CheckpointTuple = {
        config: {
          configurable: {
            thread_id: row.thread_id as string,
            checkpoint_ns: row.checkpoint_ns as string,
            checkpoint_id: row.checkpoint_id as string,
          },
        },
        checkpoint,
        metadata,
      };
      if (row.parent_checkpoint_id) {
        tuple.parentConfig = {
          configurable: {
            thread_id: row.thread_id as string,
            checkpoint_ns: row.checkpoint_ns as string,
            checkpoint_id: row.parent_checkpoint_id as string,
          },
        };
      }
      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    if (threadId === undefined) {
      throw new Error(
        'Failed to put checkpoint: RunnableConfig.configurable is missing "thread_id". Pass { configurable: { thread_id } } when invoking the graph.'
      );
    }

    const prepared = copyCheckpoint(checkpoint);
    const [checkpointDump, metadataDump] = await Promise.all([
      this.serde.dumpsTyped(prepared),
      this.serde.dumpsTyped(metadata),
    ]);

    const { error } = await this.supabase.from("workflow_checkpoints").upsert(
      {
        tenant_id: this.tenantId,
        workflow_run_id: this.workflowRunId,
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
        parent_checkpoint_id: (config.configurable?.checkpoint_id as string | undefined) ?? null,
        checkpoint: encodeBlob(checkpointDump),
        metadata: encodeBlob(metadataDump),
      },
      { onConflict: "thread_id,checkpoint_ns,checkpoint_id" }
    );
    if (error) throw error;

    return { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (threadId === undefined || checkpointId === undefined) {
      throw new Error('Failed to put writes: RunnableConfig.configurable is missing "thread_id" or "checkpoint_id".');
    }

    const rows = await Promise.all(
      writes.map(async ([channel, value], idx) => {
        const dump = await this.serde.dumpsTyped(value);
        const writeIdx = channel in WRITES_IDX_MAP ? WRITES_IDX_MAP[channel] : idx;
        return {
          tenant_id: this.tenantId,
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpointId,
          task_id: taskId,
          idx: writeIdx,
          channel,
          value: encodeBlob(dump),
        };
      })
    );

    const specialRows = rows.filter((r) => r.idx < 0);
    const regularRows = rows.filter((r) => r.idx >= 0);

    if (specialRows.length > 0) {
      // Special channels (errors, interrupts, resumes) always reflect the latest write.
      const { error } = await this.supabase
        .from("workflow_checkpoint_writes")
        .upsert(specialRows, { onConflict: "thread_id,checkpoint_ns,checkpoint_id,task_id,idx" });
      if (error) throw error;
    }
    if (regularRows.length > 0) {
      // Regular writes are append-once: the first write for a given index wins on replay.
      const { error } = await this.supabase
        .from("workflow_checkpoint_writes")
        .upsert(regularRows, { onConflict: "thread_id,checkpoint_ns,checkpoint_id,task_id,idx", ignoreDuplicates: true });
      if (error) throw error;
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const { error: writesError } = await this.supabase
      .from("workflow_checkpoint_writes")
      .delete()
      .eq("thread_id", threadId);
    if (writesError) throw writesError;

    const { error } = await this.supabase.from("workflow_checkpoints").delete().eq("thread_id", threadId);
    if (error) throw error;
  }
}
