// ============================================================
// embedder.ts — OpenAI batch embeddings (ATH-28)
//
// Fixed 1536-dim text-embedding-3-small so output matches the
// vector(1536) column on document_embeddings.
//
// Rule #2: input texts are passed through to OpenAI and the
// vectors come back. Nothing here writes text to Supabase.
// ============================================================

import OpenAI from "openai";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

// OpenAI embeddings endpoint hard-limits batch size to 2048 inputs
// and ~300k tokens. 96 is a safe default for typical chunks.
const DEFAULT_BATCH_SIZE = 96;

let openaiInstance: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY environment variable");
    }
    openaiInstance = new OpenAI({ apiKey });
  }
  return openaiInstance;
}

/**
 * Embed an array of texts. Preserves input order.
 *
 * Returns an array of 1536-dim vectors. Batches requests of more
 * than DEFAULT_BATCH_SIZE items to stay under the OpenAI limit.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const client = getClient();
  const results: number[][] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += DEFAULT_BATCH_SIZE) {
    const slice = texts.slice(i, i + DEFAULT_BATCH_SIZE);
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: slice,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    // API guarantees res.data is in request order
    res.data.forEach((row, j) => {
      results[i + j] = row.embedding;
    });
  }

  return results;
}

export const EMBEDDING_CONFIG = {
  model: EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,
} as const;
