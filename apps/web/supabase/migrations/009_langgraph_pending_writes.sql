-- Add pending_writes column to langgraph_checkpoints
-- Required by @langchain/langgraph 0.2.x — the BaseCheckpointSaver
-- interface now calls putWrites() between full checkpoint saves.
-- Without this column the SupabaseCheckpointer throws
-- "putWrites is not a function" and the agent graph crashes.

ALTER TABLE langgraph_checkpoints
ADD COLUMN IF NOT EXISTS pending_writes JSONB NOT NULL DEFAULT '[]';