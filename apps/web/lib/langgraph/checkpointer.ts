import { BaseCheckpointSaver, Checkpoint, CheckpointMetadata, CheckpointTuple, SerializerProtocol } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { supabaseAdmin } from "../supabase/server";

export class SupabaseCheckpointer extends BaseCheckpointSaver {
  // In-memory fallback for putWrites — no DB column needed
  private _pendingWrites: Map<string, [string, string, unknown][]> = new Map();

  constructor(serde?: SerializerProtocol) {
    super(serde);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const thread_id = config.configurable?.thread_id;
    if (!thread_id) return undefined;

    const { data, error } = await supabaseAdmin
      .from("langgraph_checkpoints")
      .select("checkpoint")
      .eq("thread_id", thread_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return undefined;

    return {
      config,
      checkpoint: data.checkpoint as Checkpoint,
      metadata: {},
      pendingWrites: (this._pendingWrites.get(thread_id) ?? []) as CheckpointTuple["pendingWrites"],
    };
  }

  async list(
    config: RunnableConfig,
    _filter?: Record<string, unknown>,
    _before?: RunnableConfig,
    limit?: number
  ): Promise<AsyncGenerator<CheckpointTuple>> {
    const thread_id = config.configurable?.thread_id;
    if (!thread_id) {
      async function* empty() {}
      return empty();
    }

    let query = supabaseAdmin
      .from("langgraph_checkpoints")
      .select("checkpoint")
      .eq("thread_id", thread_id)
      .order("created_at", { ascending: false });

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;
    const pendingWrites = this._pendingWrites.get(thread_id) ?? [];

    async function* generate() {
      if (!error && data) {
        for (const row of data) {
          yield {
            config,
            checkpoint: row.checkpoint as Checkpoint,
            metadata: {},
            pendingWrites: pendingWrites as CheckpointTuple["pendingWrites"],
          };
        }
      }
    }

    return generate();
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    _metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    const thread_id = config.configurable?.thread_id;
    const org_id    = config.configurable?.org_id   ?? "no-org";
    const user_id   = config.configurable?.user_id  ?? "no-user";

    if (!thread_id) {
      throw new Error("Missing thread_id in runnable config");
    }

    const { error } = await supabaseAdmin.from("langgraph_checkpoints").insert({
      thread_id,
      org_id,
      user_id,
      checkpoint,
    });

    if (error) {
      console.error("[SupabaseCheckpointer] Failed to save checkpoint:", error.message);
      throw error;
    }

    // Clear pending writes for this thread once a full checkpoint is saved
    this._pendingWrites.delete(thread_id);

    return {
      configurable: {
        ...config.configurable,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  /**
   * Required by @langchain/langgraph 0.2.x
   * Stores intermediate node writes in memory (no DB column needed).
   */
  async putWrites(
    config: RunnableConfig,
    writes: [string, unknown][],
    taskId: string
  ): Promise<void> {
    const thread_id = config.configurable?.thread_id;
    if (!thread_id) return;

    const existing = this._pendingWrites.get(thread_id) ?? [];
    const newWrites: [string, string, unknown][] = writes.map(([channel, value]) => [
      taskId,
      channel,
      value,
    ]);
    this._pendingWrites.set(thread_id, [...existing, ...newWrites]);
  }

  /**
   * Convenience method for API routes to get the full state without a RunnableConfig.
   */
  async loadLatest(threadId: string): Promise<any | null> {
    const { data, error } = await supabaseAdmin
      .from("langgraph_checkpoints")
      .select("checkpoint, org_id, user_id")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    const checkpoint = data.checkpoint as any;
    return {
      ...checkpoint.channel_values,
      org_id: data.org_id,
      user_id: data.user_id,
    };
  }
}

// Singleton export
let _instance: SupabaseCheckpointer | null = null;

export async function getCheckpointer(): Promise<SupabaseCheckpointer> {
  if (!_instance) {
    _instance = new SupabaseCheckpointer();
  }
  return _instance;
}

export async function _resetCheckpointer(): Promise<void> {
  _instance = null;
}