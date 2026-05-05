import { BaseCheckpointSaver, Checkpoint, CheckpointMetadata, CheckpointTuple, SerializerProtocol } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { supabaseAdmin } from "../supabase/server";

export class SupabaseCheckpointer extends BaseCheckpointSaver {
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

    async function* generate() {
      if (!error && data) {
        for (const row of data) {
          yield {
            config,
            checkpoint: row.checkpoint as Checkpoint,
            metadata: {},
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
    const org_id = config.configurable?.org_id;
    const user_id = config.configurable?.user_id;

    if (!thread_id || !org_id || !user_id) {
      throw new Error("Missing thread_id, org_id, or user_id in runnable config");
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

    return {
      configurable: {
        ...config.configurable,
        checkpoint_id: checkpoint.id,
      },
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